import type { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';
import { getChildren, getParents, getSpouses } from '@/utils/gedcom-parser';

export const TREE_NODE_WIDTH = 78;
export const TREE_NODE_HEIGHT = 94;
export const TREE_H_GAP = 24;
export const TREE_COUPLE_GAP = 16;
export const TREE_V_GAP = 140;
export const TREE_MAX_NODES = 160;
export const TREE_VIEWPORT_PAD = 320;

export type TreeEdgeKind = 'spouse' | 'descent';

export interface TreeCanvasEdge {
  id: string;
  kind: TreeEdgeKind;
  fromId: string;
  toId: string;
  parentIds?: string[];
  childIds?: string[];
}

export interface TreeCanvasNode {
  id: string;
  person: GedcomIndividual;
  x: number;
  y: number;
  gen: number;
  isFocus: boolean;
  canExpand: boolean;
}

export interface TreeCanvasLayout {
  nodes: TreeCanvasNode[];
  edges: TreeCanvasEdge[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  focusId: string;
}

function neighborIds(personId: string, data: FamilyTreeData): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id) || id === personId) return;
    seen.add(id);
    out.push(id);
  };
  for (const p of getParents(personId, data)) push(p.id);
  for (const c of getChildren(personId, data)) push(c.id);
  for (const s of getSpouses(personId, data)) push(s.id);
  return out;
}


/**
 * Hourglass seed: direct ancestors + direct descendants + their spouses only.
 * No siblings/uncles/cousins until the user expands someone.
 */
export function seedRevealedIds(
  focusId: string,
  data: FamilyTreeData,
  opts?: { ancestorDepth?: number; descendantDepth?: number; maxNodes?: number }
): Set<string> {
  const ancestorDepth = opts?.ancestorDepth ?? 2;
  const descendantDepth = opts?.descendantDepth ?? 2;
  const maxNodes = opts?.maxNodes ?? TREE_MAX_NODES;
  const revealed = new Set<string>();

  if (!data.individuals.has(focusId)) return revealed;
  revealed.add(focusId);

  let frontier = [focusId];
  for (let d = 0; d < ancestorDepth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const p of getParents(id, data)) {
        if (revealed.has(p.id) || revealed.size >= maxNodes) continue;
        revealed.add(p.id);
        next.push(p.id);
      }
    }
    frontier = next;
  }

  frontier = [focusId];
  for (let d = 0; d < descendantDepth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of getChildren(id, data)) {
        if (revealed.has(c.id) || revealed.size >= maxNodes) continue;
        revealed.add(c.id);
        next.push(c.id);
      }
    }
    frontier = next;
  }

  // Spouses of the direct line only (keeps couples intact without pulling collateral kin).
  for (const id of Array.from(revealed)) {
    for (const sp of getSpouses(id, data)) {
      if (revealed.size >= maxNodes) break;
      revealed.add(sp.id);
    }
  }

  return revealed;
}

export function expandPersonNeighborhood(
  personId: string,
  data: FamilyTreeData,
  revealed: Set<string>,
  maxNodes: number = TREE_MAX_NODES
): Set<string> {
  const next = new Set(revealed);
  for (const id of neighborIds(personId, data)) {
    if (next.size >= maxNodes) break;
    next.add(id);
  }
  for (const id of Array.from(next)) {
    if (revealed.has(id)) continue;
    for (const sp of getSpouses(id, data)) {
      if (next.size >= maxNodes) break;
      next.add(sp.id);
    }
  }
  return next;
}

/**
 * Propagate generations from focus through parent/child/spouse.
 * Never dump unknowns onto gen 0 — that put uncles/cousins in the focus row.
 */
function assignGenerations(
  focusId: string,
  revealed: Set<string>,
  data: FamilyTreeData
): Map<string, number> {
  const gen = new Map<string, number>();
  if (!revealed.has(focusId)) return gen;
  gen.set(focusId, 0);

  const queue: string[] = [focusId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const g = gen.get(id)!;

    for (const p of getParents(id, data)) {
      if (!revealed.has(p.id)) continue;
      const want = g - 1;
      const cur = gen.get(p.id);
      if (cur === undefined || cur > want) {
        gen.set(p.id, want);
        queue.push(p.id);
      }
    }
    for (const c of getChildren(id, data)) {
      if (!revealed.has(c.id)) continue;
      const want = g + 1;
      const cur = gen.get(c.id);
      if (cur === undefined || cur < want) {
        gen.set(c.id, want);
        queue.push(c.id);
      }
    }
    for (const s of getSpouses(id, data)) {
      if (!revealed.has(s.id) || gen.has(s.id)) continue;
      gen.set(s.id, g);
      queue.push(s.id);
    }
  }

  // Collateral leftovers (expanded neighborhood) — attach from nearest assigned neighbor.
  let pending = true;
  let guard = 0;
  while (pending && guard < revealed.size) {
    pending = false;
    guard++;
    for (const id of revealed) {
      if (gen.has(id)) continue;
      for (const p of getParents(id, data)) {
        if (!revealed.has(p.id) || !gen.has(p.id)) continue;
        gen.set(id, gen.get(p.id)! + 1);
        pending = true;
        break;
      }
      if (gen.has(id)) continue;
      for (const c of getChildren(id, data)) {
        if (!revealed.has(c.id) || !gen.has(c.id)) continue;
        gen.set(id, gen.get(c.id)! - 1);
        pending = true;
        break;
      }
      if (gen.has(id)) continue;
      for (const s of getSpouses(id, data)) {
        if (!revealed.has(s.id) || !gen.has(s.id)) continue;
        gen.set(id, gen.get(s.id)!);
        pending = true;
        break;
      }
    }
  }

  return gen;
}

function orderCouple(parentIds: string[], data: FamilyTreeData): string[] {
  if (parentIds.length <= 1) return parentIds.slice();
  const sorted = parentIds.slice();
  sorted.sort((a, b) => {
    const pa = data.individuals.get(a);
    const pb = data.individuals.get(b);
    if (pa?.sex === 'M' && pb?.sex !== 'M') return -1;
    if (pb?.sex === 'M' && pa?.sex !== 'M') return 1;
    return a.localeCompare(b);
  });
  return sorted;
}

function sortByName(ids: string[], data: FamilyTreeData): string[] {
  return ids.slice().sort((a, b) => {
    const pa = data.individuals.get(a);
    const pb = data.individuals.get(b);
    return (
      (pa?.surname ?? '').localeCompare(pb?.surname ?? '') ||
      (pa?.givenName ?? '').localeCompare(pb?.givenName ?? '') ||
      a.localeCompare(b)
    );
  });
}

type FamilyUnit = {
  id: string;
  parentIds: string[];
  childIds: string[];
};

function buildFamilyUnits(revealed: Set<string>, data: FamilyTreeData): FamilyUnit[] {
  const units: FamilyUnit[] = [];
  const seen = new Set<string>();

  for (const fam of data.families.values()) {
    const parents = [fam.husbandId, fam.wifeId].filter(
      (id): id is string => !!id && revealed.has(id)
    );
    if (parents.length === 0) continue;
    const kids = (Array.isArray(fam.childrenIds) ? fam.childrenIds : []).filter((id) =>
      revealed.has(id)
    );
    if (kids.length === 0 && parents.length < 2) continue;
    const key = `${[...parents].sort().join('+')}>${[...kids].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push({ id: fam.id, parentIds: parents, childIds: kids });
  }

  return units;
}

/**
 * Hourglass / FamilySearch-portrait layout:
 * - fixed Y per generation
 * - focus + spouses alone on the spine at gen 0
 * - every child group hangs under its parents' midpoint
 * - ancestors sit as couples centered over their child
 */
export function layoutTreeCanvas(
  focusId: string,
  data: FamilyTreeData,
  revealed: Set<string>
): TreeCanvasLayout {
  const empty: TreeCanvasLayout = {
    nodes: [],
    edges: [],
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    focusId,
  };
  if (!data.individuals.has(focusId) || revealed.size === 0) return empty;

  const generations = assignGenerations(focusId, revealed, data);
  const units = buildFamilyUnits(revealed, data);
  const positions = new Map<string, { x: number; y: number }>();
  const slot = TREE_NODE_WIDTH + TREE_H_GAP;
  const coupleSlot = TREE_NODE_WIDTH + TREE_COUPLE_GAP;
  const yFor = (g: number) => g * TREE_V_GAP;

  const place = (id: string, x: number, g: number) => {
    positions.set(id, { x, y: yFor(g) });
  };

  // --- Spine: focus + spouses only on gen 0 ---
  const focusSpouses = orderCouple(
    getSpouses(focusId, data)
      .map((s) => s.id)
      .filter((id) => revealed.has(id)),
    data
  );

  place(focusId, 0, 0);
  focusSpouses.forEach((sid, i) => {
    place(sid, (i + 1) * coupleSlot, 0);
  });

  // Shift focus block so the couple is centered on x=0
  const spine = [focusId, ...focusSpouses];
  if (spine.length > 1) {
    const xs = spine.map((id) => positions.get(id)!.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const id of spine) positions.get(id)!.x -= mid;
  }

  const focusCoupleMid =
    spine.reduce((sum, id) => sum + positions.get(id)!.x, 0) / spine.length;

  // --- Place a child row centered under a given parent midpoint ---
  const placeChildrenUnder = (childIds: string[], parentMidX: number, childGen: number) => {
    const kids = sortByName(
      childIds.filter((id) => revealed.has(id) && !positions.has(id)),
      data
    );
    if (kids.length === 0) return;

    // Each child may have revealed spouses — keep child+spouse as a mini-couple in the row.
    const blocks: string[][] = kids.map((kid) => {
      const sps = orderCouple(
        getSpouses(kid, data)
          .map((s) => s.id)
          .filter((id) => revealed.has(id) && !positions.has(id)),
        data
      );
      return [kid, ...sps];
    });

    const blockWidths = blocks.map((b) =>
      b.length <= 1 ? TREE_NODE_WIDTH : TREE_NODE_WIDTH + (b.length - 1) * coupleSlot
    );
    const total =
      blockWidths.reduce((a, b) => a + b, 0) + Math.max(0, blocks.length - 1) * TREE_H_GAP;
    let x = parentMidX - total / 2;

    blocks.forEach((block, bi) => {
      const blockStart = x;
      block.forEach((id, j) => {
        // Node coordinates are centers
        place(id, blockStart + TREE_NODE_WIDTH / 2 + j * coupleSlot, childGen);
      });
      x += blockWidths[bi] + TREE_H_GAP;
    });
  };

  const coupleMidX = (ids: string[]) =>
    ids.reduce((sum, id) => sum + positions.get(id)!.x, 0) / ids.length;

  const shiftIds = (ids: Iterable<string>, dx: number) => {
    if (dx === 0) return;
    for (const id of ids) {
      const pos = positions.get(id);
      if (pos) pos.x += dx;
    }
  };

  /** All revealed descendants of a gen-0 anchor (children recursively). */
  const descendantIdsOf = (anchorId: string): Set<string> => {
    const out = new Set<string>();
    const q = [anchorId];
    for (let i = 0; i < q.length; i++) {
      for (const c of getChildren(q[i], data)) {
        if (!revealed.has(c.id) || out.has(c.id) || c.id === anchorId) continue;
        // Keep spouses of descendants with the subtree for packing.
        out.add(c.id);
        q.push(c.id);
        for (const sp of getSpouses(c.id, data)) {
          if (revealed.has(sp.id)) out.add(sp.id);
        }
      }
    }
    return out;
  };

  // --- Gen 0 collaterals (siblings of focus) BEFORE descendants ---
  // Without this, sibling kids have no placed parent and dump at the far right.
  const focusParentIds = getParents(focusId, data).map((p) => p.id);
  const siblingIds = sortByName(
    Array.from(revealed).filter((id) => {
      if (positions.has(id)) return false;
      if ((generations.get(id) ?? 999) !== 0) return false;
      const parents = getParents(id, data).map((p) => p.id);
      return parents.some((p) => focusParentIds.includes(p));
    }),
    data
  );

  let spineRight =
    Math.max(...spine.map((id) => positions.get(id)!.x)) + TREE_NODE_WIDTH / 2;
  let spineLeft =
    Math.min(...spine.map((id) => positions.get(id)!.x)) - TREE_NODE_WIDTH / 2;

  // Split siblings left/right of focus for balance
  const rightSibs = siblingIds.filter((_, i) => i % 2 === 0);
  const leftSibs = siblingIds.filter((_, i) => i % 2 === 1);

  const placeSiblingBlock = (sibId: string, side: 'left' | 'right') => {
    if (positions.has(sibId)) return;
    const sps = getSpouses(sibId, data)
      .map((s) => s.id)
      .filter((id) => revealed.has(id) && !positions.has(id));
    const ordered = orderCouple([sibId, ...sps], data);
    const width =
      ordered.length <= 1
        ? TREE_NODE_WIDTH
        : TREE_NODE_WIDTH + (ordered.length - 1) * coupleSlot;
    if (side === 'right') {
      const start = spineRight + TREE_H_GAP + slot;
      ordered.forEach((id, j) => {
        place(id, start + TREE_NODE_WIDTH / 2 + j * coupleSlot, 0);
      });
      spineRight = start + width;
    } else {
      const start = spineLeft - TREE_H_GAP - slot - width;
      ordered.forEach((id, j) => {
        place(id, start + TREE_NODE_WIDTH / 2 + j * coupleSlot, 0);
      });
      spineLeft = start;
    }
  };

  rightSibs.forEach((id) => placeSiblingBlock(id, 'right'));
  leftSibs.forEach((id) => placeSiblingBlock(id, 'left'));

  // Any other unplaced gen-0 people (e.g. expanded in-laws already spouses of placed)
  const otherGen0 = sortByName(
    Array.from(revealed).filter(
      (id) => (generations.get(id) ?? 999) === 0 && !positions.has(id)
    ),
    data
  );
  for (const id of otherGen0) {
    const right = Math.max(...Array.from(positions.values()).map((p) => p.x));
    place(id, right + slot, 0);
  }

  // --- Descendants top-down by generation (parents are placed first) ---
  const maxGen = Math.max(0, ...Array.from(generations.values()));
  for (let g = 1; g <= maxGen; g++) {
    const unitsHere = units
      .map((u) => {
        const parentsPlaced = u.parentIds.filter((id) => positions.has(id));
        if (parentsPlaced.length === 0) return null;
        const parentGens = parentsPlaced.map((id) => generations.get(id) ?? 0);
        if (!parentGens.every((pg) => pg === g - 1)) return null;
        const kids = u.childIds.filter(
          (id) => (generations.get(id) ?? 0) === g && !positions.has(id)
        );
        if (kids.length === 0) return null;
        const mid = coupleMidX(parentsPlaced);
        return { u, kids, mid, parentsPlaced };
      })
      .filter(
        (x): x is { u: FamilyUnit; kids: string[]; mid: number; parentsPlaced: string[] } => !!x
      )
      .sort((a, b) => a.mid - b.mid);

    for (const { kids, mid } of unitsHere) {
      placeChildrenUnder(kids, mid, g);
    }

    // Fallback: kids whose parent is placed but missing a family unit
    const orphans = Array.from(revealed).filter((id) => {
      if (positions.has(id) || (generations.get(id) ?? 0) !== g) return false;
      return getParents(id, data).some((p) => positions.has(p.id));
    });
    // Group orphans by parent set and hang under that mid
    const orphanGroups = new Map<string, { parents: string[]; kids: string[] }>();
    for (const id of orphans) {
      const parents = getParents(id, data)
        .map((p) => p.id)
        .filter((pid) => positions.has(pid));
      const key = [...parents].sort().join('+');
      let group = orphanGroups.get(key);
      if (!group) {
        group = { parents, kids: [] };
        orphanGroups.set(key, group);
      }
      group.kids.push(id);
    }
    for (const group of orphanGroups.values()) {
      placeChildrenUnder(group.kids, coupleMidX(group.parents), g);
    }
  }

  // Pack gen-0 anchors (focus + siblings) so each subtree sits under its parent
  // without shoving kids to the end of the sibling row.
  type AnchorPack = { anchorIds: string[]; memberIds: Set<string>; minX: number; maxX: number };
  const anchors: AnchorPack[] = [];
  const gen0Anchors = [
    focusId,
    ...siblingIds,
    ...otherGen0.filter((id) => {
      // only people who look like "primary" anchors, not already in a couple block of another
      const sps = getSpouses(id, data).map((s) => s.id);
      return !sps.some((s) => siblingIds.includes(s) || s === focusId);
    }),
  ];

  const seenAnchor = new Set<string>();
  for (const anchorId of gen0Anchors) {
    if (!positions.has(anchorId) || seenAnchor.has(anchorId)) continue;
    const sps = getSpouses(anchorId, data)
      .map((s) => s.id)
      .filter((id) => positions.has(id) && (generations.get(id) ?? 0) === 0);
    const anchorIds = orderCouple([anchorId, ...sps.filter((id) => id !== anchorId)], data);
    anchorIds.forEach((id) => seenAnchor.add(id));

    const members = new Set<string>(anchorIds);
    for (const a of anchorIds) {
      for (const d of descendantIdsOf(a)) members.add(d);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    for (const id of members) {
      const pos = positions.get(id);
      if (!pos) continue;
      minX = Math.min(minX, pos.x - TREE_NODE_WIDTH / 2);
      maxX = Math.max(maxX, pos.x + TREE_NODE_WIDTH / 2);
    }
    if (!Number.isFinite(minX)) continue;
    anchors.push({ anchorIds, memberIds: members, minX, maxX });
  }

  anchors.sort((a, b) => coupleMidX(a.anchorIds) - coupleMidX(b.anchorIds));
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    const gap = TREE_H_GAP * 1.5;
    const need = prev.maxX + gap - cur.minX;
    if (need > 0) {
      shiftIds(cur.memberIds, need);
      cur.minX += need;
      cur.maxX += need;
    }
  }

  // Re-center each child group under its parents (packing may have moved parents as a group,
  // but also fixes any drift from earlier placement).
  for (let g = 1; g <= maxGen; g++) {
    for (const u of units) {
      const parentsPlaced = u.parentIds.filter((id) => positions.has(id));
      const kidsPlaced = u.childIds.filter(
        (id) => positions.has(id) && (generations.get(id) ?? 0) === g
      );
      if (parentsPlaced.length === 0 || kidsPlaced.length === 0) continue;
      if (!parentsPlaced.every((id) => (generations.get(id) ?? 0) === g - 1)) continue;

      // Include spouses of kids in the shift group
      const shiftSet = new Set<string>();
      for (const kid of kidsPlaced) {
        shiftSet.add(kid);
        for (const sp of getSpouses(kid, data)) {
          if (positions.has(sp.id) && (generations.get(sp.id) ?? 0) === g) shiftSet.add(sp.id);
        }
        // Also shift that kid's deeper descendants so the column stays aligned
        for (const d of descendantIdsOf(kid)) {
          if (positions.has(d)) shiftSet.add(d);
        }
      }
      const kidXs = kidsPlaced.map((id) => positions.get(id)!.x);
      const kidsMid = (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
      const parentMid = coupleMidX(parentsPlaced);
      shiftIds(shiftSet, parentMid - kidsMid);
    }
  }

  // --- Ancestors bottom-up: each couple centered over their placed child ---
  const minGen = Math.min(0, ...Array.from(generations.values()));
  for (let g = -1; g >= minGen; g--) {
    const childrenAt = Array.from(revealed).filter(
      (id) => (generations.get(id) ?? 0) === g + 1 && positions.has(id)
    );

    type ParentGroup = { parentIds: string[]; childXs: number[] };
    const groups: ParentGroup[] = [];

    for (const childId of childrenAt) {
      const parents = orderCouple(
        getParents(childId, data)
          .map((p) => p.id)
          .filter((id) => revealed.has(id) && (generations.get(id) ?? 0) === g),
        data
      );
      if (parents.length === 0) continue;
      const key = [...parents].sort().join('+');
      let group = groups.find((gr) => [...gr.parentIds].sort().join('+') === key);
      if (!group) {
        group = { parentIds: parents, childXs: [] };
        groups.push(group);
      }
      group.childXs.push(positions.get(childId)!.x);
    }

    groups.sort((a, b) => {
      const ma = a.childXs.reduce((s, x) => s + x, 0) / a.childXs.length;
      const mb = b.childXs.reduce((s, x) => s + x, 0) / b.childXs.length;
      return ma - mb;
    });

    for (const group of groups) {
      const mid = group.childXs.reduce((s, x) => s + x, 0) / group.childXs.length;
      const toPlace = group.parentIds.filter((id) => !positions.has(id));
      if (toPlace.length === 0) continue;
      if (toPlace.length === 1) {
        place(toPlace[0], mid, g);
      } else {
        place(toPlace[0], mid - coupleSlot / 2, g);
        place(toPlace[1], mid + coupleSlot / 2, g);
      }
    }

    // Remaining people at this gen (uncles etc.) — park beside placed siblings
    const leftovers = Array.from(revealed).filter(
      (id) => (generations.get(id) ?? 0) === g && !positions.has(id)
    );
    for (const id of sortByName(leftovers, data)) {
      const parents = getParents(id, data).map((p) => p.id);
      const siblingXs: number[] = [];
      for (const other of revealed) {
        if (other === id || !positions.has(other)) continue;
        if ((generations.get(other) ?? 0) !== g) continue;
        const op = getParents(other, data).map((p) => p.id);
        if (parents.some((p) => op.includes(p))) {
          siblingXs.push(positions.get(other)!.x);
        }
      }
      if (siblingXs.length > 0) {
        place(id, Math.max(...siblingXs) + slot, g);
      } else {
        const right = Math.max(
          focusCoupleMid + slot * 3,
          ...Array.from(positions.values()).map((p) => p.x)
        );
        place(id, right + slot, g);
      }
    }
  }

  // Anyone still unplaced (safety)
  for (const id of revealed) {
    if (positions.has(id) || !generations.has(id)) continue;
    const g = generations.get(id)!;
    // Prefer under parents if they exist
    const parents = getParents(id, data)
      .map((p) => p.id)
      .filter((pid) => positions.has(pid));
    if (parents.length > 0) {
      place(id, coupleMidX(parents), g);
      continue;
    }
    const right = Math.max(0, ...Array.from(positions.values()).map((p) => p.x));
    place(id, right + slot, g);
  }

  // Soft overlap resolve per generation — keep couples together, avoid breaking
  // parent/child alignment too aggressively.
  const byGen = new Map<number, string[]>();
  for (const [id, g] of generations) {
    if (!positions.has(id)) continue;
    const list = byGen.get(g) ?? [];
    list.push(id);
    byGen.set(g, list);
  }
  for (const [, ids] of byGen) {
    // Build couple blocks so spouses move together
    const used = new Set<string>();
    const blocks: string[][] = [];
    const ordered = ids.slice().sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (const id of ordered) {
      if (used.has(id)) continue;
      const sps = getSpouses(id, data)
        .map((s) => s.id)
        .filter((sid) => ids.includes(sid) && !used.has(sid));
      const block = orderCouple([id, ...sps], data);
      block.forEach((b) => used.add(b));
      blocks.push(block);
    }
    blocks.sort((a, b) => coupleMidX(a) - coupleMidX(b));
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      const cur = blocks[i];
      const prevRight = Math.max(...prev.map((id) => positions.get(id)!.x)) + TREE_NODE_WIDTH / 2;
      const curLeft = Math.min(...cur.map((id) => positions.get(id)!.x)) - TREE_NODE_WIDTH / 2;
      const need = prevRight + TREE_H_GAP - curLeft;
      if (need > 0) shiftIds(cur, need);
    }
  }

  // Final pass: re-hang kids under parents after soft overlap nudges
  for (let g = 1; g <= maxGen; g++) {
    for (const u of units) {
      const parentsPlaced = u.parentIds.filter((id) => positions.has(id));
      const kidsPlaced = u.childIds.filter(
        (id) => positions.has(id) && (generations.get(id) ?? 0) === g
      );
      if (parentsPlaced.length === 0 || kidsPlaced.length === 0) continue;
      if (!parentsPlaced.every((id) => (generations.get(id) ?? 0) === g - 1)) continue;
      const shiftSet = new Set<string>();
      for (const kid of kidsPlaced) {
        shiftSet.add(kid);
        for (const sp of getSpouses(kid, data)) {
          if (positions.has(sp.id) && (generations.get(sp.id) ?? 0) === g) shiftSet.add(sp.id);
        }
        for (const d of descendantIdsOf(kid)) {
          if (positions.has(d)) shiftSet.add(d);
        }
      }
      const kidXs = kidsPlaced.map((id) => positions.get(id)!.x);
      const kidsMid = (Math.min(...kidXs) + Math.max(...kidXs)) / 2;
      shiftIds(shiftSet, coupleMidX(parentsPlaced) - kidsMid);
    }
  }

    // Edges
  const edges: TreeCanvasEdge[] = [];
  const spouseSeen = new Set<string>();
  for (const id of revealed) {
    for (const sp of getSpouses(id, data)) {
      if (!revealed.has(sp.id)) continue;
      const a = id < sp.id ? id : sp.id;
      const b = id < sp.id ? sp.id : id;
      const key = `s:${a}|${b}`;
      if (spouseSeen.has(key)) continue;
      spouseSeen.add(key);
      edges.push({ id: key, kind: 'spouse', fromId: a, toId: b });
    }
  }

  const descentSeen = new Set<string>();
  for (const u of units) {
    const parents = u.parentIds.filter((id) => positions.has(id));
    const kids = u.childIds.filter((id) => positions.has(id));
    if (parents.length === 0 || kids.length === 0) continue;
    const key = `d:${[...parents].sort().join('+')}>${[...kids].sort().join(',')}`;
    if (descentSeen.has(key)) continue;
    descentSeen.add(key);
    edges.push({
      id: key,
      kind: 'descent',
      fromId: parents[0],
      toId: kids[0],
      parentIds: parents,
      childIds: kids,
    });
  }

  // Synthetic descent for parent/child pairs missing a family unit edge
  for (const id of revealed) {
    if (!positions.has(id)) continue;
    const parents = getParents(id, data)
      .map((p) => p.id)
      .filter((pid) => positions.has(pid));
    if (parents.length === 0) continue;
    const key = `d:${[...parents].sort().join('+')}>${id}`;
    if (descentSeen.has(key)) continue;
    // Skip if a multi-child unit already covers this child
    if (
      edges.some(
        (e) =>
          e.kind === 'descent' &&
          (e.childIds ?? []).includes(id) &&
          parents.every((p) => (e.parentIds ?? []).includes(p))
      )
    ) {
      continue;
    }
    descentSeen.add(key);
    edges.push({
      id: key,
      kind: 'descent',
      fromId: parents[0],
      toId: id,
      parentIds: parents,
      childIds: [id],
    });
  }

  // Precompute expandability in one pass (avoids repeated parent/child scans per node).
  const canExpandById = new Map<string, boolean>();
  for (const id of revealed) {
    canExpandById.set(id, false);
  }
  for (const id of revealed) {
    for (const nid of neighborIds(id, data)) {
      if (!revealed.has(nid)) {
        canExpandById.set(id, true);
        break;
      }
    }
  }

  const nodes: TreeCanvasNode[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const id of revealed) {
    const person = data.individuals.get(id);
    const pos = positions.get(id);
    const g = generations.get(id);
    if (!person || !pos || g === undefined) continue;
    const halfW = TREE_NODE_WIDTH / 2;
    const halfH = TREE_NODE_HEIGHT / 2;
    minX = Math.min(minX, pos.x - halfW);
    maxX = Math.max(maxX, pos.x + halfW);
    minY = Math.min(minY, pos.y - halfH);
    maxY = Math.max(maxY, pos.y + halfH);
    nodes.push({
      id,
      person,
      x: pos.x,
      y: pos.y,
      gen: g,
      isFocus: id === focusId,
      canExpand: canExpandById.get(id) === true,
    });
  }

  if (!Number.isFinite(minX)) {
    minX = -100;
    maxX = 100;
    minY = -100;
    maxY = 100;
  }

  return { nodes, edges, bounds: { minX, maxX, minY, maxY }, focusId };
}

export function cullNodesToViewport(
  nodes: TreeCanvasNode[],
  viewport: { left: number; top: number; right: number; bottom: number },
  maxMount: number = TREE_MAX_NODES
): TreeCanvasNode[] {
  const pad = TREE_VIEWPORT_PAD;
  const visible = nodes.filter((n) => {
    const left = n.x - TREE_NODE_WIDTH / 2;
    const right = n.x + TREE_NODE_WIDTH / 2;
    const top = n.y - TREE_NODE_HEIGHT / 2;
    const bottom = n.y + TREE_NODE_HEIGHT / 2;
    return !(
      right < viewport.left - pad ||
      left > viewport.right + pad ||
      bottom < viewport.top - pad ||
      top > viewport.bottom + pad
    );
  });

  if (visible.length <= maxMount) return visible;

  const cx = (viewport.left + viewport.right) / 2;
  const cy = (viewport.top + viewport.bottom) / 2;
  return visible
    .slice()
    .sort((a, b) => {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
      const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
      const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
      return da - db;
    })
    .slice(0, maxMount);
}

export function cullEdgesForNodes(
  edges: TreeCanvasEdge[],
  visibleIds: Set<string>
): TreeCanvasEdge[] {
  return edges.filter((e) => {
    if (e.kind === 'spouse') {
      // Draw if either spouse is on screen — the other end may be just off-pad.
      return visibleIds.has(e.fromId) || visibleIds.has(e.toId);
    }
    const parents = e.parentIds ?? [];
    const kids = e.childIds ?? [];
    return parents.some((id) => visibleIds.has(id)) || kids.some((id) => visibleIds.has(id));
  });
}

/** Keep an edge when its geometry hits the viewport (even if endpoint nodes were unmounted). */
export function cullEdgesToViewport(
  edges: TreeCanvasEdge[],
  posById: Map<string, { x: number; y: number }>,
  viewport: { left: number; top: number; right: number; bottom: number },
  pad: number = TREE_VIEWPORT_PAD
): TreeCanvasEdge[] {
  const left = viewport.left - pad;
  const right = viewport.right + pad;
  const top = viewport.top - pad;
  const bottom = viewport.bottom + pad;

  const hits = (x: number, y: number) =>
    x >= left && x <= right && y >= top && y <= bottom;

  const segmentHits = (x1: number, y1: number, x2: number, y2: number) => {
    if (hits(x1, y1) || hits(x2, y2)) return true;
    // Rough AABB of the segment vs viewport
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    return !(maxX < left || minX > right || maxY < top || minY > bottom);
  };

  return edges.filter((e) => {
    if (e.kind === 'spouse') {
      const a = posById.get(e.fromId);
      const b = posById.get(e.toId);
      if (!a || !b) return false;
      return segmentHits(a.x, a.y, b.x, b.y);
    }
    const parents = (e.parentIds ?? [])
      .map((id) => posById.get(id))
      .filter((p): p is { x: number; y: number } => !!p);
    const kids = (e.childIds ?? [])
      .map((id) => posById.get(id))
      .filter((p): p is { x: number; y: number } => !!p);
    if (parents.length === 0 || kids.length === 0) return false;
    const xs = [...parents, ...kids].map((p) => p.x);
    const ys = [...parents, ...kids].map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return !(maxX < left || minX > right || maxY < top || minY > bottom);
  });
}

/** Build compact SVG path data for all edges (world coords, caller subtracts origin). */
export function buildEdgePathData(
  edges: TreeCanvasEdge[],
  posById: Map<string, { x: number; y: number }>,
  originX: number,
  originY: number
): { spouse: string; descent: string } {
  const spouseParts: string[] = [];
  const descentParts: string[] = [];

  for (const edge of edges) {
    if (edge.kind === 'spouse') {
      const a = posById.get(edge.fromId);
      const b = posById.get(edge.toId);
      if (!a || !b) continue;
      spouseParts.push(
        `M ${a.x - originX} ${a.y - originY} L ${b.x - originX} ${b.y - originY}`
      );
      continue;
    }

    const parents = (edge.parentIds ?? [])
      .map((id) => posById.get(id))
      .filter((p): p is { x: number; y: number } => !!p);
    const kids = (edge.childIds ?? [])
      .map((id) => posById.get(id))
      .filter((p): p is { x: number; y: number } => !!p);
    if (parents.length === 0 || kids.length === 0) continue;

    const parentMidX =
      parents.reduce((sum, p) => sum + p.x, 0) / parents.length - originX;
    const parentBottom = parents[0].y - originY + 36;
    const childTop = kids[0].y - originY - 36;
    const busY = parentBottom + (childTop - parentBottom) * 0.55;
    const kidXs = kids.map((k) => k.x - originX);
    const busLeft = Math.min(parentMidX, ...kidXs);
    const busRight = Math.max(parentMidX, ...kidXs);
    const coupleBarY = parentBottom + 10;

    for (const p of parents) {
      descentParts.push(`M ${p.x - originX} ${parentBottom} V ${coupleBarY}`);
    }
    if (parents.length > 1) {
      descentParts.push(
        `M ${parents[0].x - originX} ${coupleBarY} H ${parents[parents.length - 1].x - originX}`
      );
    }
    descentParts.push(`M ${parentMidX} ${coupleBarY} V ${busY}`);
    descentParts.push(`M ${busLeft} ${busY} H ${busRight}`);
    for (const k of kids) {
      descentParts.push(`M ${k.x - originX} ${busY} V ${childTop}`);
    }
  }

  return { spouse: spouseParts.join(' '), descent: descentParts.join(' ') };
}

import type { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';
import { getChildren, getParents, getSiblings, getSpouses } from '@/utils/gedcom-parser';

export const TREE_NODE_WIDTH = 76;
export const TREE_NODE_HEIGHT = 92;
export const TREE_H_GAP = 22;
export const TREE_COUPLE_GAP = 14;
export const TREE_V_GAP = 130;
/** Soft cap on nodes laid out / considered for mount. */
export const TREE_MAX_NODES = 160;
export const TREE_VIEWPORT_PAD = 220;

export type TreeEdgeKind = 'spouse' | 'descent';

export interface TreeCanvasEdge {
  id: string;
  kind: TreeEdgeKind;
  /** Spouse link endpoints, or unused for descent. */
  fromId: string;
  toId: string;
  /** Descent: one or two parents. */
  parentIds?: string[];
  /** Descent: children hanging from the couple. */
  childIds?: string[];
}

export interface TreeCanvasNode {
  id: string;
  person: GedcomIndividual;
  x: number;
  y: number;
  gen: number;
  isFocus: boolean;
  /** Has parents/children/spouses not yet in the revealed set. */
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

function hasUnrevealedNeighbors(
  personId: string,
  data: FamilyTreeData,
  revealed: Set<string>
): boolean {
  return neighborIds(personId, data).some((id) => !revealed.has(id));
}

/**
 * Seed a local neighborhood around focus: ancestors, descendants, spouses.
 * Siblings of focus are included sparingly so gen-0 stays readable.
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
        if (revealed.has(p.id)) continue;
        if (revealed.size >= maxNodes) break;
        revealed.add(p.id);
        next.push(p.id);
      }
      if (revealed.size >= maxNodes) break;
    }
    frontier = next;
    if (revealed.size >= maxNodes) break;
  }

  frontier = [focusId];
  for (let d = 0; d < descendantDepth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const c of getChildren(id, data)) {
        if (revealed.has(c.id)) continue;
        if (revealed.size >= maxNodes) break;
        revealed.add(c.id);
        next.push(c.id);
      }
      if (revealed.size >= maxNodes) break;
    }
    frontier = next;
    if (revealed.size >= maxNodes) break;
  }

  // A few siblings only — full sibling rows make gen-0 unreadable.
  let siblingCount = 0;
  for (const s of getSiblings(focusId, data)) {
    if (revealed.size >= maxNodes || siblingCount >= 4) break;
    revealed.add(s.id);
    siblingCount++;
  }

  const snapshot = Array.from(revealed);
  for (const id of snapshot) {
    for (const sp of getSpouses(id, data)) {
      if (revealed.size >= maxNodes) break;
      revealed.add(sp.id);
    }
  }

  return revealed;
}

/** Expand one person's immediate neighborhood into the revealed set. */
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
  const added = Array.from(next).filter((id) => !revealed.has(id));
  for (const id of added) {
    for (const sp of getSpouses(id, data)) {
      if (next.size >= maxNodes) break;
      next.add(sp.id);
    }
  }
  return next;
}

/**
 * Strict generation ranks relative to focus.
 * Rules (genealogy layered layouts / FamilySearch portrait / yFiles family groups):
 * - parents are always one generation above children
 * - spouses share a generation
 */
function assignGenerations(
  focusId: string,
  revealed: Set<string>,
  data: FamilyTreeData
): Map<string, number> {
  const gen = new Map<string, number>();
  gen.set(focusId, 0);

  const upQueue = [focusId];
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    const g = gen.get(id)!;
    for (const p of getParents(id, data)) {
      if (!revealed.has(p.id) || gen.has(p.id)) continue;
      gen.set(p.id, g - 1);
      upQueue.push(p.id);
    }
  }

  const downQueue = [focusId];
  while (downQueue.length > 0) {
    const id = downQueue.shift()!;
    const g = gen.get(id)!;
    for (const c of getChildren(id, data)) {
      if (!revealed.has(c.id) || gen.has(c.id)) continue;
      gen.set(c.id, g + 1);
      downQueue.push(c.id);
    }
  }

  // Spouses inherit partner generation; iterate to closure.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of revealed) {
      if (gen.has(id)) continue;
      for (const sp of getSpouses(id, data)) {
        if (!revealed.has(sp.id)) continue;
        const sg = gen.get(sp.id);
        if (sg !== undefined) {
          gen.set(id, sg);
          changed = true;
          break;
        }
      }
    }
  }

  for (const id of revealed) {
    if (!gen.has(id)) gen.set(id, 0);
  }

  // Enforce parent/child rank invariant when both revealed.
  for (const id of revealed) {
    const g = gen.get(id)!;
    for (const p of getParents(id, data)) {
      if (!revealed.has(p.id)) continue;
      const pg = gen.get(p.id)!;
      if (pg >= g) gen.set(p.id, g - 1);
    }
  }

  return gen;
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
    const key = `${parents.slice().sort().join('+')}>${kids.slice().sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    units.push({ id: fam.id, parentIds: parents, childIds: kids });
  }

  // Parent→child links that lack a family record in the revealed set.
  for (const id of revealed) {
    const parents = getParents(id, data)
      .map((p) => p.id)
      .filter((pid) => revealed.has(pid));
    if (parents.length === 0) continue;
    const key = `${parents.slice().sort().join('+')}>${id}`;
    if (seen.has(key)) continue;
    // Skip if already covered by a multi-child unit with same parents
    const covered = units.some(
      (u) =>
        u.childIds.includes(id) &&
        u.parentIds.length === parents.length &&
        parents.every((p) => u.parentIds.includes(p))
    );
    if (covered) continue;
    seen.add(key);
    units.push({
      id: `synthetic:${key}`,
      parentIds: parents,
      childIds: [id],
    });
  }

  return units;
}

function orderCouple(parentIds: string[], data: FamilyTreeData): string[] {
  if (parentIds.length <= 1) return parentIds;
  const [a, b] = parentIds;
  const pa = data.individuals.get(a);
  const pb = data.individuals.get(b);
  // Traditional: male left, female right when known.
  if (pa?.sex === 'M' && pb?.sex === 'F') return [a, b];
  if (pa?.sex === 'F' && pb?.sex === 'M') return [b, a];
  return parentIds.slice().sort();
}

/**
 * Layered family-group layout (FamilySearch portrait / yFiles-style):
 * fixed Y per generation, spouses side-by-side, children centered under the couple.
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

  const yForGen = (g: number) => g * TREE_V_GAP;

  const placeAt = (id: string, x: number, g: number) => {
    positions.set(id, { x, y: yForGen(g) });
  };

  // --- Gen 0: focus block (siblings | focus | spouses) ---
  const focusSpouses = getSpouses(focusId, data)
    .map((s) => s.id)
    .filter((id) => revealed.has(id));
  const focusSiblings = getSiblings(focusId, data)
    .map((s) => s.id)
    .filter((id) => revealed.has(id) && !focusSpouses.includes(id))
    .slice(0, 4);

  let cursor = 0;
  for (const sid of focusSiblings) {
    placeAt(sid, cursor, 0);
    cursor += slot;
  }
  const focusX = cursor;
  placeAt(focusId, focusX, 0);
  cursor += coupleSlot;
  for (const sid of focusSpouses) {
    placeAt(sid, cursor, 0);
    cursor += coupleSlot;
  }
  // Re-center gen0 around 0
  const gen0Ids = [...focusSiblings, focusId, ...focusSpouses];
  if (gen0Ids.length > 0) {
    const xs = gen0Ids.map((id) => positions.get(id)!.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    for (const id of gen0Ids) {
      positions.get(id)!.x -= mid;
    }
  }

  const placed = new Set(gen0Ids);

  // Helper: pack a row of ids centered on centerX at generation g
  const packRow = (ids: string[], g: number, centerX: number, gap = slot) => {
    if (ids.length === 0) return;
    const width = (ids.length - 1) * gap;
    let x = centerX - width / 2;
    for (const id of ids) {
      if (positions.has(id)) {
        // Keep existing if already placed closer to intended center? Prefer first placement.
        x += gap;
        continue;
      }
      placeAt(id, x, g);
      placed.add(id);
      x += gap;
    }
  };

  // --- Descendants: for each gen, place children under their parents' midpoint ---
  const maxGen = Math.max(0, ...Array.from(generations.values()));
  for (let g = 1; g <= maxGen; g++) {
    const parentGen = g - 1;
    // Units whose parents are on parentGen and children on g
    const relevant = units.filter((u) => {
      const pGens = u.parentIds.map((id) => generations.get(id) ?? 0);
      const cGens = u.childIds.map((id) => generations.get(id) ?? 0);
      return (
        pGens.some((pg) => pg === parentGen) &&
        cGens.some((cg) => cg === g) &&
        u.childIds.some((cid) => !positions.has(cid))
      );
    });

    // Sort units by parent midpoint (left to right)
    const scored = relevant.map((u) => {
      const pxs = u.parentIds
        .map((id) => positions.get(id)?.x)
        .filter((x): x is number => typeof x === 'number');
      const mid = pxs.length ? pxs.reduce((a, b) => a + b, 0) / pxs.length : 0;
      return { u, mid };
    });
    scored.sort((a, b) => a.mid - b.mid);

    for (const { u, mid } of scored) {
      const kids = u.childIds.filter(
        (cid) => (generations.get(cid) ?? 0) === g && !positions.has(cid)
      );
      if (kids.length === 0) continue;
      // Stable order by name
      kids.sort((a, b) => {
        const pa = data.individuals.get(a);
        const pb = data.individuals.get(b);
        return (pa?.givenName ?? '').localeCompare(pb?.givenName ?? '') || a.localeCompare(b);
      });
      packRow(kids, g, mid);
    }

    // Orphans at this gen (no placed parents) — pack to the side
    const leftovers = Array.from(revealed).filter(
      (id) => (generations.get(id) ?? 0) === g && !positions.has(id)
    );
    if (leftovers.length > 0) {
      leftovers.sort();
      const rightEdge = Math.max(
        0,
        ...Array.from(positions.values()).map((p) => p.x)
      );
      packRow(leftovers, g, rightEdge + slot * 2);
    }
  }

  // --- Ancestors: place parents as couples centered over their children ---
  const minGen = Math.min(0, ...Array.from(generations.values()));
  for (let g = -1; g >= minGen; g--) {
    const childGen = g + 1;
    // For each revealed person at this gen, try to place as part of couple over their kids
    const candidates = Array.from(revealed).filter(
      (id) => (generations.get(id) ?? 0) === g && !positions.has(id)
    );

    // Group by the set of children already placed in childGen
    type Group = { parentIds: string[]; childIds: string[]; mid: number };
    const groups: Group[] = [];

    for (const u of units) {
      const parentsHere = u.parentIds.filter(
        (id) => (generations.get(id) ?? 0) === g && !positions.has(id)
      );
      if (parentsHere.length === 0) continue;
      const kidsBelow = u.childIds.filter(
        (id) => (generations.get(id) ?? 0) === childGen && positions.has(id)
      );
      if (kidsBelow.length === 0) continue;
      const mid =
        kidsBelow.reduce((sum, id) => sum + positions.get(id)!.x, 0) / kidsBelow.length;
      groups.push({
        parentIds: orderCouple(parentsHere, data),
        childIds: kidsBelow,
        mid,
      });
    }

    groups.sort((a, b) => a.mid - b.mid);

    for (const group of groups) {
      const toPlace = group.parentIds.filter((id) => !positions.has(id));
      if (toPlace.length === 0) continue;
      if (toPlace.length === 1) {
        placeAt(toPlace[0], group.mid, g);
        placed.add(toPlace[0]);
      } else {
        // Couple straddles child midpoint
        placeAt(toPlace[0], group.mid - coupleSlot / 2, g);
        placeAt(toPlace[1], group.mid + coupleSlot / 2, g);
        placed.add(toPlace[0]);
        placed.add(toPlace[1]);
      }
    }

    // Remaining ancestors without placed children
    const leftovers = candidates.filter((id) => !positions.has(id));
    if (leftovers.length > 0) {
      leftovers.sort();
      const leftEdge = Math.min(
        0,
        ...Array.from(positions.values()).map((p) => p.x)
      );
      packRow(orderCouple(leftovers, data), g, leftEdge - slot * 2, coupleSlot);
    }
  }

  // Anyone still unplaced
  for (const id of revealed) {
    if (positions.has(id)) continue;
    const g = generations.get(id) ?? 0;
    const rightEdge = Math.max(0, ...Array.from(positions.values()).map((p) => p.x));
    placeAt(id, rightEdge + slot, g);
  }

  // Sweep overlaps per generation (keep strict Y)
  const byGen = new Map<number, string[]>();
  for (const id of revealed) {
    const g = generations.get(id) ?? 0;
    const list = byGen.get(g) ?? [];
    list.push(id);
    byGen.set(g, list);
  }
  for (const [, ids] of byGen) {
    ids.sort((a, b) => positions.get(a)!.x - positions.get(b)!.x);
    for (let i = 1; i < ids.length; i++) {
      const prev = positions.get(ids[i - 1])!;
      const cur = positions.get(ids[i])!;
      const minDist = slot * 0.92;
      if (cur.x - prev.x < minDist) {
        cur.x = prev.x + minDist;
      }
    }
  }

  // Build edges: spouse links + descent family connectors
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
    const parents = u.parentIds.filter((id) => revealed.has(id) && positions.has(id));
    const kids = u.childIds.filter((id) => revealed.has(id) && positions.has(id));
    if (parents.length === 0 || kids.length === 0) continue;
    const key = `d:${parents.slice().sort().join('+')}>${kids.slice().sort().join(',')}`;
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

  const nodes: TreeCanvasNode[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const id of revealed) {
    const person = data.individuals.get(id);
    const pos = positions.get(id);
    if (!person || !pos) continue;
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
      gen: generations.get(id) ?? 0,
      isFocus: id === focusId,
      canExpand: hasUnrevealedNeighbors(id, data, revealed),
    });
  }

  if (!Number.isFinite(minX)) {
    minX = -100;
    maxX = 100;
    minY = -100;
    maxY = 100;
  }

  return {
    nodes,
    edges,
    bounds: { minX, maxX, minY, maxY },
    focusId,
  };
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
      return visibleIds.has(e.fromId) && visibleIds.has(e.toId);
    }
    const parents = e.parentIds ?? [];
    const kids = e.childIds ?? [];
    const parentOk = parents.some((id) => visibleIds.has(id));
    const childOk = kids.some((id) => visibleIds.has(id));
    return parentOk && childOk;
  });
}

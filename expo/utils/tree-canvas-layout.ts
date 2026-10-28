import type { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';
import { getChildren, getParents, getSiblings, getSpouses } from '@/utils/gedcom-parser';

export const TREE_NODE_WIDTH = 76;
export const TREE_NODE_HEIGHT = 92;
export const TREE_H_GAP = 18;
export const TREE_V_GAP = 118;
/** Soft cap on nodes laid out / considered for mount. */
export const TREE_MAX_NODES = 160;
export const TREE_VIEWPORT_PAD = 220;

export type TreeEdgeKind = 'parent' | 'spouse';

export interface TreeCanvasEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: TreeEdgeKind;
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
 * Seed a local neighborhood around focus: ancestors, descendants, spouses, siblings.
 * Hard-capped so the canvas never materializes the full GEDCOM.
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

  // Ancestors
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

  // Descendants
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

  // Focus siblings (same generation context)
  for (const s of getSiblings(focusId, data)) {
    if (revealed.size >= maxNodes) break;
    revealed.add(s.id);
  }

  // Spouses of everyone currently revealed
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
  // Also pull spouses of newly added people so couples stay intact
  const added = Array.from(next).filter((id) => !revealed.has(id));
  for (const id of added) {
    for (const sp of getSpouses(id, data)) {
      if (next.size >= maxNodes) break;
      next.add(sp.id);
    }
  }
  return next;
}

function assignGenerations(
  focusId: string,
  revealed: Set<string>,
  data: FamilyTreeData
): Map<string, number> {
  const gen = new Map<string, number>();
  gen.set(focusId, 0);

  // Upward BFS (parents)
  const upQueue = [focusId];
  while (upQueue.length > 0) {
    const id = upQueue.shift()!;
    const g = gen.get(id)!;
    for (const p of getParents(id, data)) {
      if (!revealed.has(p.id)) continue;
      if (gen.has(p.id)) continue;
      gen.set(p.id, g - 1);
      upQueue.push(p.id);
    }
  }

  // Downward BFS (children)
  const downQueue = [focusId];
  while (downQueue.length > 0) {
    const id = downQueue.shift()!;
    const g = gen.get(id)!;
    for (const c of getChildren(id, data)) {
      if (!revealed.has(c.id)) continue;
      if (gen.has(c.id)) continue;
      gen.set(c.id, g + 1);
      downQueue.push(c.id);
    }
  }

  // Spouses inherit partner generation (prefer already-assigned)
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

  // Siblings of focus without gen yet → gen 0
  for (const id of revealed) {
    if (!gen.has(id)) gen.set(id, 0);
  }

  return gen;
}

function buildEdges(
  revealed: Set<string>,
  data: FamilyTreeData
): TreeCanvasEdge[] {
  const edges: TreeCanvasEdge[] = [];
  const seen = new Set<string>();

  for (const id of revealed) {
    for (const p of getParents(id, data)) {
      if (!revealed.has(p.id)) continue;
      const key = `p:${p.id}->${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: key, fromId: p.id, toId: id, kind: 'parent' });
    }
    for (const sp of getSpouses(id, data)) {
      if (!revealed.has(sp.id)) continue;
      const a = id < sp.id ? id : sp.id;
      const b = id < sp.id ? sp.id : id;
      const key = `s:${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: key, fromId: a, toId: b, kind: 'spouse' });
    }
  }

  return edges;
}

/**
 * Layout revealed people into a generation-stacked pedigree around focus.
 * Coordinates are world-space with focus near (0, 0).
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
  const edges = buildEdges(revealed, data);

  const byGen = new Map<number, string[]>();
  for (const id of revealed) {
    const g = generations.get(id) ?? 0;
    const list = byGen.get(g) ?? [];
    list.push(id);
    byGen.set(g, list);
  }

  const positions = new Map<string, { x: number; y: number }>();

  // Place generation 0 first (focus + spouses + siblings)
  const gen0 = byGen.get(0) ?? [];
  const focusSpouses = getSpouses(focusId, data)
    .map((s) => s.id)
    .filter((id) => revealed.has(id));
  const focusSiblings = getSiblings(focusId, data)
    .map((s) => s.id)
    .filter((id) => revealed.has(id) && !focusSpouses.includes(id));

  const gen0Order: string[] = [];
  // siblings left of focus
  for (const sid of focusSiblings) gen0Order.push(sid);
  gen0Order.push(focusId);
  for (const sid of focusSpouses) gen0Order.push(sid);
  for (const id of gen0) {
    if (!gen0Order.includes(id)) gen0Order.push(id);
  }

  const slot = TREE_NODE_WIDTH + TREE_H_GAP;
  const placeRow = (ids: string[], y: number, preferredCenterX = 0) => {
    if (ids.length === 0) return;
    const width = (ids.length - 1) * slot;
    let startX = preferredCenterX - width / 2;
    ids.forEach((id, i) => {
      positions.set(id, { x: startX + i * slot, y });
    });
  };

  placeRow(gen0Order, 0, 0);

  const gens = Array.from(byGen.keys()).sort((a, b) => a - b);

  // Ancestors (negative gens): bottom-up so parents can center over children
  for (const g of gens.filter((n) => n < 0).sort((a, b) => b - a)) {
    const ids = byGen.get(g) ?? [];
    // Sort by average child x when available
    const scored = ids.map((id) => {
      const kids = getChildren(id, data)
        .map((c) => c.id)
        .filter((cid) => positions.has(cid));
      const avg =
        kids.length > 0
          ? kids.reduce((sum, cid) => sum + (positions.get(cid)?.x ?? 0), 0) / kids.length
          : 0;
      return { id, avg };
    });
    scored.sort((a, b) => a.avg - b.avg || a.id.localeCompare(b.id));
    const ordered = scored.map((s) => s.id);
    const preferred =
      scored.length > 0
        ? scored.reduce((sum, s) => sum + s.avg, 0) / scored.length
        : 0;
    placeRow(ordered, g * TREE_V_GAP, preferred);
  }

  // Descendants (positive gens): top-down, center under parents
  for (const g of gens.filter((n) => n > 0).sort((a, b) => a - b)) {
    const ids = byGen.get(g) ?? [];
    const scored = ids.map((id) => {
      const pars = getParents(id, data)
        .map((p) => p.id)
        .filter((pid) => positions.has(pid));
      const avg =
        pars.length > 0
          ? pars.reduce((sum, pid) => sum + (positions.get(pid)?.x ?? 0), 0) / pars.length
          : 0;
      return { id, avg };
    });
    scored.sort((a, b) => a.avg - b.avg || a.id.localeCompare(b.id));
    const ordered = scored.map((s) => s.id);
    const preferred =
      scored.length > 0
        ? scored.reduce((sum, s) => sum + s.avg, 0) / scored.length
        : 0;
    placeRow(ordered, g * TREE_V_GAP, preferred);
  }

  // Resolve overlaps within each generation (sweep)
  for (const g of gens) {
    const ids = (byGen.get(g) ?? [])
      .filter((id) => positions.has(id))
      .sort((a, b) => (positions.get(a)!.x - positions.get(b)!.x));
    for (let i = 1; i < ids.length; i++) {
      const prev = positions.get(ids[i - 1])!;
      const cur = positions.get(ids[i])!;
      const minDist = slot;
      if (cur.x - prev.x < minDist) {
        cur.x = prev.x + minDist;
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

  // Prefer focus + nearer-to-viewport-center when over cap
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
  return edges.filter((e) => visibleIds.has(e.fromId) && visibleIds.has(e.toId));
}

/**
 * Coarse-grid A* orthogonal routing between anchor points, avoiding inflated obstacles.
 * All segments are axis-aligned; endpoints use exact world coordinates.
 */

import type { LayoutObstacle, RoutedPath } from './skillFlowLayoutRouting';

/** Keep in sync with ROUTING_EDGE_CLEARANCE in skillFlowLayoutRouting.ts */
const ROUT_CLEAR = 48;

function inflateRouting(o: LayoutObstacle): { x: number; y: number; width: number; height: number } {
  const p = o.padding + ROUT_CLEAR;
  return {
    x: o.rect.x - p,
    y: o.rect.y - p,
    width: o.rect.width + p * 2,
    height: o.rect.height + p * 2,
  };
}

function pointInRect(
  px: number,
  py: number,
  r: { x: number; y: number; width: number; height: number },
): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

function cellBlocked(
  cx: number,
  cy: number,
  inflated: Array<{ id: string; r: { x: number; y: number; width: number; height: number } }>,
  ignoreNodeIds: Set<string>,
): boolean {
  for (const { id, r } of inflated) {
    if (ignoreNodeIds.has(id)) continue;
    if (pointInRect(cx, cy, r)) return true;
  }
  return false;
}

function simplifyOrthogonalPath(points: RoutedPath): RoutedPath {
  if (points.length <= 2) return points;
  const out: RoutedPath = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinear =
      (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function fullyOrthogonalize(raw: RoutedPath): RoutedPath {
  if (raw.length < 2) return raw;
  const out: RoutedPath = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = out[out.length - 1];
    const cur = raw[i];
    const sameX = Math.abs(prev.x - cur.x) < 1e-3;
    const sameY = Math.abs(prev.y - cur.y) < 1e-3;
    if (sameX || sameY) {
      out.push(cur);
      continue;
    }
    const bend =
      Math.abs(cur.x - prev.x) >= Math.abs(cur.y - prev.y)
        ? { x: cur.x, y: prev.y }
        : { x: prev.x, y: cur.y };
    if (Math.abs(bend.x - prev.x) > 1e-3 || Math.abs(bend.y - prev.y) > 1e-3) {
      out.push(bend);
    }
    out.push(cur);
  }
  return out;
}

type GridIx = { ix: number; iy: number };
type OpenNode = GridIx & { f: number };

export type OrthogonalGridRouteOpts = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  obstacles: LayoutObstacle[];
  ignoreNodeIds: Set<string>;
  /** Prefer expanding horizontal segments first (neighbor order + tie-break). */
  primary: 'horizontal' | 'vertical';
};

const MAX_CELLS = 52000;
const MARGIN = 96;

class MinHeap {
  private items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: OpenNode): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): OpenNode | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) return first;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].f <= this.items[index].f) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    const len = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < len && this.items[left].f < this.items[smallest].f) smallest = left;
      if (right < len && this.items[right].f < this.items[smallest].f) smallest = right;
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}

/**
 * Route using Manhattan moves on a coarse grid. Returns null if grid too large / no path.
 */
export function orthogonalGridRoute(opts: OrthogonalGridRouteOpts): RoutedPath | null {
  const { sx, sy, tx, ty, obstacles, ignoreNodeIds, primary } = opts;

  const nodeInflated = obstacles
    .filter((o) => o.kind === 'node')
    .map((o) => ({ id: o.id, r: inflateRouting(o) }));
  const otherInflated = obstacles
    .filter((o) => o.kind !== 'node')
    .map((o) => ({ id: o.id, r: inflateRouting(o) }));
  const inflated = [...nodeInflated, ...otherInflated];

  let minX = Math.min(sx, tx);
  let minY = Math.min(sy, ty);
  let maxX = Math.max(sx, tx);
  let maxY = Math.max(sy, ty);
  for (const { r } of inflated) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  minX -= MARGIN;
  minY -= MARGIN;
  maxX += MARGIN;
  maxY += MARGIN;

  let cell = 18;
  let cols = Math.ceil((maxX - minX) / cell);
  let rows = Math.ceil((maxY - minY) / cell);
  while (cols * rows > MAX_CELLS && cell < 120) {
    cell *= 1.35;
    cols = Math.ceil((maxX - minX) / cell);
    rows = Math.ceil((maxY - minY) / cell);
  }
  if (cols * rows > MAX_CELLS * 1.5 || cols < 2 || rows < 2) return null;

  const toIx = (wx: number, wy: number): GridIx => ({
    ix: Math.floor((wx - minX) / cell),
    iy: Math.floor((wy - minY) / cell),
  });

  const toWorld = (ix: number, iy: number): { x: number; y: number } => ({
    x: minX + (ix + 0.5) * cell,
    y: minY + (iy + 0.5) * cell,
  });

  const inBounds = (ix: number, iy: number) => ix >= 0 && iy >= 0 && ix < cols && iy < rows;
  const key = (ix: number, iy: number) => `${ix},${iy}`;
  const blockedCache = new Map<string, boolean>();

  const blocked = (ix: number, iy: number): boolean => {
    const k = key(ix, iy);
    const cached = blockedCache.get(k);
    if (cached !== undefined) return cached;
    const { x, y } = toWorld(ix, iy);
    const value = cellBlocked(x, y, inflated, ignoreNodeIds);
    blockedCache.set(k, value);
    return value;
  };

  let start = toIx(sx, sy);
  let goal = toIx(tx, ty);

  const spiralFindFree = (ix: number, iy: number): GridIx | null => {
    if (inBounds(ix, iy) && !blocked(ix, iy)) return { ix, iy };
    const maxR = Math.max(cols, rows);
    for (let r = 1; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (inBounds(nx, ny) && !blocked(nx, ny)) return { ix: nx, iy: ny };
        }
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        for (const dx of [-r, r]) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (inBounds(nx, ny) && !blocked(nx, ny)) return { ix: nx, iy: ny };
        }
      }
    }
    return null;
  };

  const sFree = spiralFindFree(start.ix, start.iy);
  const gFree = spiralFindFree(goal.ix, goal.iy);
  if (!sFree || !gFree) return null;

  start = sFree;
  goal = gFree;

  const hManhattan = (ix: number, iy: number) => Math.abs(ix - goal.ix) + Math.abs(iy - goal.iy);

  const neighbors =
    primary === 'horizontal'
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
      : [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ];

  const open = new MinHeap();
  open.push({ ...start, f: hManhattan(start.ix, start.iy) });
  const came = new Map<string, GridIx | null>();
  const gScore = new Map<string, number>();
  gScore.set(key(start.ix, start.iy), 0);
  came.set(key(start.ix, start.iy), null);

  let found: GridIx | null = null;
  const maxSteps = cols * rows * 6;
  let steps = 0;

  while (open.size && steps < maxSteps) {
    steps++;
    const cur = open.pop();
    if (!cur) break;
    const curKey = key(cur.ix, cur.iy);
    const currentG = gScore.get(curKey) ?? Infinity;
    if (cur.f > currentG + hManhattan(cur.ix, cur.iy) + 1e-9) continue;
    if (cur.ix === goal.ix && cur.iy === goal.iy) {
      found = cur;
      break;
    }
    for (const [dx, dy] of neighbors) {
      const nx = cur.ix + dx;
      const ny = cur.iy + dy;
      if (!inBounds(nx, ny) || blocked(nx, ny)) continue;
      const nk = key(nx, ny);
      const tentative = currentG + 1;
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        came.set(nk, cur);
        gScore.set(nk, tentative);
        open.push({ ix: nx, iy: ny, f: tentative + hManhattan(nx, ny) });
      }
    }
  }

  if (!found) return null;

  const pathIx: GridIx[] = [];
  let cur: GridIx | null = found;
  while (cur) {
    pathIx.push(cur);
    cur = came.get(key(cur.ix, cur.iy)) ?? null;
  }
  pathIx.reverse();

  const worldPts: RoutedPath = pathIx.map((p) => toWorld(p.ix, p.iy));
  if (worldPts.length === 0) return null;
  worldPts[0] = { x: sx, y: sy };
  worldPts[worldPts.length - 1] = { x: tx, y: ty };

  return simplifyOrthogonalPath(fullyOrthogonalize(worldPts));
}

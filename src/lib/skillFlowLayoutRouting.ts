/** Obstacle-aware routing helpers for skill graph edges */

import { orthogonalGridRoute } from './skillFlowOrthogonalGridRouter';
import type { SkillNodeV2 } from './skillFlowGraphV2';

export const EDGE_CLEARANCE = 28;

/** Extra inflation for obstacle checks during settled routing (keeps lines visually off card faces). */
export const ROUTING_EDGE_CLEARANCE = 48;

export type OrthogonalRoutingPrimary = 'horizontal' | 'vertical';

export type LayoutObstacle = {
  id: string;
  kind: 'node' | 'group' | 'artifact';
  rect: { x: number; y: number; width: number; height: number };
  padding: number;
};

export type RoutedPath = { x: number; y: number }[];

function inflateRouting(o: LayoutObstacle): { x: number; y: number; width: number; height: number } {
  const p = o.padding + ROUTING_EDGE_CLEARANCE;
  return {
    x: o.rect.x - p,
    y: o.rect.y - p,
    width: o.rect.width + p * 2,
    height: o.rect.height + p * 2,
  };
}

/** Map node id → layout group id (`fb-main`, …) for group-aware routing. */
export function buildNodeToGroupIdMapFromPlan(
  plan: { groups?: Array<{ id: string; nodeIds: string[] }> } | undefined,
): Map<string, string> {
  const m = new Map<string, string>();
  if (!plan?.groups) return m;
  for (const g of plan.groups) {
    for (const nid of g.nodeIds) {
      m.set(nid, g.id);
    }
  }
  return m;
}

/**
 * Drop the surrounding group frame obstacle when both endpoints belong to that group
 * (edges run inside the band; the frame should not force detours).
 */
export function filterObstaclesForEdge(
  obstacles: LayoutObstacle[],
  sourceNodeId: string,
  targetNodeId: string,
  nodeToGroupId: Map<string, string>,
): LayoutObstacle[] {
  const sg = nodeToGroupId.get(sourceNodeId);
  const tg = nodeToGroupId.get(targetNodeId);
  if (sg !== undefined && sg === tg) {
    const gid = `rf-group-${sg}`;
    return obstacles.filter((o) => !(o.kind === 'group' && o.id === gid));
  }
  return obstacles;
}

/** True if any polyline segment intersects inflated node obstacles (excluding ignored ids). */
export function polylineHitsNodeObstacles(
  points: RoutedPath,
  obstacles: LayoutObstacle[],
  ignoreIds: Set<string>,
): boolean {
  const nodeObs = obstacles.filter((o) => o.kind === 'node' && !ignoreIds.has(o.id));
  const inflated = nodeObs.map(inflateRouting);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    for (const r of inflated) {
      if (segmentHitsRect(p0, p1, r)) return true;
    }
  }
  return false;
}

function orthogonalRouteFallbackThreeSegment(opts: {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  laneMidOffset: number;
  primary: OrthogonalRoutingPrimary;
  obstacles: LayoutObstacle[];
  ignoreNodeIds: Set<string>;
}): RoutedPath {
  const { sx, sy, tx, ty, laneMidOffset, primary, obstacles, ignoreNodeIds } = opts;

  const horizFirst = (midX: number): RoutedPath => [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ];

  const vertFirst = (midY: number): RoutedPath => [
    { x: sx, y: sy },
    { x: sx, y: midY },
    { x: tx, y: midY },
    { x: tx, y: ty },
  ];

  const ok = (pts: RoutedPath) => !polylineHitsNodeObstacles(pts, obstacles, ignoreNodeIds);

  const baseMidX = (sx + tx) / 2 + laneMidOffset;
  const baseMidY = (sy + ty) / 2 + laneMidOffset * 0.28;
  const STEP_X = 56;
  const STEP_Y = 52;
  const RINGS = 48;

  const tryStrategy = (which: 'horizontal' | 'vertical'): RoutedPath | null => {
    const base = which === 'horizontal' ? baseMidX : baseMidY;
    const step = which === 'horizontal' ? STEP_X : STEP_Y;
    const build = which === 'horizontal' ? horizFirst : vertFirst;
    for (let ring = 0; ring < RINGS; ring++) {
      const deltas = ring === 0 ? [0] : [ring * step, -ring * step];
      for (const d of deltas) {
        const pts = build(base + d);
        if (ok(pts)) return pts;
      }
    }
    return null;
  };

  const order: OrthogonalRoutingPrimary[] =
    primary === 'vertical' ? ['vertical', 'horizontal'] : ['horizontal', 'vertical'];
  for (const p of order) {
    const hit = tryStrategy(p === 'vertical' ? 'vertical' : 'horizontal');
    if (hit) return hit;
  }

  return primary === 'vertical' ? vertFirst(baseMidY) : horizFirst(baseMidX);
}

/**
 * Orthogonal Manhattan avoiding obstacles: grid A* first, then legacy 3-segment scan.
 */
export function orthogonalRouteAvoidingNodes(opts: {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  laneMidOffset: number;
  primary: OrthogonalRoutingPrimary;
  obstacles: LayoutObstacle[];
  ignoreNodeIds: Set<string>;
}): RoutedPath {
  const { sx, sy, tx, ty, laneMidOffset, primary, obstacles, ignoreNodeIds } = opts;

  const gridPath = orthogonalGridRoute({
    sx,
    sy,
    tx,
    ty,
    obstacles,
    ignoreNodeIds,
    primary,
  });
  if (gridPath && gridPath.length >= 2) {
    const hits = polylineHitsNodeObstacles(gridPath, obstacles, ignoreNodeIds);
    if (!hits) return gridPath;
  }

  return orthogonalRouteFallbackThreeSegment({
    sx,
    sy,
    tx,
    ty,
    laneMidOffset,
    primary,
    obstacles,
    ignoreNodeIds,
  });
}

/** @deprecated Prefer orthogonalRouteAvoidingNodes — kept for tests/callers until migrated */
export function orthogonalHorizontalFirstAvoidingNodes(opts: {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  laneMidOffset: number;
  obstacles: LayoutObstacle[];
  ignoreNodeIds: Set<string>;
}): RoutedPath {
  return orthogonalRouteAvoidingNodes({
    ...opts,
    primary: 'horizontal',
  });
}

function inflate(o: LayoutObstacle): { x: number; y: number; width: number; height: number } {
  const p = o.padding + EDGE_CLEARANCE;
  return {
    x: o.rect.x - p,
    y: o.rect.y - p,
    width: o.rect.width + p * 2,
    height: o.rect.height + p * 2,
  };
}

export function inflatedRectFromObstacle(o: LayoutObstacle): { x: number; y: number; width: number; height: number } {
  return inflate(o);
}

/** Segment–rectangle intersection (inclusive bounds). */
export function segmentHitsRect(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const { x: rx, y: ry, width: rw, height: rh } = rect;
  const inside =
    (p0.x >= rx && p0.x <= rx + rw && p0.y >= ry && p0.y <= ry + rh) ||
    (p1.x >= rx && p1.x <= rx + rw && p1.y >= ry && p1.y <= ry + rh);
  if (inside) return true;
  const edges = [
    [
      { x: rx, y: ry },
      { x: rx + rw, y: ry },
    ],
    [
      { x: rx + rw, y: ry },
      { x: rx + rw, y: ry + rh },
    ],
    [
      { x: rx + rw, y: ry + rh },
      { x: rx, y: ry + rh },
    ],
    [
      { x: rx, y: ry + rh },
      { x: rx, y: ry },
    ],
  ] as const;
  for (const [a, b] of edges) {
    if (segmentsIntersect(p0, p1, a, b)) return true;
  }
  return false;
}

function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function buildLayoutObstaclesFromGraph(
  graphNodes: SkillNodeV2[],
  groups: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  artifacts: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): LayoutObstacle[] {
  const obs: LayoutObstacle[] = [];
  for (const n of graphNodes) {
    obs.push({
      id: n.id,
      kind: 'node',
      rect: {
        x: n.ui?.x ?? 0,
        y: n.ui?.y ?? 0,
        width: n.ui?.width ?? 220,
        height: n.ui?.height ?? 96,
      },
      padding: 6,
    });
  }
  for (const g of groups) {
    obs.push({
      id: g.id,
      kind: 'group',
      rect: { x: g.x, y: g.y, width: g.w, height: g.h },
      padding: 10,
    });
  }
  for (const a of artifacts) {
    obs.push({
      id: a.id,
      kind: 'artifact',
      rect: { x: a.x, y: a.y, width: a.w, height: a.h },
      padding: 8,
    });
  }
  return obs;
}

/**
 * Simple orthogonal detour: try one bend midpoint offset perpendicular to main axis.
 */
export function routeOrthogonalAroundObstacles(
  source: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: LayoutObstacle[],
): RoutedPath {
  const inflated = obstacles.map(inflate);
  const directHits = () => inflated.some((r) => segmentHitsRect(source, target, r));

  if (!directHits()) {
    return [source, target];
  }

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const primary: OrthogonalRoutingPrimary =
    Math.abs(dy) >= Math.abs(dx) * 0.52 ? 'vertical' : 'horizontal';

  const gridPath = orthogonalGridRoute({
    sx: source.x,
    sy: source.y,
    tx: target.x,
    ty: target.y,
    obstacles,
    ignoreNodeIds: new Set(),
    primary,
  });
  if (gridPath && gridPath.length >= 2) return gridPath;

  const preferVerticalFirst = Math.abs(dy) > Math.abs(dx);
  const offset = EDGE_CLEARANCE * 3;

  const candidates: RoutedPath[] = [];

  if (preferVerticalFirst) {
    const midY = (source.y + target.y) / 2 + offset;
    candidates.push([
      source,
      { x: source.x, y: midY },
      { x: target.x, y: midY },
      target,
    ]);
    candidates.push([
      source,
      { x: source.x, y: midY - 2 * offset },
      { x: target.x, y: midY - 2 * offset },
      target,
    ]);
  } else {
    const midX = (source.x + target.x) / 2 + offset;
    candidates.push([
      source,
      { x: midX, y: source.y },
      { x: midX, y: target.y },
      target,
    ]);
    candidates.push([
      source,
      { x: midX - 2 * offset, y: source.y },
      { x: midX - 2 * offset, y: target.y },
      target,
    ]);
  }

  for (const path of candidates) {
    let ok = true;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      for (const r of inflated) {
        if (segmentHitsRect(a, b, r)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return path;
  }

  return [source, target];
}

export function validateEdgeRoutesDoNotHitObstacles(
  edges: { id: string; path: RoutedPath }[],
  obstacles: LayoutObstacle[],
): {
  ok: boolean;
  intersections: Array<{ edgeId: string; obstacleId: string; obstacleKind: LayoutObstacle['kind'] }>;
} {
  const intersections: Array<{ edgeId: string; obstacleId: string; obstacleKind: LayoutObstacle['kind'] }> = [];
  const inflated = obstacles.map((o) => ({ o, r: inflate(o) }));

  for (const e of edges) {
    for (let i = 0; i < e.path.length - 1; i++) {
      const a = e.path[i];
      const b = e.path[i + 1];
      for (const { o, r } of inflated) {
        if (segmentHitsRect(a, b, r)) {
          intersections.push({ edgeId: e.id, obstacleId: o.id, obstacleKind: o.kind });
        }
      }
    }
  }

  return { ok: intersections.length === 0, intersections };
}

/** Manhattan paths + lane stacking for parallel corridors (fast-board edges). */

import type { RoutedPath } from './skillFlowLayoutRouting';

/** Vertical bucketing for lane assignment (smaller → more buckets → less lane stacking per bucket). */
export const ROUTE_BUCKET_SIZE = 40;

/** Horizontal separation between lane centers at the middle elbow (px). */
export const ORTHOGONAL_LANE_STRIDE = 44;

/** Offset along source/target node edges so parallel routes attach at distinct Y (px). */
export const ORTHOGONAL_PORT_OFFSET = 18;

export type OrthogonalLaneAssignment = {
  laneIndex: number;
  peersInBucket: number;
};

export function assignOrthogonalEdgeLanes(
  edges: Array<{ id: string; midY: number }>,
): Map<string, OrthogonalLaneAssignment> {
  const buckets = new Map<number, string[]>();
  for (const e of edges) {
    const b = Math.round(e.midY / ROUTE_BUCKET_SIZE);
    const arr = buckets.get(b) ?? [];
    arr.push(e.id);
    buckets.set(b, arr);
  }
  const laneMap = new Map<string, OrthogonalLaneAssignment>();
  for (const ids of buckets.values()) {
    ids.sort();
    const peersInBucket = ids.length;
    ids.forEach((id, laneIndex) => {
      laneMap.set(id, { laneIndex, peersInBucket });
    });
  }
  return laneMap;
}

/** Horizontal-first Manhattan with perpendicular lane offset at the middle vertical segment. */
export function orthogonalPathHorizontalFirst(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  laneOffset: number,
): { x: number; y: number }[] {
  const midX = (sx + tx) / 2 + laneOffset;
  return [
    { x: sx, y: sy },
    { x: midX, y: sy },
    { x: midX, y: ty },
    { x: tx, y: ty },
  ];
}

/** Vertical-first Manhattan (good when attaching bottom→top). */
export function orthogonalPathVerticalFirst(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  laneMidYOffset: number,
): { x: number; y: number }[] {
  const midY = (sy + ty) / 2 + laneMidYOffset;
  return [
    { x: sx, y: sy },
    { x: sx, y: midY },
    { x: tx, y: midY },
    { x: tx, y: ty },
  ];
}

/** O(1) interactive path during drag — mid follows lane hint when provided via settled data. */
export function orthogonalInteractivePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneMidOffset = 0,
): { x: number; y: number }[] {
  const midX = (sourceX + targetX) / 2 + laneMidOffset;
  return [
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ];
}

const CORRIDOR_NUDGE_EPS = 8;
const CORRIDOR_SEP = 14;

/**
 * Spread overlapping interior horizontal (and vertical) segments so parallel wires stay distinct.
 * End segments (attached to nodes) are left unchanged.
 */
export function nudgeSeparatedOrthogonalPaths(paths: Map<string, RoutedPath>): Map<string, RoutedPath> {
  const result = new Map<string, RoutedPath>();
  for (const [id, p] of paths) {
    result.set(
      id,
      p.map((pt) => ({ x: pt.x, y: pt.y })),
    );
  }

  type HSeg = { eid: string; y: number; x0: number; x1: number; i: number };
  type VSeg = { eid: string; x: number; y0: number; y1: number; i: number };

  const hSegs: HSeg[] = [];
  const vSegs: VSeg[] = [];
  for (const [eid, p] of result) {
    for (let i = 0; i < p.length - 1; i++) {
      if (i === 0 || i >= p.length - 2) continue;
      const a = p[i];
      const b = p[i + 1];
      if (Math.abs(a.y - b.y) < 1e-6) {
        hSegs.push({
          eid,
          y: a.y,
          x0: Math.min(a.x, b.x),
          x1: Math.max(a.x, b.x),
          i,
        });
      }
      if (Math.abs(a.x - b.x) < 1e-6) {
        vSegs.push({
          eid,
          x: a.x,
          y0: Math.min(a.y, b.y),
          y1: Math.max(a.y, b.y),
          i,
        });
      }
    }
  }

  const overlapH = (a: HSeg, b: HSeg) =>
    Math.abs(a.y - b.y) <= CORRIDOR_NUDGE_EPS && !(a.x1 < b.x0 - 2 || b.x1 < a.x0 - 2);
  const overlapV = (a: VSeg, b: VSeg) =>
    Math.abs(a.x - b.x) <= CORRIDOR_NUDGE_EPS && !(a.y1 < b.y0 - 2 || b.y1 < a.y0 - 2);

  const mergeClusters = <T>(segs: T[], overlaps: (a: T, b: T) => boolean): T[][] => {
    let groups: T[][] = segs.map((s) => [s]);
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const gi = groups[i];
          const gj = groups[j];
          const touch = gi.some((a) => gj.some((b) => overlaps(a, b)));
          if (touch) {
            groups[i] = [...gi, ...gj];
            groups.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    return groups;
  };

  const hClusters = mergeClusters(hSegs, overlapH);
  for (const cl of hClusters) {
    if (cl.length < 2) continue;
    cl.sort((a, b) => a.eid.localeCompare(b.eid));
    cl.forEach((s, idx) => {
      const dy = (idx - (cl.length - 1) / 2) * CORRIDOR_SEP;
      if (Math.abs(dy) < 1e-6) return;
      const path = result.get(s.eid)!;
      path[s.i] = { ...path[s.i], y: path[s.i].y + dy };
      path[s.i + 1] = { ...path[s.i + 1], y: path[s.i + 1].y + dy };
    });
  }

  const vClusters = mergeClusters(vSegs, overlapV);
  for (const cl of vClusters) {
    if (cl.length < 2) continue;
    cl.sort((a, b) => a.eid.localeCompare(b.eid));
    cl.forEach((s, idx) => {
      const dx = (idx - (cl.length - 1) / 2) * CORRIDOR_SEP;
      if (Math.abs(dx) < 1e-6) return;
      const path = result.get(s.eid)!;
      path[s.i] = { ...path[s.i], x: path[s.i].x + dx };
      path[s.i + 1] = { ...path[s.i + 1], x: path[s.i + 1].x + dx };
    });
  }

  return result;
}

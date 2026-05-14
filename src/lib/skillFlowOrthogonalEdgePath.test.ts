import { describe, expect, it } from 'vitest';
import {
  assignOrthogonalEdgeLanes,
  ORTHOGONAL_LANE_STRIDE,
  orthogonalPathHorizontalFirst,
} from './skillFlowOrthogonalEdgePath';

describe('assignOrthogonalEdgeLanes', () => {
  it('gives parallel edges in the same bucket distinct midX via centered lane stride', () => {
    const midY = 100;
    const edges = [
      { id: 'e-a', midY },
      { id: 'e-b', midY },
      { id: 'e-c', midY },
    ];
    const lanes = assignOrthogonalEdgeLanes(edges);
    const sx = 400;
    const sy = 120;
    const tx = 600;
    const ty = 120;
    const midXs = edges.map((e) => {
      const a = lanes.get(e.id)!;
      const laneCentered = a.laneIndex - (a.peersInBucket - 1) / 2;
      const laneOffset = laneCentered * ORTHOGONAL_LANE_STRIDE;
      const pts = orthogonalPathHorizontalFirst(sx, sy, tx, ty, laneOffset);
      return pts[1]!.x;
    });
    expect(new Set(midXs).size).toBe(3);
    expect(midXs[1]! - midXs[0]!).toBeCloseTo(ORTHOGONAL_LANE_STRIDE, 5);
  });
});

import { describe, expect, it } from 'vitest';
import { filterObstaclesForEdge, type LayoutObstacle } from './skillFlowLayoutRouting';
import { orthogonalGridRoute } from './skillFlowOrthogonalGridRouter';

describe('filterObstaclesForEdge', () => {
  it('removes shared group frame when both endpoints are in that group', () => {
    const obstacles: LayoutObstacle[] = [
      { id: 'a', kind: 'node', rect: { x: 0, y: 0, width: 10, height: 10 }, padding: 0 },
      { id: 'rf-group-g1', kind: 'group', rect: { x: 0, y: 0, width: 100, height: 100 }, padding: 0 },
    ];
    const nodeToGroup = new Map<string, string>([
      ['a', 'g1'],
      ['b', 'g1'],
    ]);
    const out = filterObstaclesForEdge(obstacles, 'a', 'b', nodeToGroup);
    expect(out.some((o) => o.id === 'rf-group-g1')).toBe(false);
    expect(out.some((o) => o.id === 'a')).toBe(true);
  });

  it('keeps group frame when endpoints are in different groups', () => {
    const obstacles: LayoutObstacle[] = [
      { id: 'rf-group-g1', kind: 'group', rect: { x: 0, y: 0, width: 100, height: 100 }, padding: 0 },
    ];
    const nodeToGroup = new Map<string, string>([
      ['a', 'g1'],
      ['b', 'g2'],
    ]);
    const out = filterObstaclesForEdge(obstacles, 'a', 'b', nodeToGroup);
    expect(out.length).toBe(1);
  });
});

describe('orthogonalGridRoute', () => {
  it('returns axis-aligned path around a block', () => {
    const obstacles: LayoutObstacle[] = [
      {
        id: 'block',
        kind: 'node',
        rect: { x: 40, y: 0, width: 40, height: 200 },
        padding: 0,
      },
    ];
    const path = orthogonalGridRoute({
      sx: 0,
      sy: 20,
      tx: 200,
      ty: 20,
      obstacles,
      ignoreNodeIds: new Set(),
      primary: 'horizontal',
    });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    for (let i = 0; i < path!.length - 1; i++) {
      const a = path![i];
      const b = path![i + 1];
      const axisAligned = Math.abs(a.x - b.x) < 1e-3 || Math.abs(a.y - b.y) < 1e-3;
      expect(axisAligned).toBe(true);
    }
  });
});

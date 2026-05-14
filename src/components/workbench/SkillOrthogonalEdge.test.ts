import { describe, expect, it } from 'vitest';
import { roundedPolylinePath, simplifyRoutedPoints } from './SkillOrthogonalEdge';

describe('SkillOrthogonalEdge path smoothing', () => {
  it('keeps first and last points while rounding corners', () => {
    const path = roundedPolylinePath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 90, y: 40 },
    ]);

    expect(path.startsWith('M 0 0')).toBe(true);
    expect(path.endsWith('L 90 40')).toBe(true);
    expect(path).toContain(' Q ');
  });

  it('removes duplicate and collinear micro segments before rendering', () => {
    const points = simplifyRoutedPoints([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.3 },
      { x: 40, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
    ]);

    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 30 },
    ]);
  });
});

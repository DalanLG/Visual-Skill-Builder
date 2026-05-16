import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SkillOrthogonalEdge, { roundedPolylinePath, simplifyRoutedPoints } from './SkillOrthogonalEdge';

function edgeMarkup(data?: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(SkillOrthogonalEdge, {
      id: 'edge-a',
      source: 'a',
      target: 'b',
      sourceX: 0,
      sourceY: 0,
      targetX: 120,
      targetY: 0,
      sourcePosition: 'right',
      targetPosition: 'left',
      markerEnd: undefined,
      markerStart: undefined,
      interactionWidth: 20,
      style: { stroke: '#8fd3e8', strokeWidth: 3 },
      data,
    } as never),
  );
}

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

  it('renders a play-mode packet with animateMotion when trace flow is active', () => {
    const html = edgeMarkup({
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
      renderMode: 'settled',
      traceFlow: 'active',
      tracePacketIndex: 2,
    });

    expect(html).toContain('skill-flow-packet-layer');
    expect(html).toContain('skill-flow-packet-layer--active');
    expect(html).toContain('animateMotion');
    expect(html).toContain('dur="1.25s"');
  });

  it('does not render packet markup without trace flow data', () => {
    const html = edgeMarkup({
      points: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
      ],
      renderMode: 'settled',
    });

    expect(html).not.toContain('skill-flow-packet-layer');
    expect(html).not.toContain('animateMotion');
  });
});

import { describe, expect, it } from 'vitest';
import { detectOneLongStringLayout } from './skillFlowLayoutQuality';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

function lineGraph(nodeCount: number): SkillFlowGraphV2 {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    label: `S${i}`,
    kind: 'step' as const,
    ui: { x: i * 280, y: 100, width: 220, height: 96 },
  }));
  const edges = [];
  for (let i = 0; i < nodeCount - 1; i++) {
    edges.push({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      kind: 'sequence' as const,
    });
  }
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'g-line',
    name: 'Line',
    nodes,
    edges,
  };
}

describe('detectOneLongStringLayout', () => {
  it('flags many nodes in a narrow horizontal band', () => {
    expect(detectOneLongStringLayout(lineGraph(12))).toBe(true);
  });

  it('returns false for small graphs', () => {
    expect(detectOneLongStringLayout(lineGraph(4))).toBe(false);
  });
});

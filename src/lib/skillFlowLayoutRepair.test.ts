import { describe, expect, it } from 'vitest';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import { CURRENT_SKILL_BOARD_LAYOUT_VERSION } from './skillFlowBoardLayout';
import { repairSkillGraphLayoutIfNeeded } from './skillFlowLayoutRepair';

function minimalGraph(): SkillFlowGraphV2 {
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'x',
    name: 'T',
    nodes: [
      {
        id: 'a',
        label: 'Goal',
        kind: 'goal',
        ui: { x: 0, y: 0, width: 220, height: 96 },
      },
      {
        id: 'b',
        label: 'Out',
        kind: 'output',
        ui: { x: 5000, y: 0, width: 220, height: 96 },
      },
    ],
    edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'sequence' }],
    layout: {
      strategy: 'fast',
      orientation: 'left-to-right',
      layoutAlgorithmVersion: CURRENT_SKILL_BOARD_LAYOUT_VERSION,
    },
  };
}

describe('repairSkillGraphLayoutIfNeeded', () => {
  it('repairs when layoutAlgorithmVersion is missing', () => {
    const g = minimalGraph();
    delete g.layout!.layoutAlgorithmVersion;
    const r = repairSkillGraphLayoutIfNeeded(g);
    expect(r.changed).toBe(true);
    expect(r.graph.layout?.strategy).toBe('fast-board');
    expect(r.graph.layout?.layoutAlgorithmVersion).toBe(CURRENT_SKILL_BOARD_LAYOUT_VERSION);
  });
});

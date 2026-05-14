import { describe, expect, it } from 'vitest';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import {
  BAD_LAYOUT_NODE_THRESHOLD,
  buildFastBoardSkillLayoutPlan,
  computeFastBoardPositions,
  CURRENT_SKILL_BOARD_LAYOUT_VERSION,
} from './skillFlowBoardLayout';

function sampleGraph(nodeCount: number): SkillFlowGraphV2 {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    label: `Step ${i}`,
    kind: i === 0 ? ('goal' as const) : i === nodeCount - 1 ? ('output' as const) : ('step' as const),
    ui: { x: 0, y: 0, width: 220, height: 96 },
  }));
  const edges = [];
  for (let i = 0; i < nodeCount - 1; i++) {
    edges.push({
      id: `e${i}-${i + 1}`,
      source: `n${i}`,
      target: `n${i + 1}`,
      kind: 'sequence' as const,
    });
  }
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'g1',
    name: 'Test',
    nodes,
    edges,
  };
}

describe('skillFlowBoardLayout', () => {
  it('uses >=2 rows in main band when node count exceeds threshold', () => {
    const g = sampleGraph(BAD_LAYOUT_NODE_THRESHOLD + 2);
    const plan = buildFastBoardSkillLayoutPlan(g);
    const laid = computeFastBoardPositions(g, plan, { preserveManualPositions: false });
    const ys = laid.nodes.map((n) => n.ui?.y ?? 0);
    const uniq = new Set(ys.map((y) => Math.round(y / 20)));
    expect(uniq.size).toBeGreaterThanOrEqual(2);
  });

  it('stacks two output nodes in one column (same x, different y)', () => {
    const g: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'g-out',
      name: 'Two outputs',
      nodes: [
        { id: 'g', label: 'G', kind: 'goal', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 's', label: 'S', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'o1', label: 'O1', kind: 'output', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'o2', label: 'O2', kind: 'output', ui: { x: 0, y: 0, width: 220, height: 96 } },
      ],
      edges: [
        { id: 'e1', source: 'g', target: 's', kind: 'sequence' },
        { id: 'e2', source: 's', target: 'o1', kind: 'sequence' },
      ],
    };
    const plan = buildFastBoardSkillLayoutPlan(g);
    const laid = computeFastBoardPositions(g, plan, { preserveManualPositions: false });
    const o1 = laid.nodes.find((n) => n.id === 'o1')!;
    const o2 = laid.nodes.find((n) => n.id === 'o2')!;
    expect(Math.abs((o1.ui?.x ?? 0) - (o2.ui?.x ?? 0))).toBeLessThan(2);
    expect(Math.abs((o1.ui?.y ?? 0) - (o2.ui?.y ?? 0))).toBeGreaterThan(40);
  });

  it('places a step with groupId fb-rules in the rules group', () => {
    const g: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'g-pin',
      name: 'Pin',
      nodes: [
        { id: 'g', label: 'G', kind: 'goal', ui: { x: 0, y: 0, width: 220, height: 96 } },
        {
          id: 'r',
          label: 'In workflow kind but pinned',
          kind: 'step',
          groupId: 'fb-rules',
          ui: { x: 0, y: 0, width: 220, height: 96 },
        },
      ],
      edges: [],
    };
    const plan = buildFastBoardSkillLayoutPlan(g);
    const rules = plan.groups.find((x) => x.id === 'fb-rules');
    expect(rules?.nodeIds).toContain('r');
    const main = plan.groups.find((x) => x.id === 'fb-main');
    expect(main?.nodeIds ?? []).not.toContain('r');
  });

  it('tags layout algorithm version on engine output', async () => {
    const { mergeLayoutPlanIntoGraph } = await import('./skillFlowApplyLayoutPlan');
    const g = sampleGraph(4);
    const plan = buildFastBoardSkillLayoutPlan(g);
    const merged = mergeLayoutPlanIntoGraph(g, plan, 'fast-board', false);
    const { runFastBoardLayoutEngine } = await import('./skillFlowBoardLayout');
    const out = runFastBoardLayoutEngine(merged, false);
    expect(out.layout?.layoutAlgorithmVersion).toBe(CURRENT_SKILL_BOARD_LAYOUT_VERSION);
    expect(out.layout?.strategy).toBe('fast-board');
  });
});

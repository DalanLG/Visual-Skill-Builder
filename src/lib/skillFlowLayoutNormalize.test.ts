import { describe, expect, it } from 'vitest';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import { buildFastSkillLayoutPlan } from './skillFlowFastLayout';
import { validateSkillLayoutPlan } from './skillFlowLayoutValidation';
import {
  normalizeDataArtifactsForGraph,
  normalizeSkillLayoutPlanForGraph,
} from './skillFlowLayoutNormalize';

const tinyGraph = (): SkillFlowGraphV2 => ({
  version: SKILL_FLOW_GRAPH_V2_VERSION,
  id: 'skill-graph-a',
  name: 'Tiny',
  nodes: [
    { id: 'n1', label: 'Goal', kind: 'goal' },
    { id: 'n2', label: 'Step', kind: 'step' },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', kind: 'sequence' }],
});

describe('normalizeDataArtifactsForGraph', () => {
  it('maps producerIds to producedBy and keeps consumedBy', () => {
    const g = tinyGraph();
    const ids = new Set(g.nodes.map((n) => n.id));
    const raw = [
      {
        id: 'layout-artifact:test',
        label: 'Artifact',
        producerIds: ['n1'],
        consumedBy: ['n2'],
      },
    ];
    const out = normalizeDataArtifactsForGraph(raw, ids);
    expect(out?.length).toBe(1);
    expect(out?.[0]?.producedBy).toEqual(['n1']);
    expect(out?.[0]?.consumedBy).toEqual(['n2']);
    expect(out?.[0]?.visual.colorKey).toBe('artifact');
    expect(out?.[0]?.exportBehavior).toBe('visual-only');
  });
});

describe('normalizeSkillLayoutPlanForGraph', () => {
  it('fills missing branchPaths.startNodeId from nodeIds so validation passes', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const broken: SkillLayoutPlanV2 = {
      ...base,
      branchPaths: [
        {
          id: 'b1',
          label: 'Alt',
          startNodeId: undefined as unknown as string,
          nodeIds: ['n1', 'n2'],
          placement: 'parallel',
        },
      ],
    };

    const before = validateSkillLayoutPlan(broken, g);
    expect(before.ok).toBe(false);

    const fixed = normalizeSkillLayoutPlanForGraph(broken, g);
    const after = validateSkillLayoutPlan(fixed, g);
    expect(after.ok).toBe(true);
    expect(fixed.branchPaths?.[0]?.startNodeId).toBe('n1');
  });

  it('drops branchPaths that cannot be fixed', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const broken: SkillLayoutPlanV2 = {
      ...base,
      branchPaths: [
        {
          id: 'b1',
          label: 'Bad',
          startNodeId: undefined as unknown as string,
          nodeIds: [],
          placement: 'parallel',
        },
      ],
    };

    const fixed = normalizeSkillLayoutPlanForGraph(broken, g);
    expect(fixed.branchPaths).toBeUndefined();
    expect(validateSkillLayoutPlan(fixed, g).ok).toBe(true);
  });

  it('tolerates missing mainPath (Codex partial JSON)', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const broken = { ...base, mainPath: undefined as unknown as string[] } as SkillLayoutPlanV2;
    const fixed = normalizeSkillLayoutPlanForGraph(broken, g);
    expect(fixed.mainPath).toEqual([]);
  });

  it('tolerates groups with missing nodeIds', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const groups = base.groups.map((gr, i) =>
      i === 0 ? { ...gr, nodeIds: undefined as unknown as string[] } : gr,
    );
    const broken = { ...base, groups } as SkillLayoutPlanV2;
    expect(() => normalizeSkillLayoutPlanForGraph(broken, g)).not.toThrow();
  });
});

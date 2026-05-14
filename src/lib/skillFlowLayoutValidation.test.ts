import { describe, expect, it } from 'vitest';
import { buildFastSkillLayoutPlan } from './skillFlowFastLayout';
import { SKILL_LAYOUT_PLAN_V2_VERSION } from './skillFlowLayoutPlanV2';
import { SKILL_LAYOUT_PLAN_V3_VERSION } from './skillFlowLayoutPlanV3';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import { validateSkillLayoutPlan } from './skillFlowLayoutValidation';

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

describe('validateSkillLayoutPlan', () => {
  it('accepts fast heuristic plan for a minimal graph', () => {
    const g = tinyGraph();
    const plan = buildFastSkillLayoutPlan(g);
    const r = validateSkillLayoutPlan(plan, g);
    expect(r.ok).toBe(true);
  });

  it('errors when graphId mismatches', () => {
    const g = tinyGraph();
    const plan = buildFastSkillLayoutPlan(g);
    plan.graphId = 'other-id';
    const r = validateSkillLayoutPlan(plan, g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'graph_id_mismatch')).toBe(true);
  });

  it('accepts V3 plan with valid centerNodeId', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const plan = {
      ...base,
      version: SKILL_LAYOUT_PLAN_V3_VERSION,
      strategy: 'radial-spider-map' as const,
      centerNodeId: 'n1',
    };
    const r = validateSkillLayoutPlan(plan, g);
    expect(r.ok).toBe(true);
  });

  it('errors when V3 centerNodeId is unknown', () => {
    const g = tinyGraph();
    const base = buildFastSkillLayoutPlan(g);
    const plan = {
      ...base,
      version: SKILL_LAYOUT_PLAN_V3_VERSION,
      strategy: 'radial-spider-map' as const,
      centerNodeId: 'missing',
    };
    const r = validateSkillLayoutPlan(plan, g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'center_unknown')).toBe(true);
  });

  it('errors on wrong version', () => {
    const g = tinyGraph();
    const plan = buildFastSkillLayoutPlan(g);
    (plan as { version: string }).version = '0.9';
    const r = validateSkillLayoutPlan(plan, g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'bad_version')).toBe(true);
    expect(plan.version).not.toBe(SKILL_LAYOUT_PLAN_V2_VERSION);
  });
});

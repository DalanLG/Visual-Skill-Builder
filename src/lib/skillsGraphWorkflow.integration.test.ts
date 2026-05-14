/**
 * End-to-end data pipeline (no browser): import-style graph → fast-board → RF projection.
 * Guards regressions like missing imports in skillFlowRf (buildLayoutObstaclesFromGraph).
 */
import { describe, expect, it } from 'vitest';
import { applySkillLayoutPlan } from './skillFlowApplyLayoutPlan';
import { mergeInferredArtifactsIntoPlan } from './skillFlowArtifactInference';
import { buildFastBoardSkillLayoutPlan } from './skillFlowBoardLayout';
import { SKILL_ARTIFACT_RF_TYPE, skillGraphToReactFlow } from './skillFlowRf';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

function minimalSkillGraph(): SkillFlowGraphV2 {
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'e2e-g',
    name: 'E2E Skill',
    nodes: [
      { id: 'g', label: 'Goal', kind: 'goal', ui: { x: 0, y: 0, width: 220, height: 96 } },
      { id: 's', label: 'Step', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
      { id: 'o', label: 'Done', kind: 'output', ui: { x: 0, y: 0, width: 220, height: 96 } },
    ],
    edges: [
      { id: 'e1', source: 'g', target: 's', kind: 'sequence' },
      { id: 'e2', source: 's', target: 'o', kind: 'sequence' },
    ],
  };
}

describe('skills graph workflow (integration)', () => {
  it('fast-board apply → React Flow conversion completes without throw', async () => {
    const base = minimalSkillGraph();
    const plan = buildFastBoardSkillLayoutPlan(base);

    const viaApply = await applySkillLayoutPlan(base, plan, {
      preserveManualPositions: false,
      strategy: 'fast-board',
    });
    expect(viaApply.layout?.strategy).toBe('fast-board');
    expect(viaApply.nodes.every((n) => n.ui?.x !== undefined && n.ui?.y !== undefined)).toBe(true);

    const { nodes, edges } = skillGraphToReactFlow(viaApply, null, []);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(edges.length).toBe(2);
    expect(edges.every((e) => e.type === 'skillOrthogonal')).toBe(true);
    expect(edges.every((e) => typeof e.sourceHandle === 'string' && typeof e.targetHandle === 'string')).toBe(true);
    expect(
      edges.every(
        (e) =>
          typeof e.markerEnd === 'object' &&
          e.markerEnd !== null &&
          'id' in e.markerEnd &&
          typeof (e.markerEnd as { id?: string }).id === 'string',
      ),
    ).toBe(true);
  });

  it('infers variable artifacts into layout plan and exposes artifact RF nodes when enabled', async () => {
    const base: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'e2e-art',
      name: 'Fanout',
      nodes: [
        { id: 'g', label: 'Goal', kind: 'goal', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 's', label: 'Step', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'b', label: 'B', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
      ],
      edges: [
        { id: 'seq', source: 'g', target: 's', kind: 'sequence' },
        { id: 'd1', source: 's', target: 'a', kind: 'depends_on' },
        { id: 'd2', source: 's', target: 'b', kind: 'depends_on' },
      ],
    };
    let plan = buildFastBoardSkillLayoutPlan(base);
    plan = mergeInferredArtifactsIntoPlan(plan, base);
    expect(plan.dataArtifacts?.length).toBeGreaterThan(0);

    const viaApply = await applySkillLayoutPlan(base, plan, {
      preserveManualPositions: false,
      strategy: 'fast-board',
    });
    const { nodes, edges } = skillGraphToReactFlow(viaApply, null, [], { showVariables: true });
    expect(nodes.some((n) => n.type === SKILL_ARTIFACT_RF_TYPE)).toBe(true);
    expect(edges.some((e) => typeof e.id === 'string' && e.id.startsWith('rf-var-'))).toBe(true);
  });
});

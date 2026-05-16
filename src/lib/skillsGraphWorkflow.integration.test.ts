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
import { RESPONSE_EDGE_STROKE, VARIABLE_READ_EDGE_STROKE, VARIABLE_WRITE_EDGE_STROKE } from './skillFlowEdgeStyles';

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

  it('colors response-target graph edges purple even without layout metadata', () => {
    const graph: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'response-colors',
      name: 'Response colors',
      nodes: [
        { id: 's', label: 'Step', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'response', label: 'Response', kind: 'response', ui: { x: 360, y: 0, width: 220, height: 96 } },
      ],
      edges: [
        { id: 'to-response', source: 's', target: 'response', kind: 'depends_on', ui: { semanticKind: 'dependency' } },
      ],
    };

    const { edges } = skillGraphToReactFlow(graph, null, []);
    expect(edges.find((e) => e.id === 'to-response')?.style).toMatchObject({
      stroke: RESPONSE_EDGE_STROKE,
    });
  });

  it('colors generated artifact edges into the response purple', async () => {
    const graph: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'response-artifact-colors',
      name: 'Response artifact colors',
      nodes: [
        { id: 's', label: 'Step', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'response', label: 'Response', kind: 'response', ui: { x: 360, y: 0, width: 220, height: 96 } },
      ],
      edges: [],
    };
    const plan = {
      ...buildFastBoardSkillLayoutPlan(graph),
      dataArtifacts: [
        {
          id: 'artifact-final',
          label: 'Final evidence',
          kind: 'output-draft' as const,
          producedBy: ['s'],
          consumedBy: ['response'],
          visual: { colorKey: 'artifact' as const, emphasis: 'secondary' as const },
          exportBehavior: 'visual-only' as const,
        },
      ],
    };
    const laid = await applySkillLayoutPlan(graph, plan, {
      preserveManualPositions: false,
      strategy: 'fast-board',
    });

    const { edges } = skillGraphToReactFlow(laid, null, [], { showVariables: true });
    const responseArtifactEdge = edges.find((e) => e.id === 'rf-var-read:artifact-final:response');
    expect(responseArtifactEdge?.style).toMatchObject({
      stroke: RESPONSE_EDGE_STROKE,
      strokeWidth: 3.35,
      opacity: 1,
    });
    expect(responseArtifactEdge?.style?.strokeDasharray).toBeUndefined();
  });

  it('preserves data read/write edge colors after applying fast-board layout', async () => {
    const graph: SkillFlowGraphV2 = {
      version: SKILL_FLOW_GRAPH_V2_VERSION,
      id: 'data-colors',
      name: 'Data colors',
      nodes: [
        { id: 's', label: 'Step', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        {
          id: 'var-notes',
          label: 'Notes',
          kind: 'variable',
          variable: { variableName: '$notes', label: 'Notes' },
          ui: { x: 260, y: 0, width: 220, height: 96 },
        },
        { id: 'use', label: 'Use notes', kind: 'step', ui: { x: 520, y: 0, width: 220, height: 96 } },
        { id: 'response', label: 'Response', kind: 'response', ui: { x: 780, y: 0, width: 220, height: 96 } },
      ],
      edges: [
        { id: 'write', source: 's', target: 'var-notes', kind: 'depends_on', ui: { semanticKind: 'data_write' } },
        { id: 'read', source: 'var-notes', target: 'use', kind: 'depends_on', ui: { semanticKind: 'data_read' } },
        { id: 'respond', source: 'use', target: 'response', kind: 'sequence' },
      ],
    };
    const plan = buildFastBoardSkillLayoutPlan(graph);
    const laid = await applySkillLayoutPlan(graph, plan, {
      preserveManualPositions: false,
      strategy: 'fast-board',
    });

    expect(laid.edges.find((e) => e.id === 'write')?.ui?.semanticKind).toBe('data_write');
    expect(laid.edges.find((e) => e.id === 'read')?.ui?.semanticKind).toBe('data_read');

    const { edges } = skillGraphToReactFlow(laid, null, []);
    expect(edges.find((e) => e.id === 'write')?.style).toMatchObject({ stroke: VARIABLE_WRITE_EDGE_STROKE });
    expect(edges.find((e) => e.id === 'read')?.style).toMatchObject({ stroke: VARIABLE_READ_EDGE_STROKE });
    expect(edges.find((e) => e.id === 'respond')?.style).toMatchObject({ stroke: RESPONSE_EDGE_STROKE });
  });
});

import { describe, expect, it } from 'vitest';
import { inferDataArtifactsForGraph } from './skillFlowArtifactInference';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

function hubFanGraph(): SkillFlowGraphV2 {
  const nodes = [
    { id: 'hub', label: 'Hub', kind: 'step' as const },
    { id: 't1', label: 'T1', kind: 'step' as const },
    { id: 't2', label: 'T2', kind: 'step' as const },
    { id: 't3', label: 'T3', kind: 'step' as const },
  ];
  const edges = [
    { id: 'e1', source: 'hub', target: 't1', kind: 'depends_on' as const },
    { id: 'e2', source: 'hub', target: 't2', kind: 'depends_on' as const },
    { id: 'e3', source: 'hub', target: 't3', kind: 'depends_on' as const },
  ];
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'g-hub',
    name: 'Hub fan',
    nodes,
    edges,
  };
}

describe('inferDataArtifactsForGraph', () => {
  it('creates a layout artifact when depends_on fan-out is large enough', () => {
    const inferred = inferDataArtifactsForGraph(hubFanGraph());
    expect(inferred?.length).toBeGreaterThanOrEqual(1);
    expect(inferred?.[0]?.producedBy).toContain('hub');
    expect(inferred?.[0]?.consumedBy?.length).toBe(3);
  });
});

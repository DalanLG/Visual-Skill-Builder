import { describe, expect, it } from 'vitest';
import { validateSkillFlowGraphV2 } from './skillFlowValidation';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

const base = (): SkillFlowGraphV2 => ({
  version: SKILL_FLOW_GRAPH_V2_VERSION,
  id: 'g1',
  name: 'G',
  nodes: [
    { id: 'a', label: 'A', kind: 'step', contract: { purpose: 'Do A', inputs: [], instructions: ['Do A'], outputs: ['A'], checks: [], failureModes: [], examples: [], reads: [], writes: [] } },
    { id: 'response', label: 'Response', kind: 'response', contract: { purpose: 'Reply', inputs: ['A'], instructions: ['Reply'], outputs: ['Final response'], checks: [], failureModes: [], examples: [], reads: [], writes: [] }, responseSpec: { audience: 'user', format: 'markdown', mustMentionArtifacts: [], mustNotClaimWithoutEvidence: true, missingDataBehavior: 'state_missing', tone: 'direct', requiredSections: [], citationPolicy: 'artifact_only' } },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'response', kind: 'sequence', ui: { semanticKind: 'main_flow' } }],
});

describe('validateSkillFlowGraphV2', () => {
  it('flags duplicate node ids', () => {
    const g: SkillFlowGraphV2 = {
      ...base(),
      nodes: [
        { id: 'dup', label: 'One', kind: 'step' },
        { id: 'dup', label: 'Two', kind: 'step' },
      ],
    };
    const r = validateSkillFlowGraphV2(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'duplicate_node_id')).toBe(true);
  });

  it('passes minimal valid graph', () => {
    const r = validateSkillFlowGraphV2(base());
    expect(r.ok).toBe(true);
  });

  it('blocks response outgoing edges', () => {
    const g: SkillFlowGraphV2 = {
      ...base(),
      nodes: [...base().nodes, { id: 'after', label: 'After', kind: 'step' }],
      edges: [...base().edges, { id: 'bad', source: 'response', target: 'after', kind: 'sequence' }],
    };
    const r = validateSkillFlowGraphV2(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'response_has_outgoing' && i.severity === 'error')).toBe(true);
  });

  it('requires data_read edges to source from variable artifacts', () => {
    const g: SkillFlowGraphV2 = {
      ...base(),
      edges: [...base().edges, { id: 'bad-read', source: 'a', target: 'response', kind: 'depends_on', ui: { semanticKind: 'data_read' } }],
    };
    const r = validateSkillFlowGraphV2(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'data_read_source_not_variable')).toBe(true);
  });
});

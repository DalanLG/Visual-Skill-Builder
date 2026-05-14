import { describe, expect, it } from 'vitest';
import { buildSkillTraceSteps } from './skillFlowTrace';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

describe('buildSkillTraceSteps', () => {
  it('places response after variable producers and consumers', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 'Trace response test',
      nodes: [
        { id: 'producer', label: 'Produce report', kind: 'step', layer: 1 },
        { id: 'variable', label: 'Report', kind: 'variable', variable: { variableName: '$report' } },
        { id: 'consumer', label: 'Use report', kind: 'step', layer: 3 },
        { id: 'response', label: 'Response', kind: 'response', layer: 2 },
      ],
      edges: [
        { id: 'write', source: 'producer', target: 'variable', kind: 'depends_on', ui: { semanticKind: 'data_write' } },
        { id: 'read-consumer', source: 'variable', target: 'consumer', kind: 'depends_on', ui: { semanticKind: 'data_read' } },
        { id: 'read-response', source: 'variable', target: 'response', kind: 'depends_on', ui: { semanticKind: 'data_read', layoutColorKey: 'response' } },
      ],
    };

    const steps = buildSkillTraceSteps(graph);
    expect(steps.map((s) => s.nodeId)).toEqual(['producer', 'consumer', 'response']);
    expect(steps[2].readEdgeIds).toContain('read-response');
  });
});

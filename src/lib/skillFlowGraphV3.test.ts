import { describe, expect, it } from 'vitest';
import {
  normalizeSkillFlowGraphAny,
  skillFlowGraphV2ToV3,
  SKILL_FLOW_GRAPH_V2_VERSION,
  type SkillFlowGraphV2,
  type SkillFlowGraphV3,
} from './skillFlowGraphV2';

function v2Graph(): SkillFlowGraphV2 {
  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: 'g1',
    name: 'Research Skill',
    description: 'Research a topic and respond.',
    nodes: [
      {
        id: 'research',
        label: 'Research',
        kind: 'step',
        contract: {
          purpose: 'Research the topic.',
          inputs: ['Topic'],
          instructions: ['Collect evidence.'],
          outputs: ['Research notes'],
          checks: ['Evidence is cited.'],
          failureModes: ['Source unavailable.'],
          examples: [],
          reads: [],
          writes: ['$notes'],
        },
      },
      {
        id: 'notes',
        label: 'Notes',
        kind: 'variable',
        variable: {
          variableName: '$notes',
          label: 'Notes',
          dataType: 'markdown',
          artifactKind: 'notes',
          storage: 'workspace-file',
          pathTemplate: '.codex/skill-runs/{skillSlug}/{runId}/notes.md',
          exportBehavior: 'include-in-markdown',
        },
      },
      {
        id: 'response',
        label: 'Response',
        kind: 'response',
        contract: {
          purpose: 'Return the answer.',
          inputs: ['$notes'],
          instructions: ['Summarize findings.'],
          outputs: ['Final response'],
          checks: [],
          failureModes: [],
          examples: [],
          reads: ['$notes'],
          writes: [],
        },
      },
    ],
    edges: [
      { id: 'ew', source: 'research', target: 'notes', kind: 'depends_on', ui: { semanticKind: 'data_write' } },
      { id: 'er', source: 'notes', target: 'response', kind: 'depends_on', ui: { semanticKind: 'data_read' } },
    ],
  };
}

describe('SkillFlowGraphV3 conversion', () => {
  it('exports a V3 envelope with canonical artifact dataflow', () => {
    const v3 = skillFlowGraphV2ToV3(v2Graph());
    expect(v3.schemaVersion).toBe('SkillFlowGraphV3');
    expect(v3.graph.responseNodeId).toBe('response');
    expect(v3.graph.nodes.find((n) => n.id === 'notes')?.kind).toBe('artifact');
    expect(v3.graph.edges.some((e) => e.semanticKind === 'data_write')).toBe(true);
    expect(v3.graph.edges.some((e) => e.semanticKind === 'data_read')).toBe(true);
  });

  it('loads V3 graphs back into editor-compatible V2', () => {
    const v3: SkillFlowGraphV3 = skillFlowGraphV2ToV3(v2Graph());
    const loaded = normalizeSkillFlowGraphAny(v3);
    expect(loaded?.version).toBe('2.0');
    expect(loaded?.nodes.find((n) => n.id === 'notes')?.kind).toBe('variable');
    expect(loaded?.nodes.find((n) => n.id === 'notes')?.artifactSpec?.provenance.generatedBy).toEqual(['research']);
  });
});

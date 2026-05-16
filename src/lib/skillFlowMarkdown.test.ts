import { describe, expect, it } from 'vitest';
import { graphToSkillMarkdown } from './skillFlowMarkdown';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

const minimalGraph = (): SkillFlowGraphV2 => ({
  version: SKILL_FLOW_GRAPH_V2_VERSION,
  id: 'test-id',
  name: 'Test Skill',
  nodes: [
    {
      id: 'b',
      label: 'B',
      kind: 'step',
      summary: 'second',
    },
    {
      id: 'a',
      label: 'A',
      kind: 'goal',
      summary: 'first',
    },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'sequence' }],
});

describe('graphToSkillMarkdown', () => {
  it('produces identical output for the same graph', () => {
    const g = minimalGraph();
    const a = graphToSkillMarkdown(g);
    const b = graphToSkillMarkdown(g);
    expect(a).toBe(b);
  });

  it('sorts deterministically (nodes by kind order then id)', () => {
    const md = graphToSkillMarkdown(minimalGraph());
    expect(md.indexOf('### 1. A')).toBeLessThan(md.indexOf('### 2. B'));
  });

  it('exports variable artifacts with producer and consumer instructions', () => {
    const g: SkillFlowGraphV2 = {
      ...minimalGraph(),
      nodes: [
        ...minimalGraph().nodes,
        {
          id: 'v1',
          label: 'Lead deep research report',
          kind: 'variable',
          variable: {
            variableName: '$lead_deep_research_report',
            label: 'Lead deep research report',
            dataType: 'markdown',
            artifactKind: 'research-report',
            storage: 'workspace-file',
            pathTemplate: '.codex/skill-runs/{skillSlug}/{runId}/lead_deep_research_report.md',
            producedBy: ['a'],
            consumedBy: ['b'],
            exportBehavior: 'include-in-markdown',
          },
        },
      ],
      edges: [
        ...minimalGraph().edges,
        { id: 'ew', source: 'a', target: 'v1', kind: 'depends_on', ui: { semanticKind: 'data_write' } },
        { id: 'er', source: 'v1', target: 'b', kind: 'depends_on', ui: { semanticKind: 'data_read' } },
      ],
    };
    const md = graphToSkillMarkdown(g);
    expect(md).toContain('## Variables / Artifacts');
    expect(md).toContain('$lead_deep_research_report');
    expect(md).toContain('Created by: A');
    expect(md).toContain('Used by: B');
  });

  it('exports routable activation and final response sections without canvas metadata', () => {
    const md = graphToSkillMarkdown({
      ...minimalGraph(),
      nodes: [
        ...minimalGraph().nodes,
        {
          id: 'response',
          label: 'Response',
          kind: 'response',
          responseSpec: {
            audience: 'user',
            format: 'markdown',
            mustMentionArtifacts: [],
            mustNotClaimWithoutEvidence: true,
            missingDataBehavior: 'state_missing',
            tone: 'direct',
            requiredSections: [],
            citationPolicy: 'artifact_only',
          },
        },
      ],
      edges: [...minimalGraph().edges, { id: 'eresp', source: 'b', target: 'response', kind: 'sequence' }],
    });
    expect(md).toContain('## Use when');
    expect(md).toContain("## Don't use when");
    expect(md).toContain('## Final Response');
    expect(md).not.toContain('x:');
    expect(md).not.toContain('manuallyPositioned');
  });
});

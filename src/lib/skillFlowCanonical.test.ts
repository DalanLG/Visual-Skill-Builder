import { describe, expect, it } from 'vitest';
import { canonicalizeSkillGraph } from './skillFlowCanonical';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

describe('canonicalizeSkillGraph response node', () => {
  it('adds one terminal response node and connects terminal workflow nodes to it', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 'Response test',
      nodes: [
        { id: 'goal', label: 'Goal', kind: 'goal', layer: 0 },
        { id: 'step', label: 'Do work', kind: 'step', layer: 1 },
        { id: 'out', label: 'Prepared answer', kind: 'output', layer: 2 },
      ],
      edges: [
        { id: 'e1', source: 'goal', target: 'step', kind: 'sequence' },
        { id: 'e2', source: 'step', target: 'out', kind: 'sequence' },
      ],
    };

    const next = canonicalizeSkillGraph(graph);
    const responses = next.nodes.filter((n) => n.kind === 'response');
    expect(responses).toHaveLength(1);
    expect(responses[0].label).toBe('Response');
    expect(next.edges.some((e) => e.source === 'out' && e.target === responses[0].id)).toBe(true);
  });

  it('connects final variables into the response as data reads', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 'Variable response test',
      nodes: [
        { id: 'step', label: 'Research', kind: 'step', variableWrites: ['$research_report'] },
      ],
      edges: [],
    };

    const next = canonicalizeSkillGraph(graph);
    const response = next.nodes.find((n) => n.kind === 'response');
    const variable = next.nodes.find((n) => n.kind === 'variable');
    expect(response).toBeTruthy();
    expect(variable).toBeTruthy();
    expect(
      next.edges.some(
        (e) => e.source === variable?.id && e.target === response?.id && e.ui?.semanticKind === 'data_read',
      ),
    ).toBe(true);
  });

  it('keeps response terminal and labels variable edges as set/get', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 'Strict response test',
      nodes: [
        { id: 'step', label: 'Research', kind: 'step', variableWrites: ['$research_report'], layer: 1 },
        { id: 'response', label: 'Old response', kind: 'response', layer: 2 },
        { id: 'late', label: 'Late step', kind: 'step', layer: 3 },
        { id: 'response-2', label: 'Duplicate response', kind: 'response', layer: 4 },
      ],
      edges: [
        { id: 'bad', source: 'response', target: 'late', kind: 'sequence' },
      ],
    };

    const next = canonicalizeSkillGraph(graph);
    const responses = next.nodes.filter((n) => n.kind === 'response');
    expect(responses).toHaveLength(1);
    expect(responses[0].label).toBe('Response');
    expect(next.edges.some((e) => e.source === responses[0].id)).toBe(false);
    expect(next.edges.some((e) => e.target === responses[0].id && e.ui?.layoutColorKey === 'response')).toBe(true);
    expect(next.edges.find((e) => e.ui?.semanticKind === 'data_write')?.label).toBeUndefined();
    expect(next.edges.find((e) => e.ui?.semanticKind === 'data_read')?.label).toBeUndefined();
  });
});

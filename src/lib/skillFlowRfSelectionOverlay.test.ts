import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { applySkillFlowRfSelectionPresentation } from './skillFlowRfSelectionOverlay';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

function graph(): SkillFlowGraphV2 {
  return {
    version: '2.0',
    id: 'trace-flow-test',
    name: 'Trace Flow Test',
    sourceType: 'visual',
    nodes: [
      { id: 'step-1', label: 'Step 1', kind: 'step' },
      { id: 'step-2', label: 'Step 2', kind: 'step' },
      { id: 'step-3', label: 'Step 3', kind: 'step' },
      { id: 'other', label: 'Other', kind: 'step' },
    ],
    edges: [
      { id: 'edge-active', source: 'step-1', target: 'step-2', kind: 'sequence' },
      { id: 'edge-sibling', source: 'step-1', target: 'step-3', kind: 'sequence' },
      { id: 'edge-other', source: 'other', target: 'step-3', kind: 'sequence' },
    ],
  };
}

const baseNodes: Node[] = [
  { id: 'step-1', type: 'skillFlow', position: { x: 0, y: 0 }, data: {}, style: { width: 100 } },
  { id: 'step-2', type: 'skillFlow', position: { x: 160, y: 0 }, data: {}, style: { width: 100 } },
  { id: 'step-3', type: 'skillFlow', position: { x: 160, y: 120 }, data: {}, style: { width: 100 } },
  { id: 'other', type: 'skillFlow', position: { x: 0, y: 120 }, data: {}, style: { width: 100 } },
];

const baseEdges: Edge[] = [
  {
    id: 'edge-active',
    source: 'step-1',
    target: 'step-2',
    data: { points: [{ x: 0, y: 0 }, { x: 120, y: 0 }], renderMode: 'settled' },
    style: { stroke: '#fff' },
  },
  {
    id: 'edge-sibling',
    source: 'step-1',
    target: 'step-3',
    data: { points: [{ x: 0, y: 0 }, { x: 120, y: 120 }], renderMode: 'settled' },
    style: { stroke: '#aaa' },
  },
  {
    id: 'edge-other',
    source: 'other',
    target: 'step-3',
    data: { points: [{ x: 0, y: 120 }, { x: 120, y: 120 }], renderMode: 'settled' },
    style: { stroke: '#777' },
  },
];

describe('applySkillFlowRfSelectionPresentation trace packets', () => {
  it('decorates active and focused trace edges without losing route data', () => {
    const out = applySkillFlowRfSelectionPresentation(graph(), baseNodes, baseEdges, [], null, {
      activeNodeId: 'step-1',
      activeEdgeId: 'edge-active',
      pulseEdgeIds: [],
    });

    const active = out.edges.find((e) => e.id === 'edge-active');
    const sibling = out.edges.find((e) => e.id === 'edge-sibling');
    const other = out.edges.find((e) => e.id === 'edge-other');

    expect(active?.data).toMatchObject({
      traceFlow: 'active',
      points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
      renderMode: 'settled',
    });
    expect(sibling?.data).toMatchObject({
      traceFlow: 'pulse',
      points: [{ x: 0, y: 0 }, { x: 120, y: 120 }],
      renderMode: 'settled',
    });
    expect(typeof active?.data?.tracePacketIndex).toBe('number');
    expect(typeof sibling?.data?.tracePacketIndex).toBe('number');
    expect(other?.data && 'traceFlow' in other.data).toBe(false);
  });

  it('does not add trace packet data outside trace mode', () => {
    const out = applySkillFlowRfSelectionPresentation(graph(), baseNodes, baseEdges, [], null);

    expect(out.edges.every((edge) => !(edge.data && 'traceFlow' in edge.data))).toBe(true);
  });
});

import { v4 as uuidv4 } from 'uuid';
import type { SkillEdgeKind, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';

export function newSkillNodeId(prefix = 'node'): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

export function newSkillEdgeId(prefix = 'edge'): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

/**
 * Create a new node connected from `fromId` with a new edge.
 */
export function createConnectedSkillNode(
  graph: SkillFlowGraphV2,
  fromId: string,
  partial: Pick<SkillNodeV2, 'label' | 'kind'> & Partial<Omit<SkillNodeV2, 'id' | 'label' | 'kind'>>,
  edgeKind: SkillEdgeKind = 'depends_on',
): SkillFlowGraphV2 {
  const from = graph.nodes.find((n) => n.id === fromId);
  if (!from) return graph;

  const id = newSkillNodeId();
  const node: SkillNodeV2 = {
    id,
    label: partial.label,
    kind: partial.kind,
    ...(partial.summary ? { summary: partial.summary } : {}),
    ...(partial.body ? { body: partial.body } : {}),
    ...(partial.tags?.length ? { tags: partial.tags } : {}),
    ...(typeof partial.layer === 'number' ? { layer: partial.layer } : {}),
    status: partial.status ?? 'valid',
    ui: {
      x: (from.ui?.x ?? 0) + 280,
      y: from.ui?.y ?? 0,
      width: partial.ui?.width ?? from.ui?.width ?? 220,
      height: partial.ui?.height ?? from.ui?.height ?? 96,
      manuallyPositioned: true,
    },
  };

  const edge = {
    id: newSkillEdgeId(),
    source: fromId,
    target: id,
    kind: edgeKind,
  };

  return {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: [...graph.edges, edge],
  };
}

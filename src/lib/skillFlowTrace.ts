import type { SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';

export type SkillTraceStep = {
  index: number;
  nodeId: string;
  nodeLabel: string;
  nodeKind: SkillNodeV2['kind'];
  incomingEdgeId?: string;
  outgoingEdgeIds: string[];
  readEdgeIds: string[];
  writeEdgeIds: string[];
  readVariables: string[];
  writeVariables: string[];
  inputs: string[];
  outputs: string[];
  nextNodeIds: string[];
};

export type SkillTraceSnapshot = {
  step: SkillTraceStep | null;
  steps: SkillTraceStep[];
  activeNodeId: string | null;
  activeEdgeId: string | null;
  pulseEdgeIds: string[];
};

function nodeOrder(graph: SkillFlowGraphV2): SkillNodeV2[] {
  const nodes = graph.nodes.filter((n) => n.kind !== 'variable' && n.kind !== 'group');
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const variableProducerIds = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.ui?.semanticKind !== 'data_write') continue;
    if (!byId.has(edge.source)) continue;
    const set = variableProducerIds.get(edge.target) ?? new Set<string>();
    set.add(edge.source);
    variableProducerIds.set(edge.target, set);
  }
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, SkillEdgeV2[]>();
  for (const n of nodes) incoming.set(n.id, 0);
  const addDependency = (sourceId: string, targetId: string, edge: SkillEdgeV2) => {
    if (sourceId === targetId || !byId.has(sourceId) || !byId.has(targetId)) return;
    incoming.set(targetId, (incoming.get(targetId) ?? 0) + 1);
    const arr = outgoing.get(sourceId) ?? [];
    arr.push(edge);
    outgoing.set(sourceId, arr);
  };
  for (const edge of graph.edges) {
    if (edge.ui?.semanticKind === 'data_write') continue;
    if (edge.ui?.semanticKind === 'data_read') {
      if (!byId.has(edge.target)) continue;
      const producers = variableProducerIds.get(edge.source);
      if (!producers?.size) continue;
      for (const producerId of producers) {
        addDependency(producerId, edge.target, edge);
      }
      continue;
    }
    addDependency(edge.source, edge.target, edge);
  }
  const responseId = nodes.find((n) => n.kind === 'response')?.id;
  if (responseId) {
    for (const node of nodes) {
      if (node.id === responseId || node.kind === 'note') continue;
      const hasAnyOutgoing = (outgoing.get(node.id) ?? []).some((edge) => edge.target !== responseId);
      if (!hasAnyOutgoing) addDependency(node.id, responseId, { id: `trace-terminal-${node.id}-${responseId}`, source: node.id, target: responseId, kind: 'depends_on' });
    }
  }
  const compare = (a: SkillNodeV2, b: SkillNodeV2) => {
    if (a.kind === 'response' && b.kind !== 'response') return 1;
    if (b.kind === 'response' && a.kind !== 'response') return -1;
    const la = typeof a.layer === 'number' ? a.layer : 999;
    const lb = typeof b.layer === 'number' ? b.layer : 999;
    if (la !== lb) return la - lb;
    return a.label.localeCompare(b.label);
  };
  const ready = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).sort(compare);
  const out: SkillNodeV2[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const node = ready.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    for (const edge of (outgoing.get(node.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))) {
      const nextCount = Math.max(0, (incoming.get(edge.target) ?? 0) - 1);
      incoming.set(edge.target, nextCount);
      const target = byId.get(edge.target);
      if (target && nextCount === 0) {
        ready.push(target);
        ready.sort(compare);
      }
    }
  }
  for (const node of nodes.sort(compare)) {
    if (!seen.has(node.id)) out.push(node);
  }
  const responseIndex = out.findIndex((n) => n.kind === 'response');
  if (responseIndex >= 0 && responseIndex !== out.length - 1) {
    const [response] = out.splice(responseIndex, 1);
    out.push(response);
  }
  return out;
}

export function buildSkillTraceSteps(graph: SkillFlowGraphV2): SkillTraceStep[] {
  const ordered = nodeOrder(graph);
  return ordered.map((node, index) => {
    const incoming = graph.edges
      .filter((e) => e.target === node.id && e.ui?.semanticKind !== 'data_read' && e.ui?.semanticKind !== 'data_write')
      .sort((a, b) => a.id.localeCompare(b.id));
    const outgoing = graph.edges
      .filter((e) => e.source === node.id && e.ui?.semanticKind !== 'data_read' && e.ui?.semanticKind !== 'data_write')
      .sort((a, b) => a.id.localeCompare(b.id));
    const readEdges = graph.edges.filter((e) => e.target === node.id && e.ui?.semanticKind === 'data_read');
    const writeEdges = graph.edges.filter((e) => e.source === node.id && e.ui?.semanticKind === 'data_write');
    const readVariables = readEdges
      .map((e) => graph.nodes.find((n) => n.id === e.source)?.variable?.variableName)
      .filter((x): x is string => Boolean(x));
    const writeVariables = writeEdges
      .map((e) => graph.nodes.find((n) => n.id === e.target)?.variable?.variableName)
      .filter((x): x is string => Boolean(x));
    return {
      index,
      nodeId: node.id,
      nodeLabel: node.label,
      nodeKind: node.kind,
      ...(incoming[0] ? { incomingEdgeId: incoming[0].id } : {}),
      outgoingEdgeIds: outgoing.map((e) => e.id),
      readEdgeIds: readEdges.map((e) => e.id),
      writeEdgeIds: writeEdges.map((e) => e.id),
      readVariables,
      writeVariables,
      inputs: node.contract?.inputs ?? [],
      outputs: node.contract?.outputs ?? [],
      nextNodeIds: outgoing.map((e) => e.target),
    };
  });
}

export function skillTraceSnapshot(graph: SkillFlowGraphV2, index: number): SkillTraceSnapshot {
  const steps = buildSkillTraceSteps(graph);
  if (!steps.length) {
    return { step: null, steps, activeNodeId: null, activeEdgeId: null, pulseEdgeIds: [] };
  }
  const clamped = Math.min(Math.max(index, 0), steps.length - 1);
  const step = steps[clamped];
  return {
    step,
    steps,
    activeNodeId: step.nodeId,
    activeEdgeId: step.incomingEdgeId ?? step.outgoingEdgeIds[0] ?? null,
    pulseEdgeIds: [...step.readEdgeIds, ...step.writeEdgeIds],
  };
}

import type {
  SkillEdgeKind,
  SkillEdgeSemanticKind,
  SkillFlowGraphV2,
  SkillGroupV2,
  SkillNodeKind,
  SkillNodeV2,
  SkillNodeStatus,
} from './skillFlowGraphV2';
import { FAST_BOARD_LAYOUT_GROUP_IDS } from './skillFlowBoardLayout';
import { isSkillLayoutPlanV2, type SkillNodeLayoutAssignmentV2 } from './skillFlowLayoutPlanV2';
import { isSkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import type { SkillDataArtifactLayoutNode } from './skillFlowLayoutPlanV2';
import { newSkillEdgeId, newSkillNodeId } from './skillFlowBuilder';
import {
  canonicalizeSkillGraph,
  canonicalizeSkillNode,
  defaultContractForNode,
  normalizeVariableName,
} from './skillFlowCanonical';

function isFastBoardLayoutGroupId(id: string): boolean {
  return (FAST_BOARD_LAYOUT_GROUP_IDS as readonly string[]).includes(id);
}

const NODE_W = 220;
const NODE_H = 96;

function defaultLabelForKind(kind: SkillNodeKind): string {
  switch (kind) {
    case 'step':
      return 'New step';
    case 'rule':
      return 'New rule';
    case 'decision':
      return 'New decision';
    case 'input':
      return 'New input';
    case 'output':
      return 'New output';
    case 'response':
      return 'Response';
    case 'note':
      return 'Custom';
    case 'tool':
      return 'New tool';
    case 'validation':
      return 'New validation';
    case 'guardrail':
      return 'New guardrail';
    case 'example':
      return 'New example';
    case 'variable':
      return 'New variable';
    default:
      return `New ${kind}`;
  }
}

function roleForKind(kind: SkillNodeKind): SkillNodeLayoutAssignmentV2['role'] {
  switch (kind) {
    case 'goal':
      return 'start';
    case 'decision':
      return 'decision';
    case 'rule':
    case 'validation':
    case 'guardrail':
      return 'rule';
    case 'output':
    case 'response':
      return 'output';
    case 'note':
    case 'example':
      return 'support';
    default:
      return 'main-step';
  }
}

function appendNodeToLayoutGroup(
  graph: SkillFlowGraphV2,
  node: SkillNodeV2,
  groupId: string | null | undefined,
): SkillFlowGraphV2 {
  if (!groupId || !isFastBoardLayoutGroupId(groupId)) return graph;
  const layoutPlan = graph.layout?.layoutPlan;
  if (!layoutPlan || (!isSkillLayoutPlanV2(layoutPlan) && !isSkillLayoutPlanV3(layoutPlan))) return graph;

  const group = layoutPlan.groups.find((g) => g.id === groupId);
  const groups = layoutPlan.groups.map((g) => {
    const withoutNode = g.nodeIds.filter((id) => id !== node.id);
    return g.id === groupId
      ? { ...g, nodeIds: Array.from(new Set([...withoutNode, node.id])) }
      : { ...g, nodeIds: withoutNode };
  });

  const order =
    layoutPlan.nodeAssignments.reduce((max, a) => Math.max(max, a.order), -1) + 1;
  const assignment: SkillNodeLayoutAssignmentV2 = {
    nodeId: node.id,
    groupId,
    ...(group?.laneId ? { laneId: group.laneId } : {}),
    role: roleForKind(node.kind),
    layer: node.layer ?? order,
    order,
    placement: 'inside-group',
    visualEmphasis: 'secondary',
  };

  const nodeAssignments = [
    ...layoutPlan.nodeAssignments.filter((a) => a.nodeId !== node.id),
    assignment,
  ];

  return {
    ...graph,
    layout: graph.layout
      ? {
          ...graph.layout,
          layoutPlan: {
            ...layoutPlan,
            groups,
            nodeAssignments,
          },
        }
      : graph.layout,
  };
}

/**
 * Choose structural edge kind + semantic palette when connecting `source` → new child of `targetKind`.
 * Structural `SkillEdgeKind` stays in the existing four-way union; semantics use `SkillEdgeSemanticKind`.
 */
export function inferEdgeKindAndSemanticForNewChild(
  source: SkillNodeV2,
  targetKind: SkillNodeKind,
): { kind: SkillEdgeKind; semanticKind?: SkillEdgeSemanticKind } {
  if (targetKind === 'variable') {
    return { kind: 'depends_on', semanticKind: 'data_write' };
  }
  if (source.kind === 'variable') {
    return { kind: 'depends_on', semanticKind: 'data_read' };
  }
  switch (targetKind) {
    case 'decision':
      return { kind: 'branch', semanticKind: 'branch' };
    case 'output':
    case 'response':
      return { kind: 'depends_on', semanticKind: 'constraint' };
    case 'rule':
    case 'guardrail':
      return { kind: 'depends_on', semanticKind: 'constraint' };
    case 'validation':
      return { kind: 'depends_on', semanticKind: 'constraint' };
    case 'tool':
      return { kind: 'depends_on', semanticKind: 'constraint' };
    case 'example':
    case 'note':
      return { kind: 'depends_on', semanticKind: 'support' };
    default:
      return { kind: 'depends_on', semanticKind: 'dependency' };
  }
}

function nextUniqueEdgeId(graph: SkillFlowGraphV2): string {
  const used = new Set(graph.edges.map((e) => e.id));
  let id = newSkillEdgeId();
  while (used.has(id)) id = newSkillEdgeId();
  used.add(id);
  return id;
}

function edgeSemanticsBetween(
  source: SkillNodeV2,
  target: SkillNodeV2,
): { kind: SkillEdgeKind; semanticKind?: SkillEdgeSemanticKind } {
  if (target.kind === 'variable') return { kind: 'depends_on', semanticKind: 'data_write' };
  if (source.kind === 'variable') return { kind: 'depends_on', semanticKind: 'data_read' };
  return inferEdgeKindAndSemanticForNewChild(source, target.kind);
}

function hasEquivalentEdge(graph: SkillFlowGraphV2, sourceId: string, targetId: string): boolean {
  return graph.edges.some((e) => e.source === sourceId && e.target === targetId);
}

export function connectExistingSkillNodes(
  graph: SkillFlowGraphV2,
  sourceId: string,
  targetId: string,
): { graph: SkillFlowGraphV2; edgeId: string | null; changed: boolean; reason?: string } {
  if (sourceId === targetId) return { graph, edgeId: null, changed: false, reason: 'self-edge' };
  if (hasEquivalentEdge(graph, sourceId, targetId)) {
    const existing = graph.edges.find((e) => e.source === sourceId && e.target === targetId);
    return { graph, edgeId: existing?.id ?? null, changed: false, reason: 'duplicate' };
  }
  const source = graph.nodes.find((n) => n.id === sourceId);
  const target = graph.nodes.find((n) => n.id === targetId);
  if (!source || !target) return { graph, edgeId: null, changed: false, reason: 'missing-node' };

  const { kind, semanticKind } = edgeSemanticsBetween(source, target);
  const edgeId = nextUniqueEdgeId(graph);
  const next = canonicalizeSkillGraph({
    ...graph,
    edges: [
      ...graph.edges,
      {
        id: edgeId,
        source: sourceId,
        target: targetId,
        kind,
        ...(semanticKind ? { ui: { semanticKind } } : {}),
      },
    ],
  });
  return { graph: next, edgeId, changed: true };
}

export function connectVariableRead(
  graph: SkillFlowGraphV2,
  variableNodeId: string,
  consumerNodeId: string,
): { graph: SkillFlowGraphV2; edgeId: string | null; changed: boolean; reason?: string } {
  if (variableNodeId === consumerNodeId) return { graph, edgeId: null, changed: false, reason: 'self-edge' };
  const variable = graph.nodes.find((n) => n.id === variableNodeId);
  const consumer = graph.nodes.find((n) => n.id === consumerNodeId);
  if (!variable || !consumer) return { graph, edgeId: null, changed: false, reason: 'missing-node' };
  if (variable.kind !== 'variable') return { graph, edgeId: null, changed: false, reason: 'not-variable' };
  if (hasEquivalentEdge(graph, variableNodeId, consumerNodeId)) {
    const existing = graph.edges.find((e) => e.source === variableNodeId && e.target === consumerNodeId);
    return { graph, edgeId: existing?.id ?? null, changed: false, reason: 'duplicate' };
  }

  const variableName = variable.variable?.variableName;
  const edgeId = nextUniqueEdgeId(graph);
  const next = canonicalizeSkillGraph({
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id !== consumerNodeId
        ? n
        : {
            ...n,
            variableReads: variableName ? Array.from(new Set([...(n.variableReads ?? []), variableName])) : n.variableReads,
            contract: variableName
              ? {
                  ...(n.contract ?? {}),
                  reads: Array.from(new Set([...(n.contract?.reads ?? []), variableName])),
                }
              : n.contract,
          },
    ),
    edges: [
      ...graph.edges,
      {
        id: edgeId,
        source: variableNodeId,
        target: consumerNodeId,
        kind: 'depends_on',
        ui: { semanticKind: 'data_read' },
      },
    ],
  });
  return { graph: next, edgeId, changed: true };
}

export type RadialCreateOpts = {
  flowX: number;
  flowY: number;
  kind: SkillNodeKind;
  variableMode?: 'read' | 'write' | 'default';
  /** Connection drag from this skill node — adds edge + increments layer */
  sourceNodeId?: string | null;
  edgeKind?: SkillEdgeKind;
  /** Pin fast-board panel (`fb-start` … `fb-output`) — from hit-test or group-frame context menu */
  layoutGroupPlanId?: string | null;
  /** Default `valid`; use `draft` for manual blank nodes */
  initialStatus?: SkillNodeStatus;
};

/**
 * Insert a skill node at flow coordinates (centered on `flowX`/`flowY`), optionally connected from `sourceNodeId`.
 * Does not run layout — caller should apply fast-board.
 */
export function createSkillNodeFromRadialPick(
  graph: SkillFlowGraphV2,
  opts: RadialCreateOpts,
): { graph: SkillFlowGraphV2; newNodeId: string } {
  const id = newSkillNodeId();
  const source = opts.sourceNodeId ? graph.nodes.find((n) => n.id === opts.sourceNodeId) : undefined;

  const layer =
    source !== undefined
      ? opts.kind === 'variable' && opts.variableMode === 'read'
        ? Math.max(0, (source.layer ?? 1) - 1)
        : (source.layer ?? 0) + 1
      : undefined;
  const label = defaultLabelForKind(opts.kind);
  const contract = defaultContractForNode(opts.kind, label);
  const fallbackVariableName = normalizeVariableName(`${label} ${id.slice(-4)}`);

  const node: SkillNodeV2 = canonicalizeSkillNode({
    id,
    label,
    kind: opts.kind,
    summary: contract.purpose,
    contract,
    ...(opts.kind === 'variable'
      ? {
          variable: {
            variableName: fallbackVariableName,
            exportBehavior: 'include-in-markdown' as const,
          },
        }
      : {}),
    ...(layer !== undefined ? { layer } : {}),
    ...(opts.layoutGroupPlanId && isFastBoardLayoutGroupId(opts.layoutGroupPlanId)
      ? { groupId: opts.layoutGroupPlanId }
      : {}),
    status: opts.initialStatus ?? 'valid',
    userEditEpoch: Date.now(),
    ui: {
      x: opts.flowX - NODE_W / 2,
      y: opts.flowY - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      manuallyPositioned: true,
    },
  });

  const edges = [...graph.edges];
  if (opts.sourceNodeId) {
    const src = graph.nodes.find((n) => n.id === opts.sourceNodeId);
    const inferred =
      src && !opts.edgeKind ? inferEdgeKindAndSemanticForNewChild(src, opts.kind) : null;
    const ek = opts.edgeKind ?? inferred?.kind ?? 'depends_on';
    const variableRead = opts.kind === 'variable' && opts.variableMode === 'read';
    const sem = !opts.edgeKind ? (variableRead ? 'data_read' : inferred?.semanticKind) : undefined;
    edges.push({
      id: newSkillEdgeId(),
      source: variableRead ? id : opts.sourceNodeId,
      target: variableRead ? opts.sourceNodeId : id,
      kind: ek,
      ...(sem
        ? {
            ui: {
              semanticKind: sem,
            },
          }
        : {}),
    });
  }

  const nextGraph = appendNodeToLayoutGroup(
    {
      ...graph,
      nodes: [...graph.nodes, node],
      edges,
    },
    node,
    opts.layoutGroupPlanId,
  );

  return {
    graph: canonicalizeSkillGraph(nextGraph),
    newNodeId: id,
  };
}

export type InsertSkillNodeOnEdgeOpts = {
  edgeId: string;
  flowX: number;
  flowY: number;
  kind: SkillNodeKind;
  variableMode?: 'read' | 'write' | 'default';
  layoutGroupPlanId?: string | null;
  initialStatus?: SkillNodeStatus;
};

export function insertSkillNodeOnEdge(
  graph: SkillFlowGraphV2,
  opts: InsertSkillNodeOnEdgeOpts,
): { graph: SkillFlowGraphV2; newNodeId: string | null; edgeIds: string[]; changed: boolean; reason?: string } {
  const original = graph.edges.find((e) => e.id === opts.edgeId);
  if (!original) return { graph, newNodeId: null, edgeIds: [], changed: false, reason: 'missing-edge' };

  const source = graph.nodes.find((n) => n.id === original.source);
  const target = graph.nodes.find((n) => n.id === original.target);
  if (!source || !target) return { graph, newNodeId: null, edgeIds: [], changed: false, reason: 'missing-node' };

  const created = createSkillNodeFromRadialPick(
    { ...graph, edges: graph.edges.filter((e) => e.id !== opts.edgeId) },
    {
      flowX: opts.flowX,
      flowY: opts.flowY,
      kind: opts.kind,
      variableMode: opts.variableMode,
      layoutGroupPlanId: opts.layoutGroupPlanId,
      initialStatus: opts.initialStatus,
    },
  );
  const inserted = created.graph.nodes.find((n) => n.id === created.newNodeId);
  if (!inserted) return { graph, newNodeId: null, edgeIds: [], changed: false, reason: 'create-failed' };

  const firstSemantics = edgeSemanticsBetween(source, inserted);
  const secondSemantics = edgeSemanticsBetween(inserted, target);
  const firstId = nextUniqueEdgeId(created.graph);
  const secondId = nextUniqueEdgeId({ ...created.graph, edges: [...created.graph.edges, { id: firstId, source: '', target: '', kind: 'depends_on' }] });
  const firstSemantic = firstSemantics.semanticKind ?? original.ui?.semanticKind;
  const secondSemantic = secondSemantics.semanticKind ?? original.ui?.semanticKind;
  const next = canonicalizeSkillGraph({
    ...created.graph,
    edges: [
      ...created.graph.edges,
      {
        id: firstId,
        source: original.source,
        target: created.newNodeId,
        kind: firstSemantics.kind ?? original.kind,
        ...(firstSemantic ? { ui: { ...original.ui, semanticKind: firstSemantic } } : original.ui ? { ui: { ...original.ui } } : {}),
      },
      {
        id: secondId,
        source: created.newNodeId,
        target: original.target,
        kind: secondSemantics.kind ?? original.kind,
        ...(secondSemantic ? { ui: { ...original.ui, semanticKind: secondSemantic } } : original.ui ? { ui: { ...original.ui } } : {}),
      },
    ],
  });

  return { graph: next, newNodeId: created.newNodeId, edgeIds: [firstId, secondId], changed: true };
}

export type GeneratingPlaceholderOpts = {
  flowX: number;
  flowY: number;
  kind: SkillNodeKind;
  variableMode?: 'read' | 'write' | 'default';
  userPrompt: string;
  jobId: string;
  sourceNodeId?: string | null;
  layoutGroupPlanId?: string | null;
};

/** Placeholder node for async Codex expansion (`status: generating`). */
export function createGeneratingPlaceholderNode(
  graph: SkillFlowGraphV2,
  opts: GeneratingPlaceholderOpts,
): { graph: SkillFlowGraphV2; newNodeId: string } {
  const id = newSkillNodeId();
  const source = opts.sourceNodeId ? graph.nodes.find((n) => n.id === opts.sourceNodeId) : undefined;
  const layer =
    source !== undefined
      ? opts.kind === 'variable' && opts.variableMode === 'read'
        ? Math.max(0, (source.layer ?? 1) - 1)
        : (source.layer ?? 0) + 1
      : undefined;
  const startedAt = new Date().toISOString();
  const slug = id.replace(/[^a-zA-Z0-9]+/g, '').slice(-8) || 'var';
  const tmpVarName = `$tmp_${slug}`;
  const contract = defaultContractForNode(opts.kind, `Generating ${opts.kind}`);

  const node: SkillNodeV2 = canonicalizeSkillNode({
    id,
    label: `Generating ${opts.kind}...`,
    kind: opts.kind,
    summary: opts.userPrompt.trim() || undefined,
    contract,
    ...(layer !== undefined ? { layer } : {}),
    ...(opts.layoutGroupPlanId && isFastBoardLayoutGroupId(opts.layoutGroupPlanId)
      ? { groupId: opts.layoutGroupPlanId }
      : {}),
    status: 'generating',
    generation: {
      jobId: opts.jobId,
      status: 'running',
      userPrompt: opts.userPrompt,
      requestedKind: opts.kind,
      ...(opts.sourceNodeId ? { sourceNodeId: opts.sourceNodeId } : {}),
      startedAt,
    },
    ...(opts.kind === 'variable'
      ? {
          variable: {
            variableName: tmpVarName,
            exportBehavior: 'include-in-markdown' as const,
            description: 'Temporary until AI completes',
          },
        }
      : {}),
    ui: {
      x: opts.flowX - NODE_W / 2,
      y: opts.flowY - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      manuallyPositioned: true,
    },
  });

  const edges = [...graph.edges];
  if (opts.sourceNodeId && source) {
    const { kind: ek, semanticKind } = inferEdgeKindAndSemanticForNewChild(source, opts.kind);
    const variableRead = opts.kind === 'variable' && opts.variableMode === 'read';
    edges.push({
      id: newSkillEdgeId(),
      source: variableRead ? id : opts.sourceNodeId,
      target: variableRead ? opts.sourceNodeId : id,
      kind: ek,
      ...(variableRead ? { ui: { semanticKind: 'data_read' as const } } : semanticKind ? { ui: { semanticKind } } : {}),
    });
  }

  const nextGraph = appendNodeToLayoutGroup(
    {
      ...graph,
      nodes: [...graph.nodes, node],
      edges,
    },
    node,
    opts.layoutGroupPlanId,
  );

  return { graph: canonicalizeSkillGraph(nextGraph), newNodeId: id };
}

export function markNodeGenerationFailed(
  graph: SkillFlowGraphV2,
  nodeId: string,
  error: string,
): SkillFlowGraphV2 {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id !== nodeId
        ? n
        : {
            ...n,
            status: 'error' as const,
            label: /^Generating\b/i.test(n.label) ? `Failed (${n.kind})` : n.label,
            generation: n.generation
              ? {
                  ...n.generation,
                  status: 'failed',
                  finishedAt: new Date().toISOString(),
                  error,
                }
              : undefined,
          },
    ),
  };
}

export function markNodeGenerationCancelled(graph: SkillFlowGraphV2, nodeId: string): SkillFlowGraphV2 {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id !== nodeId || !n.generation
        ? n
        : {
            ...n,
            status: 'draft',
            generation: {
              ...n.generation,
              status: 'cancelled',
              finishedAt: new Date().toISOString(),
            },
          },
    ),
  };
}

/** Queue another Codex run for the same node (inspector Regenerate). */
export function prepareSkillNodeRegeneration(
  graph: SkillFlowGraphV2,
  nodeId: string,
  newJobId: string,
): SkillFlowGraphV2 | null {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n?.generation?.userPrompt) return null;
  const startedAt = new Date().toISOString();
  return {
    ...graph,
    nodes: graph.nodes.map((nn) =>
      nn.id !== nodeId
        ? nn
        : {
            ...nn,
            status: 'generating',
            label: /^Generating\b/i.test(nn.label) ? nn.label : `Generating ${nn.kind}...`,
            generation: {
              ...nn.generation!,
              jobId: newJobId,
              status: 'running',
              startedAt,
              finishedAt: undefined,
              error: undefined,
            },
          },
    ),
  };
}

/** Persisted user cluster (`graph.groups`) — distinct from fast-board layout `fb-*` groups. */
export function createUserSkillGroupInGraph(
  graph: SkillFlowGraphV2,
  opts: { label: string; colorKey: string; nodeIds: string[]; description?: string },
): SkillFlowGraphV2 {
  const id = newSkillNodeId('ug');
  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const nodeIds = [...new Set(opts.nodeIds.filter((nid) => nodeSet.has(nid)))];
  const g: SkillGroupV2 = {
    id,
    label: opts.label.trim() || 'Group',
    colorKey: opts.colorKey.trim() || 'neutral',
    nodeIds,
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
  };
  return { ...graph, groups: [...(graph.groups ?? []), g] };
}

export function removeUserSkillGroupFromGraph(graph: SkillFlowGraphV2, groupId: string): SkillFlowGraphV2 {
  const next = graph.groups?.filter((g) => g.id !== groupId) ?? [];
  return { ...graph, ...(next.length ? { groups: next } : { groups: undefined }) };
}

export function deleteSkillNodesFromGraph(graph: SkillFlowGraphV2, nodeIds: string[]): SkillFlowGraphV2 {
  let next = graph;
  for (const id of nodeIds) {
    next = deleteSkillNodeFromGraph(next, id);
  }
  return next;
}

function scrubArtifacts(
  artifacts: SkillDataArtifactLayoutNode[] | undefined,
  removedId: string,
): SkillDataArtifactLayoutNode[] | undefined {
  if (!artifacts?.length) return artifacts;
  const next = artifacts
    .map((a) => ({
      ...a,
      producedBy: a.producedBy.filter((x) => x !== removedId),
      consumedBy: a.consumedBy.filter((x) => x !== removedId),
    }))
    .filter((a) => a.producedBy.length > 0 || a.consumedBy.length > 0);
  return next.length ? next : undefined;
}

/** Remove a skill node, incident edges, and artifact plan references. Caller should re-run fast-board layout. */
export function deleteSkillNodeFromGraph(graph: SkillFlowGraphV2, nodeId: string): SkillFlowGraphV2 {
  const nodes = graph.nodes.filter((n) => n.id !== nodeId);
  const edges = graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

  let next: SkillFlowGraphV2 = {
    ...graph,
    nodes,
    edges,
  };

  if (next.groups?.length) {
    const scrubbed = next.groups
      .map((g) => {
        if (!g.nodeIds?.length) return g;
        return { ...g, nodeIds: g.nodeIds.filter((id) => id !== nodeId) };
      })
      .filter((g) => !Array.isArray(g.nodeIds) || g.nodeIds.length > 0);
    next = { ...next, ...(scrubbed.length ? { groups: scrubbed } : { groups: undefined }) };
  }

  const lp = next.layout?.layoutPlan;
  if (lp && (isSkillLayoutPlanV2(lp) || isSkillLayoutPlanV3(lp)) && lp.dataArtifacts?.length) {
    const scrubbed = scrubArtifacts(lp.dataArtifacts, nodeId);
    next = {
      ...next,
      layout: next.layout
        ? {
            ...next.layout,
            layoutPlan: {
              ...lp,
              dataArtifacts: scrubbed,
            },
          }
        : undefined,
    };
  }

  return next;
}

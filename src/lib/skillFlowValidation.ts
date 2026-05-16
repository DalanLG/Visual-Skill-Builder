import type { SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';

const VAR_NAME_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

function normalizedVariableNames(nodes: SkillNodeV2[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.kind !== 'variable' || !n.variable?.variableName) continue;
    const key = n.variable.variableName.trim();
    const arr = byName.get(key) ?? [];
    arr.push(n.id);
    byName.set(key, arr);
  }
  return byName;
}

export type SkillValidationSeverity = 'info' | 'warn' | 'error';

export interface SkillValidationIssue {
  severity: SkillValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface SkillValidationResult {
  issues: SkillValidationIssue[];
  ok: boolean;
}

const LABEL_WARN = 48;
const SUMMARY_WARN = 160;

function hasCycle(nodeIds: Set<string>, edges: SkillEdgeV2[]): boolean {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(u: string): boolean {
    visited.add(u);
    stack.add(u);
    for (const v of adj.get(u) ?? []) {
      if (!visited.has(v)) {
        if (dfs(v)) return true;
      } else if (stack.has(v)) return true;
    }
    stack.delete(u);
    return false;
  }

  for (const id of nodeIds) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

function reachableFrom(startIds: string[], nodeIds: Set<string>, edges: SkillEdgeV2[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      out.get(edge.source)!.push(edge.target);
    }
  }
  const seen = new Set<string>();
  const stack = startIds.filter((id) => nodeIds.has(id));
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) stack.push(next);
  }
  return seen;
}

export function validateSkillFlowGraphV2(graph: SkillFlowGraphV2): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];
  const nodeIds = new Set<string>();

  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_node_id',
        message: `Duplicate node id: ${n.id}`,
        nodeId: n.id,
      });
    }
    nodeIds.add(n.id);
    if (!n.label.trim()) {
      issues.push({
        severity: 'error',
        code: 'empty_label',
        message: 'Node label is empty',
        nodeId: n.id,
      });
    } else if (n.label.length > LABEL_WARN) {
      issues.push({
        severity: 'warn',
        code: 'label_long',
        message: `Label longer than ${LABEL_WARN} characters (may crowd the canvas)`,
        nodeId: n.id,
      });
    }
    if (n.summary && n.summary.length > SUMMARY_WARN) {
      issues.push({
        severity: 'warn',
        code: 'summary_long',
        message: `Summary longer than ${SUMMARY_WARN} characters`,
        nodeId: n.id,
      });
    }

    if (n.kind === 'variable') {
      const vn = n.variable?.variableName?.trim();
      if (!vn) {
        issues.push({
          severity: 'error',
          code: 'variable_missing_name',
          message: 'Variable node must have variable.variableName',
          nodeId: n.id,
        });
      } else if (!VAR_NAME_PATTERN.test(vn)) {
        issues.push({
          severity: 'error',
          code: 'variable_name_invalid',
          message: `Variable name must look like $snake_case (got "${vn}")`,
          nodeId: n.id,
        });
      }
      if (n.variable?.storage === 'workspace-file' && !n.variable.pathTemplate?.trim()) {
        issues.push({
          severity: 'warn',
          code: 'variable_missing_path_template',
          message: `Variable ${vn || n.label} is stored as workspace-file but has no path template`,
          nodeId: n.id,
        });
      }
      if (n.variable?.exportBehavior !== 'visual-only' && !n.variable?.label?.trim()) {
        issues.push({
          severity: 'warn',
          code: 'variable_missing_label',
          message: `Variable ${vn || n.label} should have a human label for SKILL.md export`,
          nodeId: n.id,
        });
      }
    } else if (!n.contract) {
      issues.push({
        severity: 'warn',
        code: 'node_missing_contract',
        message: 'Node is missing the canonical contract shape',
        nodeId: n.id,
      });
    }

    if (n.status === 'review') {
      issues.push({
        severity: 'warn',
        code: 'node_in_review',
        message: 'Node is awaiting review after generation',
        nodeId: n.id,
      });
    }
    if (n.status === 'generating' && n.generation?.startedAt) {
      const t = Date.parse(n.generation.startedAt);
      if (Number.isFinite(t) && Date.now() - t > 15 * 60 * 1000) {
        issues.push({
          severity: 'warn',
          code: 'generating_stale',
          message: 'Generation has been running a long time; retry or cancel',
          nodeId: n.id,
        });
      }
    }
  }

  const varDup = normalizedVariableNames(graph.nodes);
  for (const [name, ids] of varDup) {
    if (ids.length > 1) {
      for (const id of ids) {
        issues.push({
          severity: 'error',
          code: 'variable_name_duplicate',
          message: `Duplicate variable name ${name}`,
          nodeId: id,
        });
      }
    }
  }

  for (const n of graph.nodes) {
    if (n.kind !== 'variable' || !n.variable?.variableName?.trim()) continue;
    const name = n.variable.variableName.trim();
    const incoming = graph.edges.some((e) => e.target === n.id);
    const outgoing = graph.edges.some((e) => e.source === n.id);
    if (!incoming) {
      issues.push({
        severity: 'warn',
        code: 'variable_no_producer',
        message: `Variable ${name} has no incoming edge`,
        nodeId: n.id,
      });
    }
    if (!outgoing) {
      issues.push({
        severity: 'warn',
        code: 'variable_no_consumer',
        message: `Variable ${name} has no outgoing edge`,
        nodeId: n.id,
      });
    }
  }

  for (const n of graph.nodes) {
    if (n.kind !== 'output') continue;
    const incoming = graph.edges.some((e) => e.target === n.id);
    if (!incoming) {
      issues.push({
        severity: 'warn',
        code: 'output_no_incoming',
        message: 'Output node has no incoming edge',
        nodeId: n.id,
      });
    }
  }

  const responseNodes = graph.nodes.filter((n) => n.kind === 'response');
  if (responseNodes.length === 0) {
    issues.push({
      severity: 'error',
      code: 'response_missing',
      message: 'Graph should have one Response node where final outputs converge',
    });
  } else if (responseNodes.length > 1) {
    for (const n of responseNodes) {
      issues.push({
        severity: 'error',
        code: 'response_duplicate',
        message: 'Graph should have exactly one Response node',
        nodeId: n.id,
      });
    }
  } else {
    const incoming = graph.edges.some((e) => e.target === responseNodes[0].id);
    if (!incoming) {
      issues.push({
        severity: 'error',
        code: 'response_no_incoming',
        message: 'Response node has no incoming edge',
        nodeId: responseNodes[0].id,
      });
    }
    const outgoing = graph.edges.filter((e) => e.source === responseNodes[0].id);
    if (outgoing.length) {
      issues.push({
        severity: 'error',
        code: 'response_has_outgoing',
        message: 'Response should be the final terminal node and have no outgoing edges',
        nodeId: responseNodes[0].id,
        edgeId: outgoing[0].id,
      });
    }
    const terminalBypass = graph.nodes.find((n) => {
      if (n.id === responseNodes[0].id || n.kind === 'group' || n.kind === 'note' || n.kind === 'goal' || n.kind === 'role' || n.kind === 'input') return false;
      if (n.kind === 'rule' || n.kind === 'guardrail' || n.kind === 'example') return false;
      const out = graph.edges.filter((e) => e.source === n.id && e.target !== responseNodes[0].id);
      const toResponse = graph.edges.some((e) => e.source === n.id && e.target === responseNodes[0].id);
      return out.length === 0 && !toResponse;
    });
    if (terminalBypass) {
      issues.push({
        severity: 'error',
        code: 'terminal_node_bypasses_response',
        message: `${terminalBypass.label} is terminal but does not feed Response`,
        nodeId: terminalBypass.id,
      });
    }
    if (!responseNodes[0].responseSpec) {
      issues.push({
        severity: 'warn',
        code: 'response_missing_spec',
        message: 'Response node should declare responseSpec for final answer behavior',
        nodeId: responseNodes[0].id,
      });
    }
  }

  for (const n of graph.nodes) {
    if (n.kind !== 'decision') continue;
    const out = graph.edges.filter((e) => e.source === n.id);
    if (!out.length) {
      issues.push({
        severity: 'error',
        code: 'decision_no_outgoing',
        message: 'Decision node has no outgoing edges',
        nodeId: n.id,
      });
    } else {
      const branches = out.filter((e) => e.kind === 'branch' || e.ui?.semanticKind === 'branch');
      if (branches.length < 2) {
        issues.push({
          severity: 'warn',
          code: 'decision_branch_count',
          message: 'Decision nodes should have at least two explicit branch edges',
          nodeId: n.id,
        });
      }
      const hasDefault = branches.some((e) => /\b(default|else|fallback)\b/i.test(e.label ?? ''));
      const allLabeled = branches.every((e) => Boolean(e.label?.trim()));
      if (branches.length && (!allLabeled || (!hasDefault && branches.length < 2))) {
        issues.push({
          severity: 'warn',
          code: 'decision_branch_conditions',
          message: 'Decision branch edges should be labeled with conditions and include a default when coverage is not exhaustive',
          nodeId: n.id,
        });
      }
    }
  }

  if (graph.groups?.length) {
    for (const g of graph.groups) {
      if (Array.isArray(g.nodeIds) && g.nodeIds.length === 0) {
        issues.push({
          severity: 'warn',
          code: 'user_group_empty',
          message: `User group "${g.label}" has no nodes`,
        });
      }
    }
  }

  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_edge_id',
        message: `Duplicate edge id: ${e.id}`,
        edgeId: e.id,
      });
    }
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) {
      issues.push({
        severity: 'error',
        code: 'edge_missing_source',
        message: `Edge source not found: ${e.source}`,
        edgeId: e.id,
      });
    }
    if (!nodeIds.has(e.target)) {
      issues.push({
        severity: 'error',
        code: 'edge_missing_target',
        message: `Edge target not found: ${e.target}`,
        edgeId: e.id,
      });
    }
    const source = graph.nodes.find((n) => n.id === e.source);
    const target = graph.nodes.find((n) => n.id === e.target);
    if (e.ui?.semanticKind === 'data_write' && target?.kind !== 'variable') {
      issues.push({
        severity: 'error',
        code: 'data_write_target_not_variable',
        message: 'data_write edges should target variable artifact nodes',
        edgeId: e.id,
      });
    }
    if (e.ui?.semanticKind === 'data_read' && source?.kind !== 'variable') {
      issues.push({
        severity: 'error',
        code: 'data_read_source_not_variable',
        message: 'data_read edges should source from variable artifact nodes',
        edgeId: e.id,
      });
    }
  }

  const variableByName = new Map<string, SkillNodeV2>();
  for (const node of graph.nodes) {
    if (node.kind === 'variable' && node.variable?.variableName) {
      variableByName.set(node.variable.variableName, node);
    }
  }
  for (const node of graph.nodes) {
    if (node.kind === 'variable') continue;
    for (const read of node.contract?.reads ?? node.variableReads ?? []) {
      const variable = variableByName.get(read);
      if (!variable) {
        issues.push({
          severity: 'error',
          code: 'contract_read_missing_artifact',
          message: `Node reads ${read} but no matching variable artifact exists`,
          nodeId: node.id,
        });
        continue;
      }
      const hasEdge = graph.edges.some((e) => e.source === variable.id && e.target === node.id && e.ui?.semanticKind === 'data_read');
      if (!hasEdge) {
        issues.push({
          severity: 'error',
          code: 'contract_read_edge_missing',
          message: `Node reads ${read} but lacks a matching data_read edge`,
          nodeId: node.id,
        });
      }
    }
    for (const write of node.contract?.writes ?? node.variableWrites ?? []) {
      const variable = variableByName.get(write);
      if (!variable) {
        issues.push({
          severity: 'error',
          code: 'contract_write_missing_artifact',
          message: `Node writes ${write} but no matching variable artifact exists`,
          nodeId: node.id,
        });
        continue;
      }
      const hasEdge = graph.edges.some((e) => e.source === node.id && e.target === variable.id && e.ui?.semanticKind === 'data_write');
      if (!hasEdge) {
        issues.push({
          severity: 'error',
          code: 'contract_write_edge_missing',
          message: `Node writes ${write} but lacks a matching data_write edge`,
          nodeId: node.id,
        });
      }
    }
  }

  const entryCandidates = graph.nodes
    .filter((n) => n.kind !== 'variable' && n.kind !== 'group' && n.kind !== 'note' && n.kind !== 'response')
    .filter((n) => !graph.edges.some((e) => e.target === n.id && e.ui?.semanticKind !== 'data_read'));
  const entryIds = entryCandidates.length ? entryCandidates.map((n) => n.id) : graph.nodes.slice(0, 1).map((n) => n.id);
  const reachable = reachableFrom(entryIds, nodeIds, graph.edges);
  for (const node of graph.nodes) {
    if (node.kind === 'group' || node.kind === 'note') continue;
    if (!reachable.has(node.id)) {
      issues.push({
        severity: 'error',
        code: 'node_unreachable',
        message: `${node.label} is not reachable from the graph entry`,
        nodeId: node.id,
      });
    }
  }

  const parallelSources = graph.edges.filter((e) => e.kind === 'parallel' || e.ui?.semanticKind === 'parallel');
  const forkIds = new Set(parallelSources.map((e) => e.source));
  for (const forkId of forkIds) {
    const out = parallelSources.filter((e) => e.source === forkId);
    if (out.length > 1) {
      const targets = new Set(out.map((e) => e.target));
      const hasJoin = graph.nodes.some((n) => {
        const incoming = graph.edges.filter((e) => targets.has(e.source) && e.target === n.id);
        return incoming.length >= 2;
      });
      if (!hasJoin) {
        issues.push({
          severity: 'warn',
          code: 'parallel_missing_join',
          message: 'Parallel branches should reconverge through an explicit join or shared downstream node',
          nodeId: forkId,
        });
      }
    }
  }

  if (hasCycle(nodeIds, graph.edges)) {
    issues.push({
      severity: 'warn',
      code: 'graph_cycle',
      message: 'Graph contains a cycle; layout and ordering may be ambiguous',
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    issues,
    ok: errors.length === 0,
  };
}

export type SkillGraphWithValidation = SkillFlowGraphV2 & { validation?: SkillValidationResult };

export function attachValidation(
  graph: SkillFlowGraphV2,
  validation: SkillValidationResult,
): SkillGraphWithValidation {
  return { ...graph, validation };
}

/** Strip non-persisted fields before writing JSON */
export function stripValidationForDisk(graph: SkillGraphWithValidation): SkillFlowGraphV2 {
  const { validation: _v, ...rest } = graph;
  return rest as SkillFlowGraphV2;
}

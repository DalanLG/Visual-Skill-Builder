import type {
  SkillEdgeV2,
  SkillFlowGraphV2,
  SkillNodeContract,
  SkillNodeKind,
  SkillNodeV2,
  SkillVariableArtifactKind,
  SkillVariableDataType,
  SkillVariableMeta,
} from './skillFlowGraphV2';

const CONTRACT_SECTIONS: Array<[keyof SkillNodeContract, string]> = [
  ['purpose', 'Purpose'],
  ['inputs', 'Inputs'],
  ['instructions', 'Instructions'],
  ['outputs', 'Outputs'],
  ['checks', 'Checks'],
  ['failureModes', 'Failure Modes'],
  ['examples', 'Examples'],
  ['reads', 'Reads'],
  ['writes', 'Writes'],
];

function cleanList(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
}

export function normalizeVariableName(raw: string | undefined | null, fallback = 'artifact'): string {
  const source = (raw ?? '').trim() || fallback;
  const withoutPrefix = source.replace(/^\$/, '');
  const snake = withoutPrefix
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase();
  const safe = snake && /^[a-z_]/.test(snake) ? snake : `artifact_${snake || 'value'}`;
  return `$${safe}`;
}

export function humanizeVariableName(variableName: string): string {
  const clean = normalizeVariableName(variableName).replace(/^\$/, '');
  return clean
    .split('_')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

export function defaultVariablePathTemplate(variableName: string): string {
  const fileName = normalizeVariableName(variableName).replace(/^\$/, '');
  return `.codex/skill-runs/{skillSlug}/{runId}/${fileName}.md`;
}

function inferArtifactKind(variableName: string, text = ''): SkillVariableArtifactKind {
  const hay = `${variableName} ${text}`.toLowerCase();
  if (/research|report|brief|analysis/.test(hay)) return 'research-report';
  if (/note|context|memory/.test(hay)) return 'notes';
  if (/decision|state|score|ranking|choice/.test(hay)) return 'decision-state';
  if (/extract|data|dataset|fact|lead|record|json|list/.test(hay)) return 'extracted-data';
  if (/draft|outline|copy|response|output/.test(hay)) return 'output-draft';
  return 'custom';
}

function inferDataType(variableName: string, text = ''): SkillVariableDataType {
  const hay = `${variableName} ${text}`.toLowerCase();
  if (/json|dataset|record|object|map|schema|score/.test(hay)) return 'json';
  if (/list|items|bullets/.test(hay)) return 'list';
  if (/plain text|snippet|string/.test(hay)) return 'text';
  return 'markdown';
}

export function normalizeVariableMeta(
  variable: Partial<SkillVariableMeta> | undefined,
  fallbackName: string,
): SkillVariableMeta {
  const variableName = normalizeVariableName(variable?.variableName, fallbackName);
  const label = variable?.label?.trim() || humanizeVariableName(variableName);
  const description = variable?.description?.trim();
  const hint = `${label} ${description ?? ''}`;
  const dataType = variable?.dataType ?? inferDataType(variableName, hint);
  return {
    variableName,
    label,
    dataType,
    artifactKind: variable?.artifactKind ?? inferArtifactKind(variableName, hint),
    storage: variable?.storage ?? 'workspace-file',
    pathTemplate: variable?.pathTemplate?.trim() || defaultVariablePathTemplate(variableName),
    ...(description ? { description } : {}),
    producedBy: cleanList(variable?.producedBy ?? []),
    consumedBy: cleanList(variable?.consumedBy ?? []),
    ...(variable?.sampleValue !== undefined ? { sampleValue: variable.sampleValue } : {}),
    exportBehavior: variable?.exportBehavior ?? 'include-in-markdown',
  };
}

function variableMetaToArtifactSpec(variable: SkillVariableMeta, nodeId: string): NonNullable<SkillNodeV2['artifactSpec']> {
  const storage = variable.storage === 'in-memory' ? 'memory' : 'workspace_file';
  return {
    variableName: variable.variableName,
    label: variable.label ?? humanizeVariableName(variable.variableName),
    dataType: variable.dataType ?? 'unknown',
    artifactKind: variable.artifactKind === 'output-draft' ? 'output' : 'intermediate',
    cardinality: variable.dataType === 'list' ? 'many' : 'one',
    storage,
    pathTemplate: variable.pathTemplate ?? null,
    referenceStyle: storage === 'workspace_file' ? 'path' : 'inline',
    retention: {
      scope: storage === 'workspace_file' ? 'saved_skill' : 'turn',
      cleanup: 'none',
    },
    schemaRef: null,
    exampleValue: variable.sampleValue ?? null,
    provenance: {
      generatedBy: variable.producedBy ?? [],
      usedBy: variable.consumedBy ?? [],
      derivedFrom: [nodeId],
    },
    exportBehavior: {
      includeInSkillMd: variable.exportBehavior !== 'visual-only',
      exposeToAgent: variable.exportBehavior !== 'visual-only',
      exposeToUser: false,
    },
  };
}

function defaultResponseSpec(): NonNullable<SkillNodeV2['responseSpec']> {
  return {
    audience: 'user',
    format: 'markdown',
    mustMentionArtifacts: [],
    mustNotClaimWithoutEvidence: true,
    missingDataBehavior: 'state_missing',
    tone: 'direct, concise, operational',
    requiredSections: [],
    citationPolicy: 'artifact_only',
  };
}

function labelForKind(kind: SkillNodeKind): string {
  switch (kind) {
    case 'goal':
      return 'Goal';
    case 'role':
      return 'Role';
    case 'input':
      return 'Get variable';
    case 'output':
      return 'Set variable';
    case 'response':
      return 'Response';
    case 'decision':
      return 'Decision';
    case 'rule':
      return 'Rule';
    case 'tool':
      return 'Custom tool';
    case 'validation':
      return 'Check';
    case 'guardrail':
      return 'Guard';
    case 'example':
      return 'Example';
    case 'variable':
      return 'Variable';
    case 'note':
      return 'Custom';
    default:
      return 'Step';
  }
}

export function defaultContractForNode(kind: SkillNodeKind, label?: string): SkillNodeContract {
  const nodeLabel = (label ?? labelForKind(kind)).trim();
  switch (kind) {
    case 'variable': {
      const variableName = normalizeVariableName(nodeLabel, 'artifact');
      return {
        purpose: `Reference the reusable artifact ${variableName}.`,
        inputs: ['Producer steps write this artifact before consumers read it.'],
        instructions: ['Keep the artifact name stable so later nodes can reference it explicitly.'],
        outputs: [`Artifact reference ${variableName}`],
        checks: ['Every data_read edge has a prior data_write edge when the workflow requires one.'],
        failureModes: ['If the artifact is missing, ask the producer step to regenerate it.'],
        reads: [],
        writes: [variableName],
      };
    }
    case 'input':
      return {
        purpose: 'Read required user context or a prior variable artifact.',
        inputs: ['User-provided context or existing skill artifact.'],
        instructions: ['Identify the exact context the next step needs before continuing.'],
        outputs: ['A normalized input reference for downstream steps.'],
        checks: ['The input is named clearly and can be reused.'],
        failureModes: ['If the input is missing or ambiguous, request clarification.'],
        reads: [],
        writes: [],
      };
    case 'output':
      return {
        purpose: 'Write a reusable output artifact for later steps or final export.',
        inputs: ['Prior step result or transformed context.'],
        instructions: ['Store the output under a stable variable name when it will be reused.'],
        outputs: ['A named artifact or final deliverable.'],
        checks: ['The output has a clear owner, format, and completion criteria.'],
        failureModes: ['If the output is incomplete, rerun the producing step with stricter checks.'],
        reads: [],
        writes: [],
      };
    case 'response':
      return {
        purpose: 'Show the final AI response behavior after every upstream step, output, and variable has completed.',
        inputs: ['Completed terminal outputs, final step results, and reusable variables that should appear in the answer.'],
        instructions: [
          'Wait until every incoming contributor has finished before composing the response.',
          'Combine the final upstream results into the user-facing answer.',
          'Make the response clear, complete, and aligned with the skill goal.',
          'Do not expose intermediate implementation details unless the skill explicitly asks for them.',
        ],
        outputs: ['Final AI response to return to the user.'],
        checks: ['The response uses all required terminal outputs and does not omit important variables or decisions.'],
        examples: [
          'Example: "Summary: I verified the lead, researched the company, and scored the opportunity. Result: pursue this lead; the strongest signal is recent hiring in the target department. Next action: send the tailored outreach draft below."',
        ],
        failureModes: ['If an upstream output is missing, route back to the responsible producer before responding.'],
        reads: [],
        writes: [],
      };
    case 'decision':
      return {
        purpose: 'Choose the next branch based on explicit criteria.',
        inputs: ['Current state, prior artifacts, and decision criteria.'],
        instructions: ['Evaluate the criteria and select the matching branch.'],
        outputs: ['A selected branch or decision state.'],
        checks: ['Each branch has a clear condition.'],
        failureModes: ['If no branch applies, use the fallback branch or ask for clarification.'],
        reads: [],
        writes: [],
      };
    case 'validation':
      return {
        purpose: 'Verify that the workflow result satisfies the expected quality bar.',
        inputs: ['Candidate output and relevant rules.'],
        instructions: ['Run each check and record failures clearly.'],
        outputs: ['Pass/fail validation notes.'],
        checks: ['Every required criterion is checked.'],
        failureModes: ['If validation fails, route back to the responsible step.'],
        reads: [],
        writes: [],
      };
    default:
      return {
        purpose: `Perform ${nodeLabel || labelForKind(kind)} in the skill workflow.`,
        inputs: ['Relevant context from preceding nodes.'],
        instructions: ['Complete this step concisely and preserve reusable outputs as variables when needed.'],
        outputs: ['Step result for downstream nodes.'],
        checks: ['The result is actionable and matches the node purpose.'],
        failureModes: ['If required context is unavailable, pause and request the missing input.'],
        reads: [],
        writes: [],
      };
  }
}

export function contractToBody(contract: SkillNodeContract | undefined, fallbackBody = ''): string {
  if (!contract) return fallbackBody.trim();
  const lines: string[] = [];
  for (const [key, heading] of CONTRACT_SECTIONS) {
    const value = contract[key];
    if (key === 'purpose') {
      const purpose = typeof value === 'string' ? value.trim() : '';
      if (purpose) {
        lines.push(`**${heading}:** ${purpose}`);
        lines.push('');
      }
      continue;
    }
    const arr = Array.isArray(value) ? cleanList(value) : [];
    if (!arr.length) continue;
    lines.push(`**${heading}:**`);
    for (const item of arr) lines.push(`- ${item}`);
    lines.push('');
  }
  const body = lines.join('\n').trim();
  return body || fallbackBody.trim();
}

function contractFromNode(node: SkillNodeV2): SkillNodeContract {
  const base = defaultContractForNode(node.kind, node.label);
  const contract = node.contract ?? {};
  const summary = node.summary?.trim();
  const body = node.body?.trim();
  const purpose = contract.purpose?.trim() || summary || base.purpose;
  const instructions = cleanList([...(contract.instructions ?? []), ...(body && !node.contract ? [body] : [])]);
  return {
    ...base,
    ...contract,
    ...(purpose ? { purpose } : {}),
    inputs: cleanList(contract.inputs ?? base.inputs ?? []),
    instructions: instructions.length ? instructions : base.instructions,
    outputs: cleanList(contract.outputs ?? base.outputs ?? []),
    checks: cleanList(contract.checks ?? base.checks ?? []),
    failureModes: cleanList(contract.failureModes ?? base.failureModes ?? []),
    examples: cleanList(contract.examples ?? base.examples ?? []),
    reads: cleanList([...(contract.reads ?? []), ...(node.variableReads ?? [])].map((v) => normalizeVariableName(v))),
    writes: cleanList([...(contract.writes ?? []), ...(node.variableWrites ?? [])].map((v) => normalizeVariableName(v))),
  };
}

export function canonicalizeSkillNode(node: SkillNodeV2): SkillNodeV2 {
  const contract = contractFromNode(node);
  const variable =
    node.kind === 'variable'
      ? normalizeVariableMeta(node.variable, node.variable?.variableName ?? node.label)
      : node.variable
        ? normalizeVariableMeta(node.variable, node.variable.variableName)
        : undefined;
  const variableReads = cleanList(contract.reads ?? []);
  const variableWrites = cleanList(contract.writes ?? []);
  return {
    ...node,
    label: node.label?.trim() || labelForKind(node.kind),
    summary: node.summary?.trim() || contract.purpose,
    body: node.body?.trim() || contractToBody(contract),
    contract,
    ...(variable ? { variable } : { variable: undefined }),
    ...(variable ? { artifactSpec: node.artifactSpec ?? variableMetaToArtifactSpec(variable, node.id) } : {}),
    ...(node.kind === 'response' ? { responseSpec: node.responseSpec ?? defaultResponseSpec() } : {}),
    variableReads: variableReads.length ? variableReads : undefined,
    variableWrites: variableWrites.length ? variableWrites : undefined,
  };
}

function variableNodeIdFor(variableName: string, existingIds: Set<string>): string {
  const base = `var-${normalizeVariableName(variableName).replace(/^\$/, '').replace(/_/g, '-')}`;
  if (!existingIds.has(base)) return base;
  let i = 2;
  while (existingIds.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function edgeIdFor(source: string, target: string, semanticKind: 'data_read' | 'data_write'): string {
  return `e-${semanticKind}-${source}-${target}`.replace(/[^a-zA-Z0-9:_-]+/g, '-');
}

function responseEdgeIdFor(source: string, target: string): string {
  return `e-response-${source}-${target}`.replace(/[^a-zA-Z0-9:_-]+/g, '-');
}

function uniqueNodeId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) {
    existingIds.add(base);
    return base;
  }
  let i = 2;
  while (existingIds.has(`${base}-${i}`)) i += 1;
  const id = `${base}-${i}`;
  existingIds.add(id);
  return id;
}

function ensureResponseNode(nodes: SkillNodeV2[], existingIds: Set<string>): SkillNodeV2 {
  const responseNodes = nodes.filter((n) => n.kind === 'response');
  const existing = responseNodes[0];
  for (const duplicate of responseNodes.slice(1)) {
    duplicate.kind = 'output';
    duplicate.label = duplicate.label.trim() || 'Response input';
    duplicate.groupId = duplicate.groupId === 'fb-response' ? 'fb-output' : duplicate.groupId;
    duplicate.contract = {
      ...defaultContractForNode('output', duplicate.label),
      ...(duplicate.contract ?? {}),
      purpose: duplicate.contract?.purpose ?? 'Output that contributes to the final Response node.',
    };
    duplicate.summary = duplicate.summary?.trim() || duplicate.contract.purpose;
    duplicate.body = duplicate.body?.trim() || contractToBody(duplicate.contract);
  }
  if (existing) {
    existing.label = 'Response';
    existing.groupId = existing.groupId || 'fb-response';
    const numericLayers = nodes
      .filter((n) => n.id !== existing.id)
      .map((n) => n.layer)
      .filter((x): x is number => typeof x === 'number');
    if (numericLayers.length) existing.layer = Math.max(...numericLayers) + 1;
    existing.contract = {
      ...defaultContractForNode('response', existing.label),
      ...(existing.contract ?? {}),
    };
    existing.summary = existing.summary?.trim() || existing.contract.purpose;
    existing.body = existing.body?.trim() || contractToBody(existing.contract);
    return existing;
  }

  const numericLayers = nodes.map((n) => n.layer).filter((x): x is number => typeof x === 'number');
  const maxLayer = numericLayers.length ? Math.max(...numericLayers) : undefined;
  const id = uniqueNodeId('response', existingIds);
  const contract = defaultContractForNode('response', 'Response');
  const linked = nodes.filter((n) => n.kind === 'output');
  const x =
    linked.length > 0
      ? Math.max(...linked.map((n) => (n.ui?.x ?? 0) + (n.ui?.width ?? 220) + 360))
      : nodes.length
        ? Math.max(...nodes.map((n) => (n.ui?.x ?? 0) + (n.ui?.width ?? 220) + 360))
        : 0;
  const y = linked.length > 0 ? linked.reduce((sum, n) => sum + (n.ui?.y ?? 0), 0) / linked.length : 0;
  const response = canonicalizeSkillNode({
    id,
    label: 'Response',
    kind: 'response',
    summary: contract.purpose,
    body: contractToBody(contract),
    contract,
    status: 'valid',
    ...(typeof maxLayer === 'number' ? { layer: maxLayer + 1 } : {}),
    groupId: 'fb-response',
    ui: { x, y, width: 240, height: 108, manuallyPositioned: false },
  });
  nodes.push(response);
  return response;
}

function terminalResponseSources(nodes: SkillNodeV2[], edges: SkillEdgeV2[], responseId: string): SkillNodeV2[] {
  const outbound = new Map<string, SkillEdgeV2[]>();
  for (const edge of edges) {
    if (edge.target === responseId) continue;
    const arr = outbound.get(edge.source) ?? [];
    arr.push(edge);
    outbound.set(edge.source, arr);
  }
  const candidates = nodes.filter((node) => {
    if (node.id === responseId || node.kind === 'group' || node.kind === 'note' || node.kind === 'goal' || node.kind === 'role' || node.kind === 'input') {
      return false;
    }
    if (node.kind === 'rule' || node.kind === 'guardrail' || node.kind === 'example') return false;
    return (outbound.get(node.id) ?? []).length === 0;
  });
  if (candidates.length) return candidates;
  const fallback = nodes
    .filter((n) => n.id !== responseId && n.kind !== 'variable' && n.kind !== 'group' && n.kind !== 'note')
    .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0));
  return fallback.slice(0, 1);
}

function ensureResponseEdges(nodes: SkillNodeV2[], edges: SkillEdgeV2[], response: SkillNodeV2): SkillEdgeV2[] {
  const next = edges
    .filter((edge) => edge.source !== response.id && edge.target !== response.id)
    .map((edge) => ({ ...edge, ...(edge.ui ? { ui: { ...edge.ui } } : {}) }));
  const hasEdge = (source: string, target: string) => next.some((e) => e.source === source && e.target === target);
  for (const source of terminalResponseSources(nodes, next, response.id)) {
    if (hasEdge(source.id, response.id)) continue;
    const dataRead = source.kind === 'variable';
    next.push({
      id: responseEdgeIdFor(source.id, response.id),
      source: source.id,
      target: response.id,
      kind: source.kind === 'output' || source.kind === 'step' ? 'sequence' : 'depends_on',
      ui: { semanticKind: dataRead ? 'data_read' : 'main_flow', layoutColorKey: 'response', visualEmphasis: 'primary' },
    });
  }
  return next;
}

function normalizeEdgeLabelsAndResponseVisuals(edges: SkillEdgeV2[], responseId: string): SkillEdgeV2[] {
  return edges.map((edge) => {
    const semantic = edge.ui?.semanticKind;
    const isResponseEdge = edge.target === responseId;
    const clearSemanticLabel = isResponseEdge || semantic === 'data_write' || semantic === 'data_read';
    return {
      ...edge,
      label: clearSemanticLabel ? undefined : edge.label?.trim() || undefined,
      ui: {
        ...(edge.ui ?? {}),
        ...(isResponseEdge ? { layoutColorKey: 'response', visualEmphasis: 'primary' as const } : {}),
      },
    };
  });
}

function ensureVariableNode(
  nodes: SkillNodeV2[],
  variableByName: Map<string, SkillNodeV2>,
  existingIds: Set<string>,
  variableName: string,
  seed?: Partial<SkillVariableMeta>,
): SkillNodeV2 {
  const normalizedName = normalizeVariableName(variableName);
  const existing = variableByName.get(normalizedName);
  if (existing) return existing;
  const id = variableNodeIdFor(normalizedName, existingIds);
  existingIds.add(id);
  const variable = normalizeVariableMeta({ ...seed, variableName: normalizedName }, normalizedName);
  const node = canonicalizeSkillNode({
    id,
    label: variable.label ?? humanizeVariableName(normalizedName),
    kind: 'variable',
    summary: variable.description ?? `Reusable artifact ${normalizedName}.`,
    status: 'valid',
    variable,
  });
  nodes.push(node);
  variableByName.set(normalizedName, node);
  return node;
}

export function canonicalizeSkillGraph(graph: SkillFlowGraphV2): SkillFlowGraphV2 {
  const nodes = graph.nodes.map(canonicalizeSkillNode);
  let edges: SkillEdgeV2[] = graph.edges.map((edge) => ({ ...edge, ...(edge.ui ? { ui: { ...edge.ui } } : {}) }));
  const existingIds = new Set(nodes.map((n) => n.id));
  const variableByName = new Map<string, SkillNodeV2>();

  for (const node of nodes) {
    if (node.kind !== 'variable' || !node.variable?.variableName) continue;
    const meta = normalizeVariableMeta(node.variable, node.variable.variableName);
    node.variable = meta;
    node.label = node.label.trim() || meta.label || humanizeVariableName(meta.variableName);
    variableByName.set(meta.variableName, node);
  }

  const responseNode = ensureResponseNode(nodes, existingIds);

  const writesByVariable = new Map<string, Set<string>>();
  const readsByVariable = new Map<string, Set<string>>();

  const record = (map: Map<string, Set<string>>, variableName: string, nodeId: string) => {
    const normalized = normalizeVariableName(variableName);
    const set = map.get(normalized) ?? new Set<string>();
    set.add(nodeId);
    map.set(normalized, set);
  };

  for (const edge of edges) {
    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (!source || !target) continue;
    if (edge.ui?.semanticKind === 'data_write' && target.kind === 'variable' && target.variable?.variableName) {
      record(writesByVariable, target.variable.variableName, source.id);
    }
    if (edge.ui?.semanticKind === 'data_read' && source.kind === 'variable' && source.variable?.variableName) {
      record(readsByVariable, source.variable.variableName, target.id);
    }
  }

  for (const node of nodes) {
    if (node.kind === 'variable') continue;
    for (const variableName of node.variableWrites ?? []) {
      record(writesByVariable, variableName, node.id);
      ensureVariableNode(nodes, variableByName, existingIds, variableName);
    }
    for (const variableName of node.variableReads ?? []) {
      record(readsByVariable, variableName, node.id);
      ensureVariableNode(nodes, variableByName, existingIds, variableName);
    }
  }

  const hasSemanticEdge = (source: string, target: string, semanticKind: 'data_read' | 'data_write') =>
    edges.some((e) => e.source === source && e.target === target && e.ui?.semanticKind === semanticKind);

  for (const [variableName, producerIds] of writesByVariable) {
    const variableNode = ensureVariableNode(nodes, variableByName, existingIds, variableName);
    for (const producerId of producerIds) {
      if (!hasSemanticEdge(producerId, variableNode.id, 'data_write')) {
        edges.push({
          id: edgeIdFor(producerId, variableNode.id, 'data_write'),
          source: producerId,
          target: variableNode.id,
          kind: 'depends_on',
          ui: { semanticKind: 'data_write' },
        });
      }
    }
  }

  for (const [variableName, consumerIds] of readsByVariable) {
    const variableNode = ensureVariableNode(nodes, variableByName, existingIds, variableName);
    for (const consumerId of consumerIds) {
      if (!hasSemanticEdge(variableNode.id, consumerId, 'data_read')) {
        edges.push({
          id: edgeIdFor(variableNode.id, consumerId, 'data_read'),
          source: variableNode.id,
          target: consumerId,
          kind: 'depends_on',
          ui: { semanticKind: 'data_read' },
        });
      }
    }
  }

  edges = normalizeEdgeLabelsAndResponseVisuals(ensureResponseEdges(nodes, edges, responseNode), responseNode.id);

  const variableNodeById = new Map(nodes.filter((n) => n.kind === 'variable').map((n) => [n.id, n] as const));
  const producers = new Map<string, string[]>();
  const consumers = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.ui?.semanticKind === 'data_write' && variableNodeById.has(edge.target)) {
      const arr = producers.get(edge.target) ?? [];
      arr.push(edge.source);
      producers.set(edge.target, arr);
    }
    if (edge.ui?.semanticKind === 'data_read' && variableNodeById.has(edge.source)) {
      const arr = consumers.get(edge.source) ?? [];
      arr.push(edge.target);
      consumers.set(edge.source, arr);
    }
  }

  const finalNodes = nodes.map((node) => {
    if (node.kind !== 'variable') return canonicalizeSkillNode(node);
    const meta = normalizeVariableMeta(
      {
        ...node.variable,
        producedBy: producers.get(node.id) ?? node.variable?.producedBy ?? [],
        consumedBy: consumers.get(node.id) ?? node.variable?.consumedBy ?? [],
      },
      node.variable?.variableName ?? node.label,
    );
    const linkedIds = [...(producers.get(node.id) ?? []), ...(consumers.get(node.id) ?? [])];
    const linkedNodes = linkedIds.map((id) => nodes.find((n) => n.id === id)).filter((n): n is SkillNodeV2 => Boolean(n));
    const inferredUi =
      node.ui ??
      (linkedNodes.length
        ? {
            x:
              linkedNodes.reduce((sum, n) => sum + (n.ui?.x ?? 0), 0) / linkedNodes.length +
              120,
            y:
              linkedNodes.reduce((sum, n) => sum + (n.ui?.y ?? 0), 0) / linkedNodes.length +
              130,
            width: 220,
            height: 96,
            manuallyPositioned: false,
          }
        : { x: 0, y: 0, width: 220, height: 96, manuallyPositioned: false });
    return canonicalizeSkillNode({
      ...node,
      label: node.label || meta.label || humanizeVariableName(meta.variableName),
      variable: meta,
      ui: inferredUi,
    });
  });

  return {
    ...graph,
    sourceType: graph.sourceType ?? 'mixed',
    nodes: finalNodes,
    edges: edges.filter((edge, index, all) => all.findIndex((e) => e.id === edge.id) === index),
  };
}

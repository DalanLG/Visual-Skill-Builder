import { extractJsonObject } from './mdSkillTaskImport';
import type {
  SkillFlowGraphV2,
  SkillNodeContract,
  SkillNodeKind,
  SkillNodeV2,
  SkillVariableArtifactKind,
  SkillVariableDataType,
  SkillVariableExportBehavior,
  SkillVariableMeta,
  SkillVariableStorage,
} from './skillFlowGraphV2';
import { isSkillNodeKind } from './skillFlowGraphV2';
import { canonicalizeSkillGraph } from './skillFlowCanonical';

export type GeneratedSkillNodePatch = {
  kind: SkillNodeKind;
  label: string;
  summary: string;
  body: string;
  contract?: SkillNodeContract;
  tags?: string[];
  variable?: {
    variableName: string;
    label?: string;
    dataType?: SkillVariableDataType;
    artifactKind?: SkillVariableArtifactKind;
    storage?: SkillVariableStorage;
    pathTemplate?: string;
    description?: string;
    sampleValue?: string;
    exportBehavior?: SkillVariableExportBehavior;
  };
  variableReads?: string[];
  variableWrites?: string[];
  suggestedEdgeSemanticKind?: string;
  validationChecklist?: string[];
  branchLabels?: string[];
  warnings?: string[];
};

const DATA_TYPES = new Set<string>([
  'text',
  'number',
  'boolean',
  'list',
  'object',
  'markdown',
  'json',
  'unknown',
]);

const ARTIFACT_KINDS = new Set<string>([
  'research-report',
  'notes',
  'decision-state',
  'extracted-data',
  'output-draft',
  'custom',
]);

const STORAGE_KINDS = new Set<string>(['in-memory', 'workspace-file']);

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function normalizeGeneratedSkillNodePatch(raw: unknown): GeneratedSkillNodePatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = isSkillNodeKind(o.kind) ? o.kind : null;
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  if (!kind || !label) return null;
  const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
  const body = typeof o.body === 'string' ? o.body.trim() : '';
  const out: GeneratedSkillNodePatch = {
    kind,
    label: clamp(label, 48),
    summary: clamp(summary, 160),
    body,
  };
  if (o.contract && typeof o.contract === 'object') {
    const c = o.contract as Record<string, unknown>;
    const contract: SkillNodeContract = {};
    const list = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined;
    if (typeof c.purpose === 'string' && c.purpose.trim()) contract.purpose = c.purpose.trim();
    const inputs = list(c.inputs);
    if (inputs?.length) contract.inputs = inputs;
    const instructions = list(c.instructions);
    if (instructions?.length) contract.instructions = instructions;
    const outputs = list(c.outputs);
    if (outputs?.length) contract.outputs = outputs;
    const checks = list(c.checks);
    if (checks?.length) contract.checks = checks;
    const failureModes = list(c.failureModes);
    if (failureModes?.length) contract.failureModes = failureModes;
    const examples = list(c.examples);
    if (examples?.length) contract.examples = examples;
    const reads = list(c.reads);
    if (reads?.length) contract.reads = reads;
    const writes = list(c.writes);
    if (writes?.length) contract.writes = writes;
    if (Object.keys(contract).length) out.contract = contract;
  }
  if (Array.isArray(o.tags))
    out.tags = o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean);
  if (o.variable && typeof o.variable === 'object') {
    const v = o.variable as Record<string, unknown>;
    const vn = typeof v.variableName === 'string' ? v.variableName.trim() : '';
    if (vn) {
      const vm: GeneratedSkillNodePatch['variable'] = { variableName: vn };
      if (typeof v.label === 'string' && v.label.trim()) vm.label = v.label.trim();
      if (typeof v.dataType === 'string' && DATA_TYPES.has(v.dataType)) vm.dataType = v.dataType as SkillVariableDataType;
      if (typeof v.artifactKind === 'string' && ARTIFACT_KINDS.has(v.artifactKind))
        vm.artifactKind = v.artifactKind as SkillVariableArtifactKind;
      if (typeof v.storage === 'string' && STORAGE_KINDS.has(v.storage))
        vm.storage = v.storage as SkillVariableStorage;
      if (typeof v.pathTemplate === 'string' && v.pathTemplate.trim()) vm.pathTemplate = v.pathTemplate.trim();
      if (typeof v.description === 'string') vm.description = v.description.trim();
      if (typeof v.sampleValue === 'string') vm.sampleValue = v.sampleValue;
      if (v.exportBehavior === 'visual-only' || v.exportBehavior === 'include-in-markdown')
        vm.exportBehavior = v.exportBehavior;
      out.variable = vm;
    }
  }
  if (Array.isArray(o.variableReads))
    out.variableReads = o.variableReads
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  if (Array.isArray(o.variableWrites))
    out.variableWrites = o.variableWrites
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  if (typeof o.suggestedEdgeSemanticKind === 'string' && o.suggestedEdgeSemanticKind.trim())
    out.suggestedEdgeSemanticKind = o.suggestedEdgeSemanticKind.trim();
  if (Array.isArray(o.validationChecklist))
    out.validationChecklist = o.validationChecklist
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  if (Array.isArray(o.branchLabels))
    out.branchLabels = o.branchLabels
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  if (Array.isArray(o.warnings))
    out.warnings = o.warnings.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  return out;
}

export function parseGeneratedSkillNodePatchFromStdout(stdout: string): GeneratedSkillNodePatch | { error: string } {
  const blob = extractJsonObject(stdout);
  if (!blob) return { error: 'No JSON object found in Codex output.' };
  try {
    const raw = JSON.parse(blob) as unknown;
    const p = normalizeGeneratedSkillNodePatch(raw);
    if (!p) return { error: 'JSON did not match GeneratedSkillNodePatch shape.' };
    return p;
  } catch {
    return { error: 'Invalid JSON from Codex.' };
  }
}

function patchVariableToMeta(v: GeneratedSkillNodePatch['variable']): SkillVariableMeta | undefined {
  if (!v?.variableName) return undefined;
  const m: SkillVariableMeta = { variableName: v.variableName.trim() };
  if (v.label) m.label = v.label;
  if (v.dataType) m.dataType = v.dataType;
  if (v.artifactKind) m.artifactKind = v.artifactKind;
  if (v.storage) m.storage = v.storage;
  if (v.pathTemplate) m.pathTemplate = v.pathTemplate;
  if (v.description) m.description = v.description;
  if (v.sampleValue !== undefined) m.sampleValue = v.sampleValue;
  if (v.exportBehavior) m.exportBehavior = v.exportBehavior;
  return m;
}

/** Apply AI patch to an existing node. Skips if `userEditEpoch` is newer than job start (race guard). */
export function applyGeneratedPatchToNode(
  graph: SkillFlowGraphV2,
  nodeId: string,
  patch: GeneratedSkillNodePatch,
  opts: { jobStartedAtMs: number },
): SkillFlowGraphV2 {
  const idx = graph.nodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) return graph;
  const node = graph.nodes[idx]!;
  if (typeof node.userEditEpoch === 'number' && node.userEditEpoch > opts.jobStartedAtMs) {
    return graph;
  }
  const next: SkillNodeV2 = {
    ...node,
    kind: patch.kind,
    label: patch.label,
    summary: patch.summary || undefined,
    body: patch.body || undefined,
    contract: patch.contract,
    tags: patch.tags?.length ? patch.tags : undefined,
    variableReads: patch.variableReads?.length ? patch.variableReads : undefined,
    variableWrites: patch.variableWrites?.length ? patch.variableWrites : undefined,
    status: 'review',
    generation: node.generation
      ? {
          ...node.generation,
          status: 'succeeded',
          finishedAt: new Date().toISOString(),
        }
      : undefined,
    aiWarnings: patch.warnings?.length ? patch.warnings : undefined,
    userEditEpoch: Date.now(),
  };
  if (patch.kind === 'variable') {
    const vm = patchVariableToMeta(patch.variable);
    if (vm) next.variable = vm;
  } else if (patch.variable) {
    next.variable = patchVariableToMeta(patch.variable);
  } else {
    next.variable = undefined;
  }
  const nodes = graph.nodes.slice();
  nodes[idx] = next;
  return canonicalizeSkillGraph({ ...graph, nodes });
}

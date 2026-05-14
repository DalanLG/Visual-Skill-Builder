import { v4 as uuidv4 } from 'uuid';
import { extractJsonObject } from './mdSkillTaskImport';
import type { EdgeRouteKind, SkillGraphLayoutState, VisualEmphasis } from './skillFlowLayoutPlan';
import {
  normalizeSkillFlowGraph,
  type SkillFlowEdge,
  type SkillFlowGraphV1,
  type SkillFlowNode,
} from './skillFlowGraph';
export const SKILL_FLOW_GRAPH_V2_VERSION = '2.0' as const;

/** Display / semantic kinds for skill planner nodes */
export type SkillNodeKind =
  | 'goal'
  | 'role'
  | 'input'
  | 'output'
  | 'response'
  | 'step'
  | 'rule'
  | 'note'
  | 'decision'
  | 'group'
  | 'tool'
  | 'validation'
  | 'guardrail'
  | 'example'
  | 'variable';

export type SkillEdgeKind = 'sequence' | 'depends_on' | 'branch' | 'parallel';

/** Node lifecycle / validation state (legacy `ok`/`warn` normalized on load). */
export type SkillNodeStatus =
  | 'draft'
  | 'generating'
  | 'review'
  | 'valid'
  | 'warning'
  | 'error';

/** Legacy persisted statuses — normalized to `SkillNodeStatus` via `normalizeSkillNodeStatus`. */
export type SkillNodeStatusLegacy = 'ok' | 'warn' | 'error';

export type SkillVariableDataType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'list'
  | 'object'
  | 'markdown'
  | 'json'
  | 'unknown';

export type SkillVariableExportBehavior = 'visual-only' | 'include-in-markdown';

export type SkillVariableArtifactKind =
  | 'research-report'
  | 'notes'
  | 'decision-state'
  | 'extracted-data'
  | 'output-draft'
  | 'custom';

export type SkillVariableStorage = 'in-memory' | 'workspace-file';

export interface SkillVariableMeta {
  variableName: string;
  /** Human-readable artifact name, e.g. "Lead deep research report". */
  label?: string;
  dataType?: SkillVariableDataType;
  artifactKind?: SkillVariableArtifactKind;
  storage?: SkillVariableStorage;
  /** Template resolved per run; supports {skillSlug}, {runId}, and {variableName}. */
  pathTemplate?: string;
  description?: string;
  producedBy?: string[];
  consumedBy?: string[];
  sampleValue?: string;
  exportBehavior?: SkillVariableExportBehavior;
}

export interface SkillNodeContract {
  /** Why this node exists in the skill. */
  purpose?: string;
  /** Inputs, artifacts, context, or prior variables needed by this node. */
  inputs?: string[];
  /** Ordered or grouped instructions the agent should follow at this node. */
  instructions?: string[];
  /** Outputs or deliverables created by this node. */
  outputs?: string[];
  /** Validation checks before this node is considered complete. */
  checks?: string[];
  /** Known failure modes and recovery hints. */
  failureModes?: string[];
  /** Short examples or input/output sketches. */
  examples?: string[];
  /** Variable names read by this node, e.g. "$lead_deep_research_report". */
  reads?: string[];
  /** Variable names written by this node. */
  writes?: string[];
}

export type SkillNodeGenerationJobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface SkillNodeGeneration {
  jobId: string;
  status: SkillNodeGenerationJobStatus;
  userPrompt: string;
  requestedKind: SkillNodeKind;
  sourceNodeId?: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface SkillNodeUi {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** When true, auto-layout must not overwrite position */
  manuallyPositioned?: boolean;
  laneId?: string;
  visualEmphasis?: VisualEmphasis;
  collapsed?: boolean;
}

/** Semantic edge classification for palette + orthogonal routing (written by fast-board / repair). */
export type SkillEdgeSemanticKind =
  | 'main_flow'
  | 'dependency'
  | 'branch'
  | 'parallel'
  | 'support'
  | 'constraint'
  | 'data_read'
  | 'data_write';

export interface SkillEdgeUi {
  routeKind?: EdgeRouteKind;
  visualEmphasis?: VisualEmphasis;
  labelVisible?: boolean;
  bundled?: boolean;
  /** Semantic palette from layout plan V2 */
  layoutColorKey?: string;
  routingPolicy?: string;
  semanticKind?: SkillEdgeSemanticKind;
}

export interface SkillNodeV2 {
  id: string;
  /** Short title (prompt limit 48 chars; enforced in validation) */
  label: string;
  kind: SkillNodeKind;
  /** One-line summary (prompt limit 160) */
  summary?: string;
  /** Long body / instructions */
  body?: string;
  /** Canonical AI/visual contract used by import, generation, playback, and export. */
  contract?: SkillNodeContract;
  tags?: string[];
  /** Layer hint for layout (lower = earlier / left) */
  layer?: number;
  status?: SkillNodeStatus;
  ui?: SkillNodeUi;
  /** Fast-board panel pin only (`fb-*`). Not for user clusters. */
  groupId?: string;
  /** Required when `kind === 'variable'` */
  variable?: SkillVariableMeta;
  /** AI / async node expansion tracking */
  generation?: SkillNodeGeneration;
  /** Bumped on manual edits — AI apply must not clobber newer edits */
  userEditEpoch?: number;
  /** Non-blocking messages from last AI expansion */
  aiWarnings?: string[];
  /** Declared variable reads (MVP; edges with `data_read` are preferred long-term) */
  variableReads?: string[];
  /** Declared variable writes */
  variableWrites?: string[];
}

export interface SkillEdgeV2 {
  id: string;
  source: string;
  target: string;
  kind: SkillEdgeKind;
  label?: string;
  ui?: SkillEdgeUi;
}

/** User-defined cluster (name + color + members). Distinct from fast-board `fb-*` layout groups. */
export interface SkillGroupV2 {
  id: string;
  label: string;
  /** Member skill node ids */
  nodeIds?: string[];
  /** Fixed palette key, e.g. `blue` | `purple` | … */
  colorKey?: string;
  description?: string;
}

export interface SkillMarkdownSnapshot {
  original?: string;
  exported?: string;
  exportedAt?: string;
  lastRoundTripAt?: string;
}

export interface SkillFlowGraphV2 {
  version: typeof SKILL_FLOW_GRAPH_V2_VERSION;
  /** Stable document id (persisted) */
  id: string;
  name: string;
  description?: string;
  sourceType?: 'markdown' | 'visual' | 'mixed';
  markdown?: SkillMarkdownSnapshot;
  nodes: SkillNodeV2[];
  edges: SkillEdgeV2[];
  groups?: SkillGroupV2[];
  /** Last AI/fast layout metadata (optional persistence) */
  layout?: SkillGraphLayoutState;
}

function clampLabel(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function inferNodeKind(n: SkillFlowNode): SkillNodeKind {
  const lab = `${n.label} ${n.description ?? ''}`.toLowerCase();
  if (/goal|objective|purpose/.test(lab)) return 'goal';
  if (/input|read|load|ingest/.test(lab)) return 'input';
  if (/response|final answer|final reply/.test(lab)) return 'response';
  if (/output|write|emit|deliver/.test(lab)) return 'output';
  if (/rule|constraint|must|never/.test(lab)) return 'rule';
  if (/note|context|background/.test(lab)) return 'note';
  if (/decision|branch|if\b|choose/.test(lab)) return 'decision';
  return 'step';
}

/** Linear spine node ids in array order — edges between consecutive nodes become `sequence` */
function migrateEdgesV1(
  nodes: SkillFlowNode[],
  edges: SkillFlowEdge[],
): SkillEdgeV2[] {
  const idSet = new Set(nodes.map((n) => n.id));
  const byOrder = new Map<string, number>();
  nodes.forEach((n, i) => byOrder.set(n.id, i));

  const result: SkillEdgeV2[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    const oS = byOrder.get(e.source) ?? -1;
    const oT = byOrder.get(e.target) ?? -1;
    const sequential = oS >= 0 && oT === oS + 1;
    result.push({
      id: e.id || `e-${i}`,
      source: e.source,
      target: e.target,
      kind: sequential ? 'sequence' : 'depends_on',
      ...(e.label ? { label: e.label } : {}),
    });
  }
  return result;
}

export function migrateSkillFlowGraphV1ToV2(v1: SkillFlowGraphV1): SkillFlowGraphV2 {
  const nodes: SkillNodeV2[] = v1.nodes.map((n) => ({
    id: n.id,
    label: clampLabel(n.label, 48),
    kind: inferNodeKind(n),
    ...(n.description?.trim()
      ? { summary: clampLabel(n.description.trim(), 160), body: n.description.trim() }
      : {}),
    status: 'valid' as const,
    ui: { x: 0, y: 0, width: 220, height: 96, manuallyPositioned: false },
  }));

  const edges = migrateEdgesV1(v1.nodes, v1.edges);

  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: uuidv4(),
    name: v1.name,
    ...(v1.description?.trim() ? { description: v1.description.trim() } : {}),
    nodes,
    edges,
  };
}

export function isSkillNodeKind(x: unknown): x is SkillNodeKind {
  return (
    x === 'goal' ||
    x === 'role' ||
    x === 'input' ||
    x === 'output' ||
    x === 'response' ||
    x === 'step' ||
    x === 'rule' ||
    x === 'note' ||
    x === 'decision' ||
    x === 'group' ||
    x === 'tool' ||
    x === 'validation' ||
    x === 'guardrail' ||
    x === 'example' ||
    x === 'variable'
  );
}

/** Map persisted / legacy status values to `SkillNodeStatus`. */
export function normalizeSkillNodeStatus(raw: unknown): SkillNodeStatus | undefined {
  if (raw === 'ok') return 'valid';
  if (raw === 'warn') return 'warning';
  if (
    raw === 'draft' ||
    raw === 'generating' ||
    raw === 'review' ||
    raw === 'valid' ||
    raw === 'warning' ||
    raw === 'error'
  ) {
    return raw;
  }
  return undefined;
}

function isSkillVariableDataType(x: unknown): x is SkillVariableDataType {
  return (
    x === 'text' ||
    x === 'number' ||
    x === 'boolean' ||
    x === 'list' ||
    x === 'object' ||
    x === 'markdown' ||
    x === 'json' ||
    x === 'unknown'
  );
}

function isSkillVariableArtifactKind(x: unknown): x is SkillVariableArtifactKind {
  return (
    x === 'research-report' ||
    x === 'notes' ||
    x === 'decision-state' ||
    x === 'extracted-data' ||
    x === 'output-draft' ||
    x === 'custom'
  );
}

function isSkillVariableStorage(x: unknown): x is SkillVariableStorage {
  return x === 'in-memory' || x === 'workspace-file';
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

function normalizeSkillVariableMeta(raw: Record<string, unknown>): SkillVariableMeta | undefined {
  const name = typeof raw.variableName === 'string' ? raw.variableName.trim() : '';
  if (!name) return undefined;
  const out: SkillVariableMeta = { variableName: name };
  if (typeof raw.label === 'string' && raw.label.trim()) out.label = raw.label.trim();
  if (isSkillVariableDataType(raw.dataType)) out.dataType = raw.dataType;
  if (isSkillVariableArtifactKind(raw.artifactKind)) out.artifactKind = raw.artifactKind;
  if (isSkillVariableStorage(raw.storage)) out.storage = raw.storage;
  if (typeof raw.pathTemplate === 'string' && raw.pathTemplate.trim()) out.pathTemplate = raw.pathTemplate.trim();
  if (typeof raw.description === 'string' && raw.description.trim()) out.description = raw.description.trim();
  const producedBy = normalizeStringArray(raw.producedBy);
  if (producedBy) out.producedBy = producedBy;
  const consumedBy = normalizeStringArray(raw.consumedBy);
  if (consumedBy) out.consumedBy = consumedBy;
  if (typeof raw.sampleValue === 'string') out.sampleValue = raw.sampleValue;
  if (raw.exportBehavior === 'visual-only' || raw.exportBehavior === 'include-in-markdown')
    out.exportBehavior = raw.exportBehavior;
  return out;
}

function normalizeSkillNodeContract(raw: unknown): SkillNodeContract | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const out: SkillNodeContract = {};
  if (typeof c.purpose === 'string' && c.purpose.trim()) out.purpose = c.purpose.trim();
  const inputs = normalizeStringArray(c.inputs);
  if (inputs) out.inputs = inputs;
  const instructions = normalizeStringArray(c.instructions);
  if (instructions) out.instructions = instructions;
  const outputs = normalizeStringArray(c.outputs);
  if (outputs) out.outputs = outputs;
  const checks = normalizeStringArray(c.checks);
  if (checks) out.checks = checks;
  const failureModes = normalizeStringArray(c.failureModes);
  if (failureModes) out.failureModes = failureModes;
  const examples = normalizeStringArray(c.examples);
  if (examples) out.examples = examples;
  const reads = normalizeStringArray(c.reads);
  if (reads) out.reads = reads;
  const writes = normalizeStringArray(c.writes);
  if (writes) out.writes = writes;
  return Object.keys(out).length ? out : undefined;
}

function isSkillNodeGenerationJobStatus(x: unknown): x is SkillNodeGenerationJobStatus {
  return x === 'pending' || x === 'running' || x === 'succeeded' || x === 'failed' || x === 'cancelled';
}

function isSkillNodeKindForGeneration(x: unknown): x is SkillNodeKind {
  return isSkillNodeKind(x);
}

function normalizeSkillNodeGeneration(raw: Record<string, unknown>): SkillNodeGeneration | undefined {
  const jobId = typeof raw.jobId === 'string' ? raw.jobId.trim() : '';
  if (!jobId) return undefined;
  if (!isSkillNodeGenerationJobStatus(raw.status)) return undefined;
  const userPrompt = typeof raw.userPrompt === 'string' ? raw.userPrompt : '';
  if (!isSkillNodeKindForGeneration(raw.requestedKind)) return undefined;
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt.trim() : '';
  if (!startedAt) return undefined;
  const out: SkillNodeGeneration = {
    jobId,
    status: raw.status,
    userPrompt,
    requestedKind: raw.requestedKind,
    startedAt,
  };
  if (typeof raw.sourceNodeId === 'string' && raw.sourceNodeId.trim()) out.sourceNodeId = raw.sourceNodeId.trim();
  if (typeof raw.finishedAt === 'string' && raw.finishedAt.trim()) out.finishedAt = raw.finishedAt.trim();
  if (typeof raw.error === 'string' && raw.error.trim()) out.error = raw.error.trim();
  return out;
}

function isSkillEdgeSemanticKind(x: unknown): x is SkillEdgeSemanticKind {
  return (
    x === 'main_flow' ||
    x === 'dependency' ||
    x === 'branch' ||
    x === 'parallel' ||
    x === 'support' ||
    x === 'constraint' ||
    x === 'data_read' ||
    x === 'data_write'
  );
}

function isSkillEdgeKind(x: unknown): x is SkillEdgeKind {
  return x === 'sequence' || x === 'depends_on' || x === 'branch' || x === 'parallel';
}

function isEdgeRouteKind(x: unknown): x is EdgeRouteKind {
  return (
    x === 'main' ||
    x === 'branch' ||
    x === 'support' ||
    x === 'constraint' ||
    x === 'validation' ||
    x === 'tool' ||
    x === 'fallback' ||
    x === 'deemphasized'
  );
}

function normalizeSkillEdgeUi(u: Record<string, unknown>): SkillEdgeUi | undefined {
  const out: SkillEdgeUi = {};
  if (isEdgeRouteKind(u.routeKind)) out.routeKind = u.routeKind;
  if (u.visualEmphasis === 'primary' || u.visualEmphasis === 'secondary' || u.visualEmphasis === 'muted')
    out.visualEmphasis = u.visualEmphasis;
  if (typeof u.labelVisible === 'boolean') out.labelVisible = u.labelVisible;
  if (u.bundled === true) out.bundled = true;
  if (typeof u.layoutColorKey === 'string' && u.layoutColorKey.trim()) out.layoutColorKey = u.layoutColorKey.trim();
  if (typeof u.routingPolicy === 'string' && u.routingPolicy.trim()) out.routingPolicy = u.routingPolicy.trim();
  if (isSkillEdgeSemanticKind(u.semanticKind)) out.semanticKind = u.semanticKind;
  return Object.keys(out).length ? out : undefined;
}

function normalizeSkillGraphLayoutState(raw: unknown): SkillGraphLayoutState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const L = raw as Record<string, unknown>;
  const s = L.strategy;
  if (s !== 'manual' && s !== 'fast' && s !== 'ai' && s !== 'fast-board') return undefined;
  const o = L.orientation;
  const orientation =
    o === 'top-to-bottom'
      ? 'top-to-bottom'
      : o === 'radial'
        ? 'radial'
        : 'left-to-right';
  const st: SkillGraphLayoutState = {
    strategy: s,
    orientation,
  };
  if (typeof L.lastLayoutAt === 'string' && L.lastLayoutAt.trim()) st.lastLayoutAt = L.lastLayoutAt.trim();
  if (typeof L.layoutAlgorithmVersion === 'number' && Number.isFinite(L.layoutAlgorithmVersion))
    st.layoutAlgorithmVersion = L.layoutAlgorithmVersion;
  if (typeof L.repairedAt === 'string' && L.repairedAt.trim()) st.repairedAt = L.repairedAt.trim();
  if (typeof L.lastSavedAt === 'string' && L.lastSavedAt.trim()) st.lastSavedAt = L.lastSavedAt.trim();
  if (L.preserveManualPositions === true) st.preserveManualPositions = true;
  if (L.preserveManualPositions === false) st.preserveManualPositions = false;
  if (L.layoutPlan && typeof L.layoutPlan === 'object') {
    const p = L.layoutPlan as Record<string, unknown>;
    const ver = p.version;
    const gid = p.graphId;
    if (
      typeof gid === 'string' &&
      (ver === '1.0' || ver === '2.0' || ver === '3.0')
    ) {
      st.layoutPlan = L.layoutPlan as import('./skillFlowLayoutPlan').SkillLayoutPlanV1 | import('./skillFlowLayoutPlanV2').SkillLayoutPlanV2 | import('./skillFlowLayoutPlanV3').SkillLayoutPlanV3;
    }
  }
  return st;
}

/** Normalize loose JSON into SkillFlowGraphV2 or null */
export function normalizeSkillFlowGraphV2(raw: unknown): SkillFlowGraphV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.version !== SKILL_FLOW_GRAPH_V2_VERSION && o.version !== '2') return null;

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : uuidv4();
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  if (!Array.isArray(o.nodes)) return null;

  const nodes: SkillNodeV2[] = [];
  for (const item of o.nodes) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    const nid = typeof n.id === 'string' ? n.id.trim() : '';
    const label = typeof n.label === 'string' ? n.label.trim() : '';
    if (!nid || !label) continue;
    const kind = isSkillNodeKind(n.kind) ? n.kind : 'step';
    const node: SkillNodeV2 = {
      id: nid,
      label: clampLabel(label, 80),
      kind,
    };
    if (typeof n.summary === 'string' && n.summary.trim()) node.summary = clampLabel(n.summary.trim(), 200);
    if (typeof n.body === 'string' && n.body.trim()) node.body = n.body.trim();
    const contract = normalizeSkillNodeContract(n.contract);
    if (contract) node.contract = contract;
    if (Array.isArray(n.tags))
      node.tags = normalizeStringArray(n.tags);
    if (typeof n.layer === 'number' && Number.isFinite(n.layer)) node.layer = n.layer;
    const st = normalizeSkillNodeStatus(n.status);
    if (st) node.status = st;
    if (typeof n.userEditEpoch === 'number' && Number.isFinite(n.userEditEpoch)) node.userEditEpoch = n.userEditEpoch;
    if (n.variable && typeof n.variable === 'object') {
      const vm = normalizeSkillVariableMeta(n.variable as Record<string, unknown>);
      if (vm) node.variable = vm;
    }
    if (n.generation && typeof n.generation === 'object') {
      const g = normalizeSkillNodeGeneration(n.generation as Record<string, unknown>);
      if (g) node.generation = g;
    }
    if (Array.isArray(n.aiWarnings))
      node.aiWarnings = normalizeStringArray(n.aiWarnings);
    if (Array.isArray(n.variableReads))
      node.variableReads = normalizeStringArray(n.variableReads);
    if (Array.isArray(n.variableWrites))
      node.variableWrites = normalizeStringArray(n.variableWrites);
    if (n.ui && typeof n.ui === 'object') {
      const u = n.ui as Record<string, unknown>;
      node.ui = {};
      if (typeof u.x === 'number' && Number.isFinite(u.x)) node.ui.x = u.x;
      if (typeof u.y === 'number' && Number.isFinite(u.y)) node.ui.y = u.y;
      if (typeof u.width === 'number' && Number.isFinite(u.width)) node.ui.width = u.width;
      if (typeof u.height === 'number' && Number.isFinite(u.height)) node.ui.height = u.height;
      if (u.manuallyPositioned === true) node.ui.manuallyPositioned = true;
      if (typeof u.laneId === 'string' && u.laneId.trim()) node.ui.laneId = u.laneId.trim();
      if (u.visualEmphasis === 'primary' || u.visualEmphasis === 'secondary' || u.visualEmphasis === 'muted')
        node.ui.visualEmphasis = u.visualEmphasis;
      if (u.collapsed === true) node.ui.collapsed = true;
    }
    if (typeof n.groupId === 'string' && n.groupId.trim()) node.groupId = n.groupId.trim();
    nodes.push(node);
  }
  if (!nodes.length) return null;

  const edges: SkillEdgeV2[] = [];
  if (Array.isArray(o.edges)) {
    for (let i = 0; i < o.edges.length; i++) {
      const item = o.edges[i];
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const eid = typeof e.id === 'string' ? e.id.trim() : '';
      const source = typeof e.source === 'string' ? e.source.trim() : '';
      const target = typeof e.target === 'string' ? e.target.trim() : '';
      if (!eid || !source || !target) continue;
      const kind = isSkillEdgeKind(e.kind) ? e.kind : 'depends_on';
      edges.push({
        id: eid,
        source,
        target,
        kind,
        ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
        ...(e.ui && typeof e.ui === 'object'
          ? { ui: normalizeSkillEdgeUi(e.ui as Record<string, unknown>) }
          : {}),
      });
    }
  }

  const groups: SkillGroupV2[] | undefined = Array.isArray(o.groups)
    ? o.groups
        .map((g) => {
          if (!g || typeof g !== 'object') return null;
          const gg = g as Record<string, unknown>;
          const gid = typeof gg.id === 'string' ? gg.id.trim() : '';
          const glabel = typeof gg.label === 'string' ? gg.label.trim() : '';
          if (!gid || !glabel) return null;
          const base: SkillGroupV2 = { id: gid, label: glabel };
          if (Array.isArray(gg.nodeIds)) {
            const nodeIds = gg.nodeIds
              .filter((id): id is string => typeof id === 'string')
              .map((id) => id.trim())
              .filter(Boolean);
            if (nodeIds.length) base.nodeIds = [...new Set(nodeIds)];
          }
          if (typeof gg.colorKey === 'string' && gg.colorKey.trim()) base.colorKey = gg.colorKey.trim();
          if (typeof gg.description === 'string' && gg.description.trim()) base.description = gg.description.trim();
          return base;
        })
        .filter((x): x is SkillGroupV2 => x !== null)
    : undefined;

  const markdown: SkillMarkdownSnapshot | undefined =
    o.markdown && typeof o.markdown === 'object'
      ? {
          ...(typeof (o.markdown as Record<string, unknown>).original === 'string'
            ? { original: String((o.markdown as Record<string, unknown>).original) }
            : {}),
          ...(typeof (o.markdown as Record<string, unknown>).exported === 'string'
            ? { exported: String((o.markdown as Record<string, unknown>).exported) }
            : {}),
          ...(typeof (o.markdown as Record<string, unknown>).exportedAt === 'string'
            ? { exportedAt: String((o.markdown as Record<string, unknown>).exportedAt) }
            : {}),
          ...(typeof (o.markdown as Record<string, unknown>).lastRoundTripAt === 'string'
            ? { lastRoundTripAt: String((o.markdown as Record<string, unknown>).lastRoundTripAt) }
            : {}),
        }
      : undefined;

  const layout = normalizeSkillGraphLayoutState(o.layout);
  const sourceType =
    o.sourceType === 'markdown' || o.sourceType === 'visual' || o.sourceType === 'mixed'
      ? o.sourceType
      : undefined;

  return {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id,
    name,
    ...(typeof o.description === 'string' && o.description.trim()
      ? { description: o.description.trim() }
      : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(markdown && Object.keys(markdown).length ? { markdown } : {}),
    ...(layout ? { layout } : {}),
    nodes,
    edges,
    ...(groups?.length ? { groups } : {}),
  };
}

/** Accept V2 JSON, legacy V1, or SkillFile linear graph */
export function normalizeSkillFlowGraphAny(raw: unknown): SkillFlowGraphV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.version === SKILL_FLOW_GRAPH_V2_VERSION || o.version === '2') {
    return normalizeSkillFlowGraphV2(raw);
  }

  // Inline V2 without strict version (Codex sometimes omits) — detect by nodes having kind
  if (Array.isArray(o.nodes) && o.nodes.length) {
    const first = o.nodes[0];
    if (first && typeof first === 'object' && 'kind' in (first as object)) {
      const patched = { ...o, version: SKILL_FLOW_GRAPH_V2_VERSION };
      const v2 = normalizeSkillFlowGraphV2(patched);
      if (v2) return v2;
    }
  }

  const v1 = normalizeSkillFlowGraph(raw);
  if (v1) return migrateSkillFlowGraphV1ToV2(v1);
  return null;
}

export function parseSkillFlowGraphV2Json(text: string): SkillFlowGraphV2 | null {
  try {
    const raw = JSON.parse(text) as unknown;
    return normalizeSkillFlowGraphV2(raw);
  } catch {
    return null;
  }
}

/** Extract JSON from Codex stdout and normalize to V2 (or migrate V1). */
export function parseSkillFlowGraphAnyFromStdout(stdout: string): { graph: SkillFlowGraphV2 } | { error: string } {
  const blob = extractJsonObject(stdout);
  if (!blob) return { error: 'No JSON object found in Codex output.' };
  try {
    const raw = JSON.parse(blob) as unknown;
    const graph = normalizeSkillFlowGraphAny(raw);
    if (!graph) return { error: 'JSON did not match SkillFlowGraph V2 or legacy V1.' };
    return { graph };
  } catch {
    return { error: 'Invalid JSON from Codex.' };
  }
}

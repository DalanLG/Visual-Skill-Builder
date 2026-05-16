import type { SkillEdgeV2 } from './skillFlowGraphV2';
import type { SkillLayoutPlanV1 } from './skillFlowLayoutPlan';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import { isSkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import { isSkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';

export interface ResolvedEdgeVisual {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
  showLabel: boolean;
}

const MUTED = 'var(--text-muted, #888)';
const ACCENT = 'var(--accent, #6ea8fe)';
export const BRANCH_EDGE_STROKE = '#c9a227';
export const VALIDATION_EDGE_STROKE = '#5cbf7a';
export const WARNING_EDGE_STROKE = '#e07050';
export const RESPONSE_EDGE_STROKE = '#a78bfa';
export const VARIABLE_WRITE_EDGE_STROKE = '#1f4f78';
export const VARIABLE_READ_EDGE_STROKE = '#8fd3e8';

/**
 * React Flow edge markers use SVG `<marker>` — they do not resolve `var(--token)` stroke colours.
 * Map common CSS-variable strokes to opaque colours so arrow heads stay visible.
 */
export function strokeForSvgMarker(stroke: string | undefined): string {
  if (!stroke) return '#94a3b8';
  const s = stroke.trim();
  if (s.startsWith('#') || s.startsWith('rgb') || s.startsWith('rgba')) return s;
  if (s.includes('--accent')) return '#6ea8fe';
  if (s.includes('--text-muted')) return '#888888';
  if (s.includes('--response')) return RESPONSE_EDGE_STROKE;
  return '#cbd5e1';
}

function planForEdge(
  edgeId: string,
  plan?: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
) {
  if (!plan) return undefined;
  return edgePlanMapFor(plan).get(edgeId);
}

const edgePlanMapCache = new WeakMap<object, Map<string, NonNullable<SkillLayoutPlanV1['edgePlans']>[number]>>();
const sourceGroupStrokeCache = new WeakMap<object, Map<string, string | null>>();

function edgePlanMapFor(
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
): Map<string, NonNullable<SkillLayoutPlanV1['edgePlans']>[number]> {
  const cached = edgePlanMapCache.get(plan as object);
  if (cached) return cached;
  const map = new Map<string, NonNullable<SkillLayoutPlanV1['edgePlans']>[number]>();
  for (const p of plan.edgePlans) {
    map.set(p.edgeId, p);
  }
  edgePlanMapCache.set(plan as object, map);
  return map;
}

function sourceGroupStrokeMapFor(
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
): Map<string, string | null> {
  const cached = sourceGroupStrokeCache.get(plan as object);
  if (cached) return cached;
  const map = new Map<string, string | null>();
  if (!('nodeAssignments' in plan) || !Array.isArray((plan as SkillLayoutPlanV2).nodeAssignments)) {
    sourceGroupStrokeCache.set(plan as object, map);
    return map;
  }
  const groupColorById = new Map<string, string | undefined>();
  for (const group of plan.groups ?? []) {
    const ck =
      group && typeof group === 'object' && 'visual' in group && group.visual && typeof group.visual === 'object'
        ? (group.visual as { colorKey?: string }).colorKey
        : undefined;
    groupColorById.set(group.id, typeof ck === 'string' ? ck : undefined);
  }
  for (const assignment of (plan as SkillLayoutPlanV2).nodeAssignments) {
    const colorKey = assignment.groupId ? groupColorById.get(assignment.groupId) : undefined;
    map.set(assignment.nodeId, groupColorKeyToEdgeStroke(colorKey));
  }
  sourceGroupStrokeCache.set(plan as object, map);
  return map;
}

/** Stroke tint from layout group containing the edge source (matches SkillGroupNode borders). */
export function sourceGroupStrokeForEdge(
  edge: SkillEdgeV2,
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3 | undefined,
): string | null {
  if (!plan || typeof plan !== 'object' || !('nodeAssignments' in plan)) return null;
  return sourceGroupStrokeMapFor(plan).get(edge.source) ?? null;
}

function groupColorKeyToEdgeStroke(ck: string | undefined): string | null {
  if (!ck) return null;
  switch (ck) {
    case 'goal':
      return 'rgba(110, 168, 254, 0.95)';
    case 'input':
      return 'rgba(110, 168, 254, 0.88)';
    case 'generation':
      return 'rgba(123, 220, 156, 0.92)';
    case 'rules':
      return 'rgba(180, 180, 200, 0.88)';
    case 'output':
      return 'rgba(120, 200, 255, 0.9)';
    case 'response':
      return RESPONSE_EDGE_STROKE;
    case 'research':
      return 'rgba(180, 140, 255, 0.85)';
    case 'decision':
    case 'scoring':
      return BRANCH_EDGE_STROKE;
    case 'validation':
      return VALIDATION_EDGE_STROKE;
    case 'artifact':
      return VARIABLE_WRITE_EDGE_STROKE;
    default:
      return null;
  }
}

function colorKeyStroke(ck: string | undefined): string | null {
  switch (ck) {
    case 'main':
      return ACCENT;
    case 'decision':
    case 'scoring':
      return BRANCH_EDGE_STROKE;
    case 'validation':
    case 'generation':
      return VALIDATION_EDGE_STROKE;
    case 'artifact':
      return VARIABLE_WRITE_EDGE_STROKE;
    case 'fallback':
      return WARNING_EDGE_STROKE;
    case 'muted':
      return MUTED;
    case 'response':
      return RESPONSE_EDGE_STROKE;
    default:
      return null;
  }
}

export function resolveEdgeVisual(
  edge: SkillEdgeV2,
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3 | undefined,
  opts: {
    selectedNodeId: string | null;
    fadeUnrelated: boolean;
  },
): ResolvedEdgeVisual {
  const ep = planForEdge(edge.id, plan);
  const semantic = edge.ui?.semanticKind;
  const groupStroke = sourceGroupStrokeForEdge(edge, plan);
  if (edge.ui?.layoutColorKey === 'response') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 1;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: RESPONSE_EDGE_STROKE,
      strokeWidth: 3.35,
      opacity,
      showLabel: true,
    };
  }
  if (semantic === 'main_flow') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 1;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: ACCENT,
      strokeWidth: 3,
      opacity,
      showLabel: true,
    };
  }
  if (semantic === 'dependency') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.72;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: groupStroke ?? '#9aa8ff',
      strokeWidth: 2.75,
      strokeDasharray: '6 4',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'branch') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.88;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: BRANCH_EDGE_STROKE,
      strokeWidth: 2.85,
      strokeDasharray: '2 4',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'parallel') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.8;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: groupStroke ?? '#7bdc9c',
      strokeWidth: 2.75,
      strokeDasharray: '4 2',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'constraint') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.78;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: WARNING_EDGE_STROKE,
      strokeWidth: 2.65,
      strokeDasharray: '4 3',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'support') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.56;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: groupStroke ?? MUTED,
      strokeWidth: 2.35,
      strokeDasharray: '6 4',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'data_read') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.88;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: VARIABLE_READ_EDGE_STROKE,
      strokeWidth: 2.7,
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }
  if (semantic === 'data_write') {
    const neighbor =
      opts.selectedNodeId &&
      (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
    let opacity = 0.88;
    if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) opacity *= 0.25;
    return {
      stroke: VARIABLE_WRITE_EDGE_STROKE,
      strokeWidth: 2.8,
      strokeDasharray: '3 5',
      opacity,
      showLabel: ep?.labelVisible ?? true,
    };
  }

  const rk = edge.ui?.routeKind ?? ep?.routeKind;
  const ckRaw =
    edge.ui?.layoutColorKey ??
    (plan && (isSkillLayoutPlanV2(plan) || isSkillLayoutPlanV3(plan)) && ep && 'colorKey' in ep
      ? (ep as { colorKey?: string }).colorKey
      : undefined);
  const ck = typeof ckRaw === 'string' ? ckRaw : undefined;
  const emphasis = edge.ui?.visualEmphasis ?? ep?.visualEmphasis ?? 'secondary';
  const labelVisible = edge.ui?.labelVisible ?? ep?.labelVisible ?? true;

  let stroke = groupStroke ?? MUTED;
  let strokeWidth = 2.35;
  let dash: string | undefined = '6 4';
  let opacity = 0.55;

  const fromKey = colorKeyStroke(ck ?? undefined);
  if (fromKey && ck) {
    stroke = fromKey;
    strokeWidth = ck === 'main' ? 3 : 2.65;
    if (ck === 'muted' || ck === 'fallback') dash = '6 4';
    else dash = undefined;
    opacity = ck === 'muted' ? 0.45 : 0.88;
  } else {
  switch (rk) {
    case 'main':
      stroke = ACCENT;
      strokeWidth = 2.5;
      dash = undefined;
      opacity = 1;
      break;
    case 'branch':
      stroke = BRANCH_EDGE_STROKE;
      strokeWidth = 2;
      opacity = 0.85;
      break;
    case 'validation':
      stroke = VALIDATION_EDGE_STROKE;
      strokeWidth = 2;
      break;
    case 'constraint':
      stroke = WARNING_EDGE_STROKE;
      dash = '4 3';
      opacity = 0.7;
      break;
    case 'fallback':
      stroke = WARNING_EDGE_STROKE;
      dash = '2 6';
      opacity = 0.65;
      break;
    case 'tool':
      stroke = '#8b9cef';
      opacity = 0.75;
      break;
    case 'artifact':
      stroke = VARIABLE_WRITE_EDGE_STROKE;
      strokeWidth = 2;
      dash = '4 3';
      opacity = 0.85;
      break;
    case 'deemphasized':
    case 'support':
    default:
      if (emphasis === 'primary') {
        stroke = ACCENT;
        opacity = 0.9;
        strokeWidth = 2;
        dash = undefined;
      }
      break;
  }
  }

  const neighbor =
    opts.selectedNodeId &&
    (edge.source === opts.selectedNodeId || edge.target === opts.selectedNodeId);
  if (opts.fadeUnrelated && opts.selectedNodeId && !neighbor) {
    opacity *= 0.25;
  }

  return {
    stroke,
    strokeWidth,
    strokeDasharray: dash,
    opacity,
    showLabel: labelVisible && (emphasis !== 'muted' || !!opts.selectedNodeId),
  };
}

/**
 * SkillLayoutPlanV2 — semantic layout intent (strategy, lanes, artifacts). Positions come from the engine.
 */

import type {
  SkillBranchPath,
  LayoutNodeRole,
  SkillLayoutPlanV1,
  SkillLayoutVisualThemeHints,
} from './skillFlowLayoutPlan';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';

export const SKILL_LAYOUT_PLAN_V2_VERSION = '2.0' as const;

export type SkillSemanticLayoutStrategy =
  | 'grouped-workflow'
  | 'mind-map'
  | 'hybrid-map'
  | 'swimlane-workflow'
  | 'decision-tree'
  | 'dataflow';

export type SkillLayoutOrientationV2 = 'left-to-right' | 'top-to-bottom' | 'radial';

export type SkillLayoutGroupKindV2 =
  | 'start'
  | 'input'
  | 'preparation'
  | 'research'
  | 'analysis'
  | 'scoring'
  | 'decision'
  | 'generation'
  | 'validation'
  | 'output'
  | 'response'
  | 'rules'
  | 'tools'
  | 'guardrails'
  | 'examples'
  | 'fallback'
  | 'misc'
  | 'phase'
  | 'task';

export type SkillLayoutGroupLayoutRole =
  | 'main-panel'
  | 'side-panel'
  | 'branch-panel'
  | 'output-panel'
  | 'support-panel'
  | 'data-panel';

export type SkillLayoutGroupColorKeyV2 =
  | 'start'
  | 'input'
  | 'research'
  | 'analysis'
  | 'scoring'
  | 'decision'
  | 'generation'
  | 'validation'
  | 'output'
  | 'response'
  | 'rules'
  | 'tools'
  | 'guardrails'
  | 'artifact'
  | 'neutral'
  | 'goal';

export interface SkillLayoutGroupVisualV2 {
  colorKey: SkillLayoutGroupColorKeyV2;
  emphasis: 'primary' | 'secondary' | 'muted';
  collapsedByDefault?: boolean;
}

export interface SkillLayoutGroupV2 {
  id: string;
  label: string;
  description?: string;
  kind: SkillLayoutGroupKindV2;
  nodeIds: string[];
  order: number;
  laneId?: string;
  layoutRole: SkillLayoutGroupLayoutRole;
  visual: SkillLayoutGroupVisualV2;
}

export type SkillLayoutLaneKindV2 =
  | 'upper-branch'
  | 'main-flow'
  | 'lower-branch'
  | 'support'
  | 'tools'
  | 'rules'
  | 'validation'
  | 'outputs'
  | 'artifact-bus'
  | 'fallbacks'
  | 'decision-branch'
  | 'supporting-rules';

export interface SkillLayoutLaneV2 {
  id: string;
  label: string;
  kind: SkillLayoutLaneKindV2;
  order: number;
  /** Vertical band offset hint (px); optional — engine may infer */
  yBand?: number;
}

export type SkillLayoutNodePlacementV2 =
  | 'center'
  | 'above-main'
  | 'below-main'
  | 'left-sidecar'
  | 'right-sidecar'
  | 'inside-group'
  | 'artifact-bus'
  | 'on-main'
  | 'sidecar';

export type SkillLayoutNodeRoleV2 =
  | LayoutNodeRole
  | 'artifact-source'
  | 'artifact-consumer'
  | 'example';

export interface SkillNodeLayoutAssignmentV2 {
  nodeId: string;
  groupId?: string;
  laneId?: string;
  role: SkillLayoutNodeRoleV2;
  layer: number;
  order: number;
  placement: SkillLayoutNodePlacementV2;
  visualEmphasis: 'primary' | 'secondary' | 'muted';
}

export type EdgeRouteKindV2 =
  | 'main'
  | 'branch'
  | 'support'
  | 'constraint'
  | 'validation'
  | 'tool'
  | 'artifact'
  | 'fallback'
  | 'deemphasized';

export type SkillEdgeColorKeyV2 =
  | 'main'
  | 'research'
  | 'analysis'
  | 'scoring'
  | 'decision'
  | 'generation'
  | 'validation'
  | 'output'
  | 'rule'
  | 'tool'
  | 'guardrail'
  | 'artifact'
  | 'fallback'
  | 'muted';

export type SkillEdgeRoutingPolicyV2 =
  | 'orthogonal-avoid-obstacles'
  | 'direct-with-clearance'
  | 'bus'
  | 'hidden-until-selected';

export interface SkillEdgeLayoutPlanV2 {
  edgeId: string;
  routeKind: EdgeRouteKindV2;
  colorKey?: SkillEdgeColorKeyV2;
  visible: boolean;
  labelVisible: boolean;
  visualEmphasis: 'primary' | 'secondary' | 'muted';
  bundlingHint?: string;
  sourcePortPreference?: 'left' | 'right' | 'top' | 'bottom';
  targetPortPreference?: 'left' | 'right' | 'top' | 'bottom';
  routingPolicy?: SkillEdgeRoutingPolicyV2;
}

export type SkillDataArtifactKind = 'variable' | 'intermediate-result' | 'score-table' | 'research-notes' | 'candidate-list' | 'decision-state' | 'output-draft';

export interface SkillDataArtifactLayoutNode {
  id: string;
  label: string;
  description?: string;
  kind: SkillDataArtifactKind;
  producedBy: string[];
  consumedBy: string[];
  groupId?: string;
  laneId?: string;
  visual: { colorKey: 'artifact'; emphasis: 'primary' | 'secondary' | 'muted' };
  exportBehavior: 'visual-only' | 'include-in-markdown';
  /** Persisted canvas position when user drags artifact nodes */
  ui?: { x?: number; y?: number; manuallyPositioned?: boolean };
}

export interface SkillLayoutConstraintsV2 {
  noEdgesThroughNodes?: boolean;
  noEdgesThroughGroups?: boolean;
  noGroupOverlap?: boolean;
  noNodeOverlap?: boolean;
  preserveManualPositions?: boolean;
  avoidOneLongLine?: boolean;
  maxConsecutiveMainNodesBeforePanelBreak?: number;
  minGroupPadding?: number;
  minEdgeClearance?: number;
}

export interface SkillLayoutQualityTargetsV2 {
  maxEdgeNodeIntersections?: number;
  maxGroupOverlaps?: number;
  preferShortEdges?: boolean;
  preferFewCrossings?: boolean;
  avoidOneLongLine?: boolean;
}

export interface SkillLayoutPlanV2 {
  version: typeof SKILL_LAYOUT_PLAN_V2_VERSION;
  graphId: string;
  layoutTitle?: string;
  strategy: SkillSemanticLayoutStrategy;
  orientation: SkillLayoutOrientationV2;
  intent: string;
  groups: SkillLayoutGroupV2[];
  lanes: SkillLayoutLaneV2[];
  nodeAssignments: SkillNodeLayoutAssignmentV2[];
  edgePlans: SkillEdgeLayoutPlanV2[];
  mainPath: string[];
  branchPaths?: SkillBranchPath[];
  dataArtifacts?: SkillDataArtifactLayoutNode[];
  constraints?: SkillLayoutConstraintsV2;
  qualityTargets?: SkillLayoutQualityTargetsV2;
  visualThemeHints?: SkillLayoutVisualThemeHints;
  warnings?: string[];
}

export type AnySkillLayoutPlan = SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3;

export function isSkillLayoutPlanV2(p: AnySkillLayoutPlan): p is SkillLayoutPlanV2 {
  return p.version === SKILL_LAYOUT_PLAN_V2_VERSION;
}

/** Map legacy V1 kind string to V2 group kind */
function mapGroupKind(k: string): SkillLayoutGroupKindV2 {
  const allowed: SkillLayoutGroupKindV2[] = [
    'phase',
    'task',
    'decision',
    'research',
    'scoring',
    'generation',
    'validation',
    'output',
    'response',
    'rules',
    'tools',
    'guardrails',
    'examples',
    'misc',
  ];
  return (allowed.includes(k as SkillLayoutGroupKindV2) ? k : 'misc') as SkillLayoutGroupKindV2;
}

function mapColorKey(k: string): SkillLayoutGroupColorKeyV2 {
  const allowed: SkillLayoutGroupColorKeyV2[] = [
    'goal',
    'research',
    'decision',
    'scoring',
    'generation',
    'validation',
    'output',
    'response',
    'rules',
    'tools',
    'guardrails',
    'neutral',
  ];
  if (k === 'goal') return 'goal';
  return (allowed.includes(k as SkillLayoutGroupColorKeyV2) ? k : 'neutral') as SkillLayoutGroupColorKeyV2;
}

function inferStrategyFromV1(plan: SkillLayoutPlanV1): SkillSemanticLayoutStrategy {
  const branches = plan.branchPaths?.length ?? 0;
  const lanes = plan.lanes.filter((l) => l.kind === 'decision-branch' || l.kind === 'fallbacks').length;
  if (branches >= 2 || lanes >= 1) return 'swimlane-workflow';
  if (plan.groups.length >= 6) return 'hybrid-map';
  return 'grouped-workflow';
}

/** Convert a validated V1 plan into V2 for the unified engine and prompts. */
export function upgradeV1LayoutPlanToV2(plan: SkillLayoutPlanV1): SkillLayoutPlanV2 {
  const strategy = inferStrategyFromV1(plan);
  const orientation: SkillLayoutOrientationV2 = plan.orientation === 'top-to-bottom' ? 'top-to-bottom' : 'left-to-right';

  const groups: SkillLayoutGroupV2[] = plan.groups.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    kind: mapGroupKind(g.kind),
    nodeIds: [...g.nodeIds],
    order: g.order,
    laneId: g.laneId,
    layoutRole: g.kind === 'rules' || g.kind === 'tools' ? 'support-panel' : 'main-panel',
    visual: {
      colorKey: mapColorKey(g.visual.colorKey),
      emphasis: g.visual.emphasis === 'supporting' ? 'secondary' : g.visual.emphasis,
      collapsedByDefault: g.visual.collapsedByDefault,
    },
  }));

  const lanes: SkillLayoutLaneV2[] = plan.lanes.map((l, i) => {
    let kind: SkillLayoutLaneKindV2 = 'support';
    switch (l.kind) {
      case 'main-flow':
        kind = 'main-flow';
        break;
      case 'fallbacks':
        kind = 'lower-branch';
        break;
      case 'decision-branch':
        kind = 'upper-branch';
        break;
      case 'outputs':
        kind = 'outputs';
        break;
      case 'validation':
        kind = 'validation';
        break;
      case 'tools':
        kind = 'tools';
        break;
      case 'supporting-rules':
        kind = 'supporting-rules';
        break;
      default:
        kind = 'support';
    }
    return {
      id: l.id,
      label: l.label,
      kind,
      order: l.order,
      yBand: i * 180,
    };
  });

  const nodeAssignments: SkillNodeLayoutAssignmentV2[] = plan.nodeAssignments.map((a) => ({
    nodeId: a.nodeId,
    groupId: a.groupId,
    laneId: a.laneId,
    role: a.role,
    layer: a.layer,
    order: a.order,
    placement:
      a.preferredPosition === 'sidecar'
        ? 'right-sidecar'
        : a.preferredPosition === 'above-main'
          ? 'above-main'
          : a.preferredPosition === 'below-main'
            ? 'below-main'
            : 'inside-group',
    visualEmphasis: a.visualEmphasis,
  }));

  const edgePlans: SkillEdgeLayoutPlanV2[] = plan.edgePlans.map((e) => {
    const rk = e.routeKind as EdgeRouteKindV2;
    return {
      edgeId: e.edgeId,
      routeKind: rk,
      colorKey: rk === 'main' ? 'main' : rk === 'branch' ? 'decision' : 'muted',
      visible: true,
      labelVisible: e.labelVisible,
      visualEmphasis: e.visualEmphasis,
      bundlingHint: e.bundlingHint,
      routingPolicy: 'orthogonal-avoid-obstacles',
    };
  });

  return {
    version: SKILL_LAYOUT_PLAN_V2_VERSION,
    graphId: plan.graphId,
    layoutTitle: plan.layoutTitle,
    strategy,
    orientation,
    intent: plan.layoutIntent,
    groups,
    lanes,
    nodeAssignments,
    edgePlans,
    mainPath: [...plan.mainPath],
    ...(plan.branchPaths?.length ? { branchPaths: plan.branchPaths } : {}),
    constraints: {
      avoidOneLongLine: true,
      noEdgesThroughNodes: true,
      noEdgesThroughGroups: true,
      maxConsecutiveMainNodesBeforePanelBreak: 5,
      minGroupPadding: 44,
      minEdgeClearance: 28,
    },
    qualityTargets: {
      avoidOneLongLine: true,
      preferShortEdges: true,
      preferFewCrossings: true,
      maxEdgeNodeIntersections: 0,
      maxGroupOverlaps: 0,
    },
    ...(plan.visualThemeHints ? { visualThemeHints: plan.visualThemeHints } : {}),
    ...(plan.warnings?.length ? { warnings: plan.warnings } : {}),
  };
}

/** Normalize loose AI output toward SkillLayoutPlanV2 (minimal coercion). */
export function coerceRawToSkillLayoutPlanV2(raw: unknown): SkillLayoutPlanV2 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SKILL_LAYOUT_PLAN_V2_VERSION) return null;
  if (typeof o.graphId !== 'string' || typeof o.intent !== 'string') return null;
  if (!Array.isArray(o.groups) || !Array.isArray(o.lanes)) return null;
  if (!Array.isArray(o.nodeAssignments) || !Array.isArray(o.edgePlans)) return null;
  if (!Array.isArray(o.mainPath)) return null;
  const strategies: SkillSemanticLayoutStrategy[] = [
    'grouped-workflow',
    'mind-map',
    'hybrid-map',
    'swimlane-workflow',
    'decision-tree',
    'dataflow',
  ];
  const strategy = strategies.includes(o.strategy as SkillSemanticLayoutStrategy)
    ? (o.strategy as SkillSemanticLayoutStrategy)
    : 'grouped-workflow';
  const orientations: SkillLayoutOrientationV2[] = ['left-to-right', 'top-to-bottom', 'radial'];
  const orientation = orientations.includes(o.orientation as SkillLayoutOrientationV2)
    ? (o.orientation as SkillLayoutOrientationV2)
    : 'left-to-right';

  return {
    ...(raw as SkillLayoutPlanV2),
    strategy,
    orientation,
    intent: o.intent as string,
  };
}

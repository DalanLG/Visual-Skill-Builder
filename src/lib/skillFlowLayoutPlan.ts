/** Semantic layout plan produced by AI or fast heuristics — not pixel coordinates. */
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';

export const SKILL_LAYOUT_PLAN_VERSION = '1.0' as const;

export type SkillLayoutOrientation = 'left-to-right' | 'top-to-bottom';

export type SkillLayoutGroupKind =
  | 'phase'
  | 'task'
  | 'decision'
  | 'research'
  | 'scoring'
  | 'generation'
  | 'validation'
  | 'output'
  | 'rules'
  | 'tools'
  | 'guardrails'
  | 'examples'
  | 'misc';

export type SkillLayoutLaneKind =
  | 'main-flow'
  | 'decision-branch'
  | 'supporting-rules'
  | 'tools'
  | 'validation'
  | 'outputs'
  | 'fallbacks';

export type SkillLayoutColorKey =
  | 'goal'
  | 'research'
  | 'decision'
  | 'scoring'
  | 'generation'
  | 'validation'
  | 'output'
  | 'rules'
  | 'tools'
  | 'guardrails'
  | 'neutral';

export type SkillLayoutGroupEmphasis = 'primary' | 'secondary' | 'supporting';

export interface SkillLayoutGroupVisual {
  colorKey: SkillLayoutColorKey;
  collapsedByDefault?: boolean;
  emphasis: SkillLayoutGroupEmphasis;
}

export interface SkillLayoutGroup {
  id: string;
  label: string;
  description?: string;
  kind: SkillLayoutGroupKind;
  nodeIds: string[];
  order: number;
  laneId?: string;
  visual: SkillLayoutGroupVisual;
}

export interface SkillLayoutLane {
  id: string;
  label: string;
  kind: SkillLayoutLaneKind;
  order: number;
}

export type LayoutNodeRole =
  | 'start'
  | 'main-step'
  | 'substep'
  | 'decision'
  | 'branch'
  | 'support'
  | 'tool'
  | 'rule'
  | 'guardrail'
  | 'validation'
  | 'output'
  | 'final';

export type PreferredPosition = 'above-main' | 'on-main' | 'below-main' | 'sidecar';

export type VisualEmphasis = 'primary' | 'secondary' | 'muted';

export interface SkillNodeLayoutAssignment {
  nodeId: string;
  groupId?: string;
  laneId?: string;
  role: LayoutNodeRole;
  layer: number;
  order: number;
  preferredPosition?: PreferredPosition;
  visualEmphasis: VisualEmphasis;
}

export type EdgeRouteKind =
  | 'main'
  | 'branch'
  | 'support'
  | 'constraint'
  | 'validation'
  | 'tool'
  | 'fallback'
  | 'deemphasized'
  | 'artifact';

export interface SkillEdgeLayoutPlan {
  edgeId: string;
  routeKind: EdgeRouteKind;
  visible: boolean;
  labelVisible: boolean;
  visualEmphasis: VisualEmphasis;
  bundlingHint?: string;
}

export interface SkillBranchPath {
  id: string;
  label: string;
  startNodeId: string;
  nodeIds: string[];
  endNodeId?: string;
  placement: 'upper' | 'lower' | 'parallel';
}

export interface SkillLayoutVisualThemeHints {
  colorMode: 'dark' | 'light' | 'system';
  density: 'compact' | 'comfortable' | 'spacious';
  edgeStyle: 'minimal' | 'balanced' | 'detailed';
}

export interface SkillLayoutPlanV1 {
  version: typeof SKILL_LAYOUT_PLAN_VERSION;
  graphId: string;
  layoutTitle?: string;
  layoutIntent: string;
  orientation: SkillLayoutOrientation;
  groups: SkillLayoutGroup[];
  lanes: SkillLayoutLane[];
  nodeAssignments: SkillNodeLayoutAssignment[];
  edgePlans: SkillEdgeLayoutPlan[];
  mainPath: string[];
  branchPaths?: SkillBranchPath[];
  visualThemeHints?: SkillLayoutVisualThemeHints;
  warnings?: string[];
}

export type LayoutStrategy = 'manual' | 'fast' | 'ai' | 'fast-board';

/** Persisted optional layout metadata + last AI/heuristic plan snapshot */
export interface SkillGraphLayoutState {
  strategy: LayoutStrategy;
  orientation: SkillLayoutOrientation | 'radial';
  lastLayoutAt?: string;
  /** Increment when deterministic fast-board placement rules change (repair-on-open). */
  layoutAlgorithmVersion?: number;
  repairedAt?: string;
  lastSavedAt?: string;
  preserveManualPositions?: boolean;
  layoutPlan?: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3;
}

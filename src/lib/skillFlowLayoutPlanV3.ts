/**
 * SkillLayoutPlanV3 — radial spider / visual-coding strategies + hub metadata.
 */

import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import {
  SKILL_LAYOUT_PLAN_V2_VERSION,
  type SkillSemanticLayoutStrategy,
} from './skillFlowLayoutPlanV2';

export const SKILL_LAYOUT_PLAN_V3_VERSION = '3.0' as const;

export type SkillRadialSectorPlacement =
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  | 'top-left';

export interface SkillRadialSector {
  id: string;
  label: string;
  placement: SkillRadialSectorPlacement;
  groupIds: string[];
  order: number;
}

export type SkillLayoutStrategyV3 =
  | SkillSemanticLayoutStrategy
  | 'radial-spider-map'
  | 'hub-and-spoke'
  | 'visual-coding-board';

export interface SkillLayoutPlanV3 extends Omit<SkillLayoutPlanV2, 'version' | 'strategy'> {
  version: typeof SKILL_LAYOUT_PLAN_V3_VERSION;
  strategy: SkillLayoutStrategyV3;
  centerNodeId?: string;
  radialSectors?: SkillRadialSector[];
}

export function isSkillLayoutPlanV3(p: unknown): p is SkillLayoutPlanV3 {
  return typeof p === 'object' && p !== null && (p as SkillLayoutPlanV3).version === SKILL_LAYOUT_PLAN_V3_VERSION;
}

function mapV3StrategyToV2Engine(s: SkillLayoutStrategyV3): SkillSemanticLayoutStrategy {
  switch (s) {
    case 'radial-spider-map':
    case 'hub-and-spoke':
      return 'mind-map';
    case 'visual-coding-board':
      return 'hybrid-map';
    default:
      return s as SkillSemanticLayoutStrategy;
  }
}

/** Feed grouped ELK engine */
export function v3PlanToV2Engine(plan: SkillLayoutPlanV3): SkillLayoutPlanV2 {
  return {
    ...plan,
    version: SKILL_LAYOUT_PLAN_V2_VERSION,
    strategy: mapV3StrategyToV2Engine(plan.strategy),
  };
}

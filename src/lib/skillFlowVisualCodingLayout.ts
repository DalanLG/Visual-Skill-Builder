import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import { v3PlanToV2Engine } from './skillFlowLayoutPlanV3';
import { runGroupedLayoutEngine } from './skillFlowElkLayout';

/** Visual-coding-board: reuse grouped ELK with hybrid-style V2 mapping until a dedicated board packer lands */
export async function runVisualCodingBoardLayout(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV3,
  preserveManual: boolean,
): Promise<SkillFlowGraphV2> {
  const v2 = v3PlanToV2Engine(plan);
  return runGroupedLayoutEngine(graph, v2, preserveManual);
}

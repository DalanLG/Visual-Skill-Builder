import { mergeInferredArtifactsIntoPlan } from './skillFlowArtifactInference';
import { buildFastBoardSkillLayoutPlan, CURRENT_SKILL_BOARD_LAYOUT_VERSION, runFastBoardLayoutEngine } from './skillFlowBoardLayout';
import { mergeLayoutPlanIntoGraph } from './skillFlowApplyLayoutPlan';
import { detectOneLongStringLayout } from './skillFlowLayoutQuality';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

export interface SkillLayoutRepairResult {
  graph: SkillFlowGraphV2;
  changed: boolean;
  reasons: string[];
}

/** Normalize deterministic layout metadata and coordinates when stale or broken. */
export function repairSkillGraphLayoutIfNeeded(graph: SkillFlowGraphV2): SkillLayoutRepairResult {
  const reasons: string[] = [];
  let need = false;

  const v = graph.layout?.layoutAlgorithmVersion;
  if (v === undefined || v < CURRENT_SKILL_BOARD_LAYOUT_VERSION) {
    need = true;
    reasons.push('layoutAlgorithmVersion missing or outdated');
  }

  if (detectOneLongStringLayout(graph)) {
    need = true;
    reasons.push('long-string layout heuristic');
  }

  const missingPos = graph.nodes.some((n) => n.ui?.x === undefined || n.ui?.y === undefined);
  if (missingPos) {
    need = true;
    reasons.push('missing node positions');
  }

  if (!need) return { graph, changed: false, reasons: [] };

  const preserve = graph.layout?.preserveManualPositions ?? true;
  let plan = buildFastBoardSkillLayoutPlan(graph);
  plan = mergeInferredArtifactsIntoPlan(plan, graph);
  const merged = mergeLayoutPlanIntoGraph(graph, plan, 'fast-board', preserve);
  let next = runFastBoardLayoutEngine(merged, preserve);
  const now = new Date().toISOString();
  next = {
    ...next,
    layout: {
      ...next.layout!,
      repairedAt: now,
    },
  };

  return { graph: next, changed: true, reasons };
}

import { extractJsonObject } from './mdSkillTaskImport';
import type { SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';
import type { SkillGraphLayoutState, SkillLayoutPlanV1 } from './skillFlowLayoutPlan';
import { SKILL_LAYOUT_PLAN_VERSION } from './skillFlowLayoutPlan';
import {
  SKILL_LAYOUT_PLAN_V3_VERSION,
  isSkillLayoutPlanV3,
  type SkillLayoutPlanV3,
  v3PlanToV2Engine,
} from './skillFlowLayoutPlanV3';
import {
  SKILL_LAYOUT_PLAN_V2_VERSION,
  type SkillLayoutPlanV2,
  upgradeV1LayoutPlanToV2,
  isSkillLayoutPlanV2,
} from './skillFlowLayoutPlanV2';
import { runFastBoardLayoutEngine } from './skillFlowBoardLayout';
import { runGroupedLayoutEngine } from './skillFlowElkLayout';
import { isRadialLikeStrategy, runRadialSpiderLayout } from './skillFlowRadialLayout';
import { runVisualCodingBoardLayout } from './skillFlowVisualCodingLayout';

export { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';

/** Parsed layout plan with semantic coordinates + edge metadata (V2 or V3). */
export function isSemanticLayoutPlan(p: unknown): p is SkillLayoutPlanV2 | SkillLayoutPlanV3 {
  if (!p || typeof p !== 'object') return false;
  const v = (p as { version?: unknown }).version;
  return v === SKILL_LAYOUT_PLAN_V2_VERSION || v === SKILL_LAYOUT_PLAN_V3_VERSION;
}

export function toSkillLayoutPlanV2(
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
): SkillLayoutPlanV2 {
  if (isSkillLayoutPlanV3(plan)) return v3PlanToV2Engine(plan);
  return isSkillLayoutPlanV2(plan) ? plan : upgradeV1LayoutPlanToV2(plan);
}

function mergePlanMetadata(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV2 | SkillLayoutPlanV3,
  strategy: SkillGraphLayoutState['strategy'],
): SkillFlowGraphV2 {
  const planGroups = plan.groups ?? [];
  const planAssignments = plan.nodeAssignments ?? [];
  const planEdgePlans = plan.edgePlans ?? [];

  const groupLabels = new Map(planGroups.map((g) => [g.id, g.label] as const));
  const nodes: SkillNodeV2[] = graph.nodes.map((n) => {
    const a = planAssignments.find((x) => x.nodeId === n.id);
    return {
      ...n,
      ...(a?.groupId ? { groupId: a.groupId } : {}),
      ui: {
        ...n.ui,
        ...(a?.laneId ? { laneId: a.laneId } : {}),
        ...(a ? { visualEmphasis: a.visualEmphasis } : {}),
      },
    };
  });

  const edges: SkillEdgeV2[] = graph.edges.map((e) => {
    const ep = planEdgePlans.find((x) => x.edgeId === e.id);
    if (!ep) return e;
    return {
      ...e,
      ui: {
        ...(e.ui ?? {}),
        routeKind: ep.routeKind,
        visualEmphasis: ep.visualEmphasis,
        labelVisible: ep.labelVisible,
        ...(ep.colorKey ? { layoutColorKey: ep.colorKey } : {}),
        ...(ep.routingPolicy ? { routingPolicy: ep.routingPolicy } : {}),
      },
    };
  });

  const groups = planGroups.map((g) => ({
    id: g.id,
    label: groupLabels.get(g.id) ?? g.label,
  }));

  const layout: SkillGraphLayoutState = {
    strategy,
    orientation:
      plan.orientation === 'radial'
        ? 'radial'
        : plan.orientation === 'top-to-bottom'
          ? 'top-to-bottom'
          : 'left-to-right',
    lastLayoutAt: new Date().toISOString(),
    layoutPlan: plan,
  };

  return {
    ...graph,
    nodes,
    edges,
    groups,
    layout,
  };
}

/** Merge semantic plan into graph (groups, assignments, edge UI). Does not compute coordinates. */
export function mergeLayoutPlanIntoGraph(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
  strategy: SkillGraphLayoutState['strategy'],
  preserveManualPositions?: boolean,
): SkillFlowGraphV2 {
  const unified = isSkillLayoutPlanV3(plan) ? plan : toSkillLayoutPlanV2(plan);
  const base = mergePlanMetadata(graph, unified, strategy);
  if (!base.layout) return base;
  return {
    ...base,
    layout: {
      ...base.layout,
      ...(preserveManualPositions !== undefined ? { preserveManualPositions } : {}),
    },
  };
}

export async function applySkillLayoutPlan(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
  options: { preserveManualPositions: boolean; strategy: SkillGraphLayoutState['strategy'] },
): Promise<SkillFlowGraphV2> {
  if (options.strategy === 'fast-board') {
    const unified = isSkillLayoutPlanV3(plan) ? v3PlanToV2Engine(plan) : toSkillLayoutPlanV2(plan);
    const merged = mergeLayoutPlanIntoGraph(graph, unified, 'fast-board', options.preserveManualPositions);
    return Promise.resolve(runFastBoardLayoutEngine(merged, options.preserveManualPositions));
  }

  const merged = mergeLayoutPlanIntoGraph(graph, plan, options.strategy, options.preserveManualPositions);

  if (isSkillLayoutPlanV3(plan)) {
    if (plan.strategy === 'visual-coding-board') {
      return runVisualCodingBoardLayout(merged, plan, options.preserveManualPositions);
    }
    if (isRadialLikeStrategy(plan.strategy)) {
      return runRadialSpiderLayout(merged, plan, options.preserveManualPositions);
    }
    const v2 = v3PlanToV2Engine(plan);
    return runGroupedLayoutEngine(merged, v2, options.preserveManualPositions);
  }

  const v2 = toSkillLayoutPlanV2(plan);
  return runGroupedLayoutEngine(merged, v2, options.preserveManualPositions);
}

export function parseSkillLayoutPlanFromCodexOutput(stdout: string, stderr: string): SkillLayoutPlanV2 | SkillLayoutPlanV3 | null {
  return parseSkillLayoutPlanFromStdout(stdout) ?? parseSkillLayoutPlanFromStdout(stderr);
}

export function parseSkillLayoutPlanFromStdout(stdout: string): SkillLayoutPlanV2 | SkillLayoutPlanV3 | null {
  const blob = extractJsonObject(stdout);
  if (!blob) return null;
  try {
    const raw = JSON.parse(blob) as unknown;
    return parseSkillLayoutPlanJson(raw);
  } catch {
    return null;
  }
}

/** Loose parse — validate before apply */
export function parseSkillLayoutPlanJson(raw: unknown): SkillLayoutPlanV2 | SkillLayoutPlanV3 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.version === SKILL_LAYOUT_PLAN_V3_VERSION) {
    if (typeof o.graphId !== 'string' || typeof o.intent !== 'string') return null;
    if (!Array.isArray(o.groups) || !Array.isArray(o.lanes)) return null;
    if (!Array.isArray(o.nodeAssignments) || !Array.isArray(o.edgePlans)) return null;
    if (!Array.isArray(o.mainPath)) return null;
    return raw as SkillLayoutPlanV3;
  }

  if (o.version === SKILL_LAYOUT_PLAN_V2_VERSION) {
    if (typeof o.graphId !== 'string' || typeof o.intent !== 'string') return null;
    if (!Array.isArray(o.groups) || !Array.isArray(o.lanes)) return null;
    if (!Array.isArray(o.nodeAssignments) || !Array.isArray(o.edgePlans)) return null;
    if (!Array.isArray(o.mainPath)) return null;
    return raw as SkillLayoutPlanV2;
  }

  if (o.version === SKILL_LAYOUT_PLAN_VERSION) {
    if (typeof o.graphId !== 'string' || typeof o.layoutIntent !== 'string') return null;
    if (!Array.isArray(o.groups) || !Array.isArray(o.lanes)) return null;
    if (!Array.isArray(o.nodeAssignments) || !Array.isArray(o.edgePlans)) return null;
    if (!Array.isArray(o.mainPath)) return null;
    return upgradeV1LayoutPlanToV2(raw as SkillLayoutPlanV1);
  }

  return null;
}

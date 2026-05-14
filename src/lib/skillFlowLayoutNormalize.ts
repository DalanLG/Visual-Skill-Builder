import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import type { SkillBranchPath, SkillLayoutPlanV1 } from './skillFlowLayoutPlan';
import type {
  SkillDataArtifactKind,
  SkillDataArtifactLayoutNode,
  SkillLayoutPlanV2,
} from './skillFlowLayoutPlanV2';
import {
  SKILL_LAYOUT_PLAN_V3_VERSION,
  isSkillLayoutPlanV3,
  type SkillLayoutPlanV3,
  v3PlanToV2Engine,
} from './skillFlowLayoutPlanV3';
import { toSkillLayoutPlanV2 } from './skillFlowApplyLayoutPlan';

const ARTIFACT_KINDS = new Set<SkillDataArtifactKind>([
  'variable',
  'intermediate-result',
  'score-table',
  'research-notes',
  'candidate-list',
  'decision-state',
  'output-draft',
]);

function firstStringArray(...candidates: unknown[]): string[] {
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const ids = c.filter((x): x is string => typeof x === 'string');
    if (ids.length > 0) return ids;
  }
  return [];
}

/**
 * Codex often emits producerIds / snake_case; schema uses producedBy + consumedBy.
 * Also fills required visual / exportBehavior when the model omits them.
 */
export function normalizeDataArtifactsForGraph(
  raw: unknown,
  graphIds: Set<string>,
): SkillDataArtifactLayoutNode[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: SkillDataArtifactLayoutNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : null;
    if (!id) continue;
    const label = typeof o.label === 'string' ? o.label : id;

    let producedBy = firstStringArray(
      o.producedBy,
      o.producerIds,
      o.producers,
      o.produced_by,
      o.producer_ids,
    ).filter((nid) => graphIds.has(nid));
    let consumedBy = firstStringArray(
      o.consumedBy,
      o.consumerIds,
      o.consumers,
      o.consumed_by,
      o.consumer_ids,
    ).filter((nid) => graphIds.has(nid));

    const kindRaw = typeof o.kind === 'string' ? o.kind : '';
    const kind: SkillDataArtifactKind = ARTIFACT_KINDS.has(kindRaw as SkillDataArtifactKind)
      ? (kindRaw as SkillDataArtifactKind)
      : 'intermediate-result';

    let visual: SkillDataArtifactLayoutNode['visual'] = {
      colorKey: 'artifact',
      emphasis: 'secondary',
    };
    if (o.visual && typeof o.visual === 'object') {
      const v = o.visual as Record<string, unknown>;
      const em = v.emphasis;
      if (
        v.colorKey === 'artifact' &&
        (em === 'primary' || em === 'secondary' || em === 'muted')
      ) {
        visual = { colorKey: 'artifact', emphasis: em };
      }
    }

    const exportBehavior: SkillDataArtifactLayoutNode['exportBehavior'] =
      o.exportBehavior === 'include-in-markdown' || o.export_behavior === 'include-in-markdown'
        ? 'include-in-markdown'
        : 'visual-only';

    const description = typeof o.description === 'string' ? o.description : undefined;
    const groupId = typeof o.groupId === 'string' ? o.groupId : undefined;
    const laneId = typeof o.laneId === 'string' ? o.laneId : undefined;

    let ui: SkillDataArtifactLayoutNode['ui'] | undefined;
    if (o.ui && typeof o.ui === 'object') {
      const u = o.ui as Record<string, unknown>;
      ui = {};
      if (typeof u.x === 'number' && Number.isFinite(u.x)) ui.x = u.x;
      if (typeof u.y === 'number' && Number.isFinite(u.y)) ui.y = u.y;
      if (u.manuallyPositioned === true) ui.manuallyPositioned = true;
      if (!Object.keys(ui).length) ui = undefined;
    }

    out.push({
      id,
      label,
      ...(description ? { description } : {}),
      kind,
      producedBy,
      consumedBy,
      ...(groupId ? { groupId } : {}),
      ...(laneId ? { laneId } : {}),
      visual,
      exportBehavior,
      ...(ui ? { ui } : {}),
    });
  }
  return out.length ? out : undefined;
}

function graphNodeSet(graph: SkillFlowGraphV2): Set<string> {
  return new Set(graph.nodes.map((n) => n.id));
}

/** Loose AI branch row — models may omit camelCase or use snake_case */
function coerceBranchPath(raw: unknown, graphIds: Set<string>, index: number): SkillBranchPath | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === 'string' ? o.id : `branch-${index}`;
  const label = typeof o.label === 'string' ? o.label : id;

  let nodeIds: string[] = [];
  if (Array.isArray(o.nodeIds)) {
    nodeIds = o.nodeIds.filter((x): x is string => typeof x === 'string' && graphIds.has(x));
  } else if (Array.isArray(o.node_ids)) {
    nodeIds = o.node_ids.filter((x): x is string => typeof x === 'string' && graphIds.has(x));
  }

  let start =
    (typeof o.startNodeId === 'string' && graphIds.has(o.startNodeId) ? o.startNodeId : null) ??
    (typeof o.start_node_id === 'string' && graphIds.has(o.start_node_id) ? o.start_node_id : null);

  if (!start && nodeIds.length > 0) {
    start = nodeIds[0];
  }

  if (!start || !graphIds.has(start)) {
    return null;
  }

  const placementRaw = o.placement;
  const placement: SkillBranchPath['placement'] =
    placementRaw === 'upper' || placementRaw === 'lower' || placementRaw === 'parallel'
      ? placementRaw
      : 'parallel';

  let endNodeId: string | undefined;
  if (typeof o.endNodeId === 'string' && graphIds.has(o.endNodeId)) endNodeId = o.endNodeId;
  else if (typeof o.end_node_id === 'string' && graphIds.has(o.end_node_id)) endNodeId = o.end_node_id;

  return {
    id,
    label,
    startNodeId: start,
    nodeIds: nodeIds.length ? nodeIds : [start],
    ...(endNodeId ? { endNodeId } : {}),
    placement,
  };
}

/**
 * Fix common Codex layout-plan mistakes so validation + ELK can run.
 * Safe to call after parseSkillLayoutPlanJson / parseSkillLayoutPlanFromStdout.
 */
export function normalizeSkillLayoutPlanForGraph(
  plan: SkillLayoutPlanV1 | SkillLayoutPlanV2 | SkillLayoutPlanV3,
  graph: SkillFlowGraphV2,
): SkillLayoutPlanV2 | SkillLayoutPlanV3 {
  const v3In = isSkillLayoutPlanV3(plan);
  const v3Extra = v3In
    ? {
        strategy: plan.strategy,
        centerNodeId: plan.centerNodeId,
        radialSectors: plan.radialSectors,
      }
    : null;

  const v2 = v3In ? v3PlanToV2Engine(plan) : toSkillLayoutPlanV2(plan);
  const graphIds = graphNodeSet(graph);

  const mainPathRaw = Array.isArray(v2.mainPath) ? v2.mainPath : [];
  const mainPath = mainPathRaw.filter((id) => graphIds.has(id));

  const groupsRaw = Array.isArray(v2.groups) ? v2.groups : [];
  const groups = groupsRaw.map((g) => ({
    ...g,
    nodeIds: (Array.isArray(g.nodeIds) ? g.nodeIds : []).filter((id) => graphIds.has(id)),
    layoutRole: g.layoutRole ?? ('main-panel' as const),
  }));

  const lanes = Array.isArray(v2.lanes) ? v2.lanes : [];
  const nodeAssignments = Array.isArray(v2.nodeAssignments) ? v2.nodeAssignments : [];
  const edgePlans = Array.isArray(v2.edgePlans) ? v2.edgePlans : [];

  const cleanedBranches: SkillBranchPath[] = [];
  if (v2.branchPaths?.length) {
    for (let i = 0; i < v2.branchPaths.length; i++) {
      const c = coerceBranchPath(v2.branchPaths[i], graphIds, i);
      if (c) cleanedBranches.push(c);
    }
  }

  const dataArtifacts = normalizeDataArtifactsForGraph(v2.dataArtifacts, graphIds);

  const { branchPaths: _dropBranches, dataArtifacts: _dropArtifacts, ...planRest } = v2;

  const base = {
    ...planRest,
    lanes,
    nodeAssignments,
    edgePlans,
    mainPath,
    groups,
    ...(cleanedBranches.length ? { branchPaths: cleanedBranches } : {}),
    ...(dataArtifacts?.length ? { dataArtifacts } : {}),
  };

  if (v3Extra) {
    return {
      ...base,
      version: SKILL_LAYOUT_PLAN_V3_VERSION,
      strategy: v3Extra.strategy,
      ...(v3Extra.centerNodeId ? { centerNodeId: v3Extra.centerNodeId } : {}),
      ...(v3Extra.radialSectors?.length ? { radialSectors: v3Extra.radialSectors } : {}),
    } as SkillLayoutPlanV3;
  }

  return base as SkillLayoutPlanV2;
}

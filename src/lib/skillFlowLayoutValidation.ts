import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_LAYOUT_PLAN_V2_VERSION } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import { SKILL_LAYOUT_PLAN_V3_VERSION, isSkillLayoutPlanV3, type SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';

export interface SkillLayoutPlanIssue {
  severity: 'error' | 'warn';
  code: string;
  message: string;
}

export interface SkillLayoutPlanValidationResult {
  ok: boolean;
  issues: SkillLayoutPlanIssue[];
}

export function validateSkillLayoutPlan(
  plan: SkillLayoutPlanV2 | SkillLayoutPlanV3,
  graph: SkillFlowGraphV2,
): SkillLayoutPlanValidationResult {
  const issues: SkillLayoutPlanIssue[] = [];

  const ver = plan.version;
  if (ver !== SKILL_LAYOUT_PLAN_V2_VERSION && ver !== SKILL_LAYOUT_PLAN_V3_VERSION) {
    issues.push({
      severity: 'error',
      code: 'bad_version',
      message: `Expected layout plan version "${SKILL_LAYOUT_PLAN_V2_VERSION}" or "${SKILL_LAYOUT_PLAN_V3_VERSION}", got "${String(ver)}".`,
    });
  }

  if (plan.graphId !== graph.id) {
    issues.push({
      severity: 'error',
      code: 'graph_id_mismatch',
      message: `Plan graphId "${plan.graphId}" does not match graph.id "${graph.id}".`,
    });
  }

  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  if (isSkillLayoutPlanV3(plan) && plan.centerNodeId && !nodeIds.has(plan.centerNodeId)) {
    issues.push({
      severity: 'error',
      code: 'center_unknown',
      message: `centerNodeId "${plan.centerNodeId}" is not a graph node.`,
    });
  }

  const edgeIds = new Set(graph.edges.map((e) => e.id));

  const groupIds = new Set<string>();
  for (const g of plan.groups) {
    if (groupIds.has(g.id)) {
      issues.push({ severity: 'error', code: 'duplicate_group_id', message: `Duplicate group id: ${g.id}` });
    }
    groupIds.add(g.id);
    for (const nid of g.nodeIds) {
      if (!nodeIds.has(nid)) {
        issues.push({
          severity: 'error',
          code: 'group_unknown_node',
          message: `Group ${g.id} references unknown node ${nid}`,
        });
      }
    }
  }

  const laneIds = new Set<string>();
  for (const l of plan.lanes) {
    if (laneIds.has(l.id)) {
      issues.push({ severity: 'error', code: 'duplicate_lane_id', message: `Duplicate lane id: ${l.id}` });
    }
    laneIds.add(l.id);
  }

  const assignedNodes = new Map<string, number>();
  for (const a of plan.nodeAssignments) {
    assignedNodes.set(a.nodeId, (assignedNodes.get(a.nodeId) ?? 0) + 1);
    if (!nodeIds.has(a.nodeId)) {
      issues.push({
        severity: 'error',
        code: 'assignment_unknown_node',
        message: `Assignment references unknown node ${a.nodeId}`,
      });
    }
    if (a.groupId && !groupIds.has(a.groupId)) {
      issues.push({
        severity: 'error',
        code: 'assignment_unknown_group',
        message: `Node ${a.nodeId} references unknown group ${a.groupId}`,
      });
    }
    if (a.laneId && !laneIds.has(a.laneId)) {
      issues.push({
        severity: 'error',
        code: 'assignment_unknown_lane',
        message: `Node ${a.nodeId} references unknown lane ${a.laneId}`,
      });
    }
  }

  for (const id of nodeIds) {
    const c = assignedNodes.get(id) ?? 0;
    if (c !== 1) {
      issues.push({
        severity: 'error',
        code: 'assignment_count',
        message: `Node ${id} must have exactly one layout assignment (found ${c}).`,
      });
    }
  }

  const edgePlanIds = new Set<string>();
  for (const ep of plan.edgePlans) {
    if (edgePlanIds.has(ep.edgeId)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_edge_plan',
        message: `Duplicate edge plan for ${ep.edgeId}`,
      });
    }
    edgePlanIds.add(ep.edgeId);
    if (!edgeIds.has(ep.edgeId)) {
      issues.push({
        severity: 'error',
        code: 'edge_plan_unknown',
        message: `Edge plan references unknown edge ${ep.edgeId}`,
      });
    }
  }

  for (const id of plan.mainPath) {
    if (!nodeIds.has(id)) {
      issues.push({
        severity: 'error',
        code: 'main_path_unknown',
        message: `mainPath references unknown node ${id}`,
      });
    }
  }

  if (plan.branchPaths) {
    for (const bp of plan.branchPaths) {
      if (!nodeIds.has(bp.startNodeId)) {
        issues.push({
          severity: 'error',
          code: 'branch_start_unknown',
          message: `Branch ${bp.id} unknown startNodeId ${bp.startNodeId}`,
        });
      }
      for (const nid of bp.nodeIds) {
        if (!nodeIds.has(nid)) {
          issues.push({
            severity: 'error',
            code: 'branch_node_unknown',
            message: `Branch ${bp.id} unknown node ${nid}`,
          });
        }
      }
      if (bp.endNodeId && !nodeIds.has(bp.endNodeId)) {
        issues.push({
          severity: 'error',
          code: 'branch_end_unknown',
          message: `Branch ${bp.id} unknown endNodeId ${bp.endNodeId}`,
        });
      }
    }
  }

  if (plan.dataArtifacts?.length) {
    const artifactIds = new Set<string>();
    for (const art of plan.dataArtifacts) {
      if (artifactIds.has(art.id)) {
        issues.push({ severity: 'error', code: 'duplicate_artifact_id', message: `Duplicate artifact id ${art.id}` });
      }
      artifactIds.add(art.id);
      if (nodeIds.has(art.id)) {
        issues.push({
          severity: 'error',
          code: 'artifact_collides_with_node',
          message: `Artifact id ${art.id} collides with a skill node id.`,
        });
      }
      for (const pid of Array.isArray(art.producedBy) ? art.producedBy : []) {
        if (!nodeIds.has(pid)) {
          issues.push({
            severity: 'error',
            code: 'artifact_unknown_producer',
            message: `Artifact ${art.id} unknown producer ${pid}`,
          });
        }
      }
      for (const cid of Array.isArray(art.consumedBy) ? art.consumedBy : []) {
        if (!nodeIds.has(cid)) {
          issues.push({
            severity: 'error',
            code: 'artifact_unknown_consumer',
            message: `Artifact ${art.id} unknown consumer ${cid}`,
          });
        }
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return { ok: errors.length === 0, issues };
}

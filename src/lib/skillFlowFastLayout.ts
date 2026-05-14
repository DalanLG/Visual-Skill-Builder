import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import type {
  SkillBranchPath,
  SkillEdgeLayoutPlan,
  SkillLayoutGroup,
  SkillLayoutLane,
  SkillLayoutPlanV1,
  SkillNodeLayoutAssignment,
} from './skillFlowLayoutPlan';
import { SKILL_LAYOUT_PLAN_VERSION } from './skillFlowLayoutPlan';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import { upgradeV1LayoutPlanToV2 } from './skillFlowLayoutPlanV2';

const G_INPUT = 'g-input';
const G_CORE = 'g-core';
const G_RULES = 'g-rules';
const G_OUT = 'g-output';

function kindToGroupId(kind: string): string {
  switch (kind) {
    case 'goal':
    case 'role':
    case 'input':
      return G_INPUT;
    case 'output':
      return G_OUT;
    case 'rule':
    case 'note':
      return G_RULES;
    default:
      return G_CORE;
  }
}

function inferMainPath(graph: SkillFlowGraphV2): string[] {
  const seq = graph.edges.filter((e) => e.kind === 'sequence');
  const next = new Map(seq.map((e) => [e.source, e.target] as const));
  const start =
    graph.nodes.find((n) => n.kind === 'goal') ??
    graph.nodes.find((n) => n.kind === 'input') ??
    graph.nodes[0];
  if (!start) return [];
  const path: string[] = [start.id];
  let cur = start.id;
  const guard = new Set<string>(path);
  while (next.has(cur)) {
    cur = next.get(cur)!;
    if (guard.has(cur)) break;
    guard.add(cur);
    path.push(cur);
  }
  return path;
}

function roleFromKind(kind: string): SkillNodeLayoutAssignment['role'] {
  switch (kind) {
    case 'goal':
      return 'start';
    case 'decision':
      return 'decision';
    case 'output':
      return 'final';
    case 'rule':
      return 'rule';
    default:
      return 'main-step';
  }
}

/** Deterministic semantic layout plan without LLM — used as Fast layout + AI fallback */
export function buildFastSkillLayoutPlan(graph: SkillFlowGraphV2): SkillLayoutPlanV2 {
  const mainPath = inferMainPath(graph);
  const mainSet = new Set(mainPath);

  const lanes: SkillLayoutLane[] = [
    { id: 'lane-main', label: 'Main workflow', kind: 'main-flow', order: 0 },
    { id: 'lane-support', label: 'Supporting', kind: 'supporting-rules', order: 1 },
  ];

  const groups: SkillLayoutGroup[] = [
    {
      id: G_INPUT,
      label: 'Goal & Input',
      kind: 'phase',
      nodeIds: [],
      order: 0,
      laneId: 'lane-main',
      visual: { colorKey: 'goal', emphasis: 'primary' },
    },
    {
      id: G_CORE,
      label: 'Core workflow',
      kind: 'task',
      nodeIds: [],
      order: 1,
      laneId: 'lane-main',
      visual: { colorKey: 'generation', emphasis: 'primary' },
    },
    {
      id: G_RULES,
      label: 'Rules & notes',
      kind: 'rules',
      nodeIds: [],
      order: 2,
      laneId: 'lane-support',
      visual: { colorKey: 'rules', emphasis: 'supporting' },
    },
    {
      id: G_OUT,
      label: 'Output',
      kind: 'output',
      nodeIds: [],
      order: 3,
      laneId: 'lane-main',
      visual: { colorKey: 'output', emphasis: 'secondary' },
    },
  ];

  const groupNodeIds = new Map<string, string[]>([
    [G_INPUT, []],
    [G_CORE, []],
    [G_RULES, []],
    [G_OUT, []],
  ]);

  for (const n of graph.nodes) {
    const gid = kindToGroupId(n.kind);
    groupNodeIds.get(gid)?.push(n.id);
  }

  for (const g of groups) {
    g.nodeIds = groupNodeIds.get(g.id) ?? [];
  }

  const nodeAssignments: SkillNodeLayoutAssignment[] = graph.nodes.map((n, order) => {
    const gid = kindToGroupId(n.kind);
    const onMain = mainSet.has(n.id);
    return {
      nodeId: n.id,
      groupId: gid,
      laneId: gid === G_RULES ? 'lane-support' : 'lane-main',
      role: roleFromKind(n.kind),
      layer: order,
      order,
      preferredPosition: onMain ? 'on-main' : 'sidecar',
      visualEmphasis: onMain ? 'primary' : 'secondary',
    };
  });

  const edgePlans: SkillEdgeLayoutPlan[] = graph.edges.map((e) => {
    const idxS = mainPath.indexOf(e.source);
    const idxT = mainPath.indexOf(e.target);
    const onMain = mainSet.has(e.source) && mainSet.has(e.target) && Math.abs(idxS - idxT) === 1;
    let routeKind: SkillEdgeLayoutPlan['routeKind'] = 'support';
    if (e.kind === 'sequence' && onMain) routeKind = 'main';
    else if (e.kind === 'branch') routeKind = 'branch';
    else if (e.kind === 'depends_on') routeKind = 'support';
    else if (e.kind === 'parallel') routeKind = 'fallback';

    const emphasize = routeKind === 'main' ? 'primary' : 'muted';
    return {
      edgeId: e.id,
      routeKind,
      visible: true,
      labelVisible: routeKind === 'main',
      visualEmphasis: emphasize,
    };
  });

  const branchPaths: SkillBranchPath[] | undefined =
    graph.edges.some((e) => e.kind === 'branch')
      ? [
          {
            id: 'bp-branch',
            label: 'Branches',
            startNodeId: mainPath[0] ?? graph.nodes[0]?.id ?? '',
            nodeIds: graph.nodes.filter((n) => n.kind === 'decision').map((n) => n.id),
            placement: 'parallel',
          },
        ]
      : undefined;

  const v1: SkillLayoutPlanV1 = {
    version: SKILL_LAYOUT_PLAN_VERSION,
    graphId: graph.id,
    layoutIntent: 'Fast deterministic grouping by node kind and sequence main path',
    orientation: 'left-to-right',
    groups,
    lanes,
    nodeAssignments,
    edgePlans,
    mainPath,
    ...(branchPaths ? { branchPaths } : {}),
  };

  let v2 = upgradeV1LayoutPlanToV2(v1);
  if (graph.nodes.length > 14 && v2.strategy !== 'swimlane-workflow') {
    v2 = { ...v2, strategy: 'hybrid-map' };
  }
  return v2;
}

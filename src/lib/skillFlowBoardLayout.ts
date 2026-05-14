/**
 * Deterministic fast-board layout: classify → grouped panels → grid placement (anti-long-line).
 * Coordinates are computed here — no ELK / Codex.
 */

import type { SkillEdgeSemanticKind, SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';
import { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';
import type {
  SkillEdgeLayoutPlanV2,
  SkillLayoutGroupV2,
  SkillLayoutLaneV2,
  SkillLayoutPlanV2,
  SkillNodeLayoutAssignmentV2,
} from './skillFlowLayoutPlanV2';
import { isSkillLayoutPlanV2, SKILL_LAYOUT_PLAN_V2_VERSION } from './skillFlowLayoutPlanV2';

/** Bump when fast-board placement rules change (triggers repair-on-open). */
export const CURRENT_SKILL_BOARD_LAYOUT_VERSION = 6;

/** Graph node count threshold: avoid a single horizontal strip (spec). */
export const BAD_LAYOUT_NODE_THRESHOLD = 8;

const G_START = 'fb-start';
const G_INPUT = 'fb-input';
const G_MAIN = 'fb-main';
const G_RULES = 'fb-rules';
const G_OUT = 'fb-output';
const G_RESPONSE = 'fb-response';

/** Fast-board panel ids — may be set on `SkillNodeV2.groupId` to pin membership before layout. */
export const FAST_BOARD_LAYOUT_GROUP_IDS = [G_START, G_INPUT, G_MAIN, G_RULES, G_OUT, G_RESPONSE] as const;

function bucketFromPinnedLayoutGroupId(groupId: string | undefined): 'start' | 'input' | 'main' | 'rules' | 'out' | 'response' | null {
  if (!groupId) return null;
  switch (groupId) {
    case G_START:
      return 'start';
    case G_INPUT:
      return 'input';
    case G_MAIN:
      return 'main';
    case G_RULES:
      return 'rules';
    case G_OUT:
      return 'out';
    case G_RESPONSE:
      return 'response';
    default:
      return null;
  }
}

const NODE_W = 220;
const NODE_H = 96;
const COL_GAP = 440;
/** Minimum horizontal gap between panel strips (start / input / main+rules / output). */
const MIN_PANEL_GAP = Math.max(300, Math.round(SKILL_LAYOUT_SPACING.groupGapX * 1.36));
/** Vertical gap between rules band bottom and workflow row (`mainRowY`). */
const RULES_GAP_ABOVE_MAIN = 112;
/** Extra air inside fast-board grids (steps, rules, notes, outputs) — larger than generic ELK spacing. */
const FAST_BOARD_GRID_GAP_X = 182;
const FAST_BOARD_GRID_GAP_Y = 138;
const BAND_RULES_ABOVE = 200;

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

function sortNodesStable(nodes: SkillNodeV2[], mainOrder: Map<string, number>): SkillNodeV2[] {
  return [...nodes].sort((a, b) => {
      const mo = (mainOrder.get(a.id) ?? 999) - (mainOrder.get(b.id) ?? 999);
      if (mo !== 0) return mo;
      const la = a.layer ?? 0;
      const lb = b.layer ?? 0;
      if (la !== lb) return la - lb;
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
}

function innerGridCols(nodeCount: number, forceWrap: boolean): number {
  if (nodeCount <= 0) return 1;
  if (forceWrap && nodeCount > 4) return 2;
  if (forceWrap && nodeCount > 8) return 2;
  return Math.min(nodeCount, 6);
}

/** Output panel: always one column (stacked vertically). */
function colsForPanel(gid: string, nodeCount: number, forceWrap: boolean): number {
  if (gid === G_OUT || gid === G_RESPONSE) return 1;
  return innerGridCols(nodeCount, forceWrap);
}

function gridDims(nodeCount: number, cols: number): { cols: number; rows: number; w: number; h: number } {
  if (nodeCount <= 0) return { cols: 1, rows: 0, w: 0, h: 0 };
  const c = Math.max(1, cols);
  const rows = Math.ceil(nodeCount / c);
  const w = c * NODE_W + (c - 1) * FAST_BOARD_GRID_GAP_X;
  const h = rows * NODE_H + (rows - 1) * FAST_BOARD_GRID_GAP_Y;
  return { cols: c, rows, w, h };
}

/** Build SkillLayoutPlanV2 + semantic edge plans for fast-board. */
export function buildFastBoardSkillLayoutPlan(graph: SkillFlowGraphV2): SkillLayoutPlanV2 {
  const mainPath = inferMainPath(graph);
  const mainOrder = new Map(mainPath.map((id, i) => [id, i]));
  const mainSet = new Set(mainPath);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const idsStart: string[] = [];
  const idsInput: string[] = [];
  const idsMain: string[] = [];
  const idsRules: string[] = [];
  const idsOut: string[] = [];
  const idsResponse: string[] = [];

  for (const n of graph.nodes) {
    const pinned = bucketFromPinnedLayoutGroupId(n.groupId);
    if (pinned === 'start') {
      idsStart.push(n.id);
      continue;
    }
    if (pinned === 'input') {
      idsInput.push(n.id);
      continue;
    }
    if (pinned === 'main') {
      idsMain.push(n.id);
      continue;
    }
    if (pinned === 'rules') {
      idsRules.push(n.id);
      continue;
    }
    if (pinned === 'out') {
      idsOut.push(n.id);
      continue;
    }
    if (pinned === 'response') {
      idsResponse.push(n.id);
      continue;
    }
    if (n.kind === 'goal') idsStart.push(n.id);
    else if (n.kind === 'input' || n.kind === 'role') idsInput.push(n.id);
    else if (
      n.kind === 'rule' ||
      n.kind === 'note' ||
      n.kind === 'validation' ||
      n.kind === 'guardrail'
    )
      idsRules.push(n.id);
    else if (n.kind === 'output') idsOut.push(n.id);
    else if (n.kind === 'response') idsResponse.push(n.id);
    else idsMain.push(n.id);
  }

  const startNodes = sortNodesStable(
    idsStart.map((id) => byId.get(id)!),
    mainOrder,
  );
  const inputNodes = sortNodesStable(
    idsInput.map((id) => byId.get(id)!),
    mainOrder,
  );
  const mainIds = idsMain.map((id) => byId.get(id)!);
  const mainNodes = [...mainIds].sort((a, b) => {
    const pa = mainOrder.has(a.id) ? mainOrder.get(a.id)! : 10000;
    const pb = mainOrder.has(b.id) ? mainOrder.get(b.id)! : 10000;
    if (pa !== pb) return pa - pb;
    const la = a.layer ?? 0;
    const lb = b.layer ?? 0;
    if (la !== lb) return la - lb;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });

  const rulesNodes = sortNodesStable(
    idsRules.map((id) => byId.get(id)!),
    mainOrder,
  );
  const outNodes = sortNodesStable(
    idsOut.map((id) => byId.get(id)!),
    mainOrder,
  );
  const responseNodes = sortNodesStable(
    idsResponse.map((id) => byId.get(id)!),
    mainOrder,
  );

  const lanes: SkillLayoutLaneV2[] = [
    { id: 'lane-main-flow', label: 'Main', kind: 'main-flow', order: 0 },
    { id: 'lane-support', label: 'Support', kind: 'support', order: 1 },
  ];

  const groups: SkillLayoutGroupV2[] = [
    {
      id: G_START,
      label: 'Start',
      kind: 'start',
      nodeIds: startNodes.map((n) => n.id),
      order: 0,
      laneId: 'lane-main-flow',
      layoutRole: 'main-panel',
      visual: { colorKey: 'goal', emphasis: 'primary' },
    },
    {
      id: G_INPUT,
      label: 'Inputs',
      kind: 'input',
      nodeIds: inputNodes.map((n) => n.id),
      order: 1,
      laneId: 'lane-main-flow',
      layoutRole: 'main-panel',
      visual: { colorKey: 'input', emphasis: 'secondary' },
    },
    {
      id: G_MAIN,
      label: 'Workflow',
      kind: 'generation',
      nodeIds: mainNodes.map((n) => n.id),
      order: 2,
      laneId: 'lane-main-flow',
      layoutRole: 'main-panel',
      visual: { colorKey: 'generation', emphasis: 'primary' },
    },
    {
      id: G_RULES,
      label: 'Rules & notes',
      kind: 'rules',
      nodeIds: rulesNodes.map((n) => n.id),
      order: 3,
      laneId: 'lane-support',
      layoutRole: 'support-panel',
      visual: { colorKey: 'rules', emphasis: 'muted' },
    },
    {
      id: G_OUT,
      label: 'Output',
      kind: 'output',
      nodeIds: outNodes.map((n) => n.id),
      order: 4,
      laneId: 'lane-main-flow',
      layoutRole: 'output-panel',
      visual: { colorKey: 'output', emphasis: 'secondary' },
    },
    {
      id: G_RESPONSE,
      label: 'Response',
      kind: 'output',
      nodeIds: responseNodes.map((n) => n.id),
      order: 5,
      laneId: 'lane-main-flow',
      layoutRole: 'output-panel',
      visual: { colorKey: 'response', emphasis: 'primary' },
    },
  ];

  let ord = 0;
  const nodeAssignments: SkillNodeLayoutAssignmentV2[] = [];

  const pushAssignments = (nodes: SkillNodeV2[], gid: string, lane: string, placement: SkillNodeLayoutAssignmentV2['placement']) => {
    for (const n of nodes) {
      const onMain = mainSet.has(n.id);
      nodeAssignments.push({
        nodeId: n.id,
        groupId: gid,
        laneId: lane,
        role: n.kind === 'decision' ? 'decision' : n.kind === 'goal' ? 'start' : 'main-step',
        layer: n.layer ?? ord,
        order: ord++,
        placement,
        visualEmphasis: onMain ? 'primary' : 'secondary',
      });
    }
  };

  pushAssignments(startNodes, G_START, 'lane-main-flow', 'on-main');
  pushAssignments(inputNodes, G_INPUT, 'lane-main-flow', 'on-main');
  pushAssignments(mainNodes, G_MAIN, 'lane-main-flow', 'on-main');
  pushAssignments(rulesNodes, G_RULES, 'lane-support', 'above-main');
  pushAssignments(outNodes, G_OUT, 'lane-main-flow', 'on-main');
  pushAssignments(responseNodes, G_RESPONSE, 'lane-main-flow', 'on-main');

  const edgePlans: SkillEdgeLayoutPlanV2[] = graph.edges.map((e) => {
    const idxS = mainPath.indexOf(e.source);
    const idxT = mainPath.indexOf(e.target);
    const onMain = mainSet.has(e.source) && mainSet.has(e.target) && Math.abs(idxS - idxT) === 1;
    let routeKind: SkillEdgeLayoutPlanV2['routeKind'] = 'support';
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
      routingPolicy: 'orthogonal-avoid-obstacles',
    };
  });

  const strategy = graph.nodes.length > 14 ? 'hybrid-map' : 'grouped-workflow';

  return {
    version: SKILL_LAYOUT_PLAN_V2_VERSION,
    graphId: graph.id,
    strategy,
    orientation: 'left-to-right',
    intent: 'Deterministic fast-board layout (no ELK)',
    groups,
    lanes,
    nodeAssignments,
    edgePlans,
    mainPath,
    constraints: {
      avoidOneLongLine: true,
      maxConsecutiveMainNodesBeforePanelBreak: graph.nodes.length > 8 ? 4 : 12,
    },
  };
}

function semanticKindForEdge(e: SkillEdgeV2, ep?: SkillEdgeLayoutPlanV2): SkillEdgeSemanticKind {
  if (ep?.routeKind === 'main') return 'main_flow';
  if (e.kind === 'branch') return 'branch';
  if (e.kind === 'parallel') return 'parallel';
  if (e.kind === 'depends_on') return 'dependency';
  return 'support';
}

/** Attach semanticKind on edges from plan edgePlans. Preserves explicit `data_read` / `data_write`. */
export function annotateSemanticEdgeKinds(graph: SkillFlowGraphV2, plan: SkillLayoutPlanV2): SkillFlowGraphV2 {
  const epMap = new Map(plan.edgePlans.map((p) => [p.edgeId, p]));
  const edges = graph.edges.map((e) => {
    const preset = e.ui?.semanticKind;
    if (preset === 'data_read' || preset === 'data_write') {
      return e;
    }
    const ep = epMap.get(e.id);
    const semanticKind = semanticKindForEdge(e, ep);
    return {
      ...e,
      ui: {
        ...e.ui,
        semanticKind,
      },
    };
  });
  return { ...graph, edges };
}

export function computeFastBoardPositions(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV2,
  opts: { preserveManualPositions: boolean },
): SkillFlowGraphV2 {
  const forceWrap = graph.nodes.length > BAD_LAYOUT_NODE_THRESHOLD;
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  const placed = new Map<string, { x: number; y: number }>();

  const groupsOrdered = [...plan.groups].sort((a, b) => a.order - b.order);
  const panelNodes = (gid: string) =>
    sortNodesStable(
      (groupsOrdered.find((g) => g.id === gid)?.nodeIds ?? [])
        .map((id) => byId.get(id))
        .filter((x): x is SkillNodeV2 => Boolean(x)),
      new Map(plan.mainPath.map((id, i) => [id, i])),
    );

  const mainRowY = BAND_RULES_ABOVE + 40;

  const dimsStart = gridDims(
    panelNodes(G_START).length,
    colsForPanel(G_START, panelNodes(G_START).length, forceWrap),
  );
  const dimsInput = gridDims(
    panelNodes(G_INPUT).length,
    colsForPanel(G_INPUT, panelNodes(G_INPUT).length, forceWrap),
  );
  const dimsMain = gridDims(
    panelNodes(G_MAIN).length,
    colsForPanel(G_MAIN, panelNodes(G_MAIN).length, forceWrap),
  );
  const rnPre = panelNodes(G_RULES);
  const dimsRules = gridDims(rnPre.length, colsForPanel(G_RULES, rnPre.length, forceWrap));
  const dimsOut = gridDims(
    panelNodes(G_OUT).length,
    colsForPanel(G_OUT, panelNodes(G_OUT).length, forceWrap),
  );
  const dimsResponse = gridDims(
    panelNodes(G_RESPONSE).length,
    colsForPanel(G_RESPONSE, panelNodes(G_RESPONSE).length, forceWrap),
  );

  const mainBlockW = Math.max(dimsMain.w, COL_GAP * 0.85);

  const placePanel = (gid: string, ox: number, oy: number, dims: { cols: number; rows: number; w: number; h: number }) => {
    const nodes = panelNodes(gid);
    const cols = colsForPanel(gid, nodes.length, forceWrap);
    let i = 0;
    for (const n of nodes) {
      if (opts.preserveManualPositions && n.ui?.manuallyPositioned) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = ox + col * (NODE_W + FAST_BOARD_GRID_GAP_X);
      const y = oy + row * (NODE_H + FAST_BOARD_GRID_GAP_Y);
      placed.set(n.id, { x, y });
      i += 1;
    }
    return dims.w;
  };

  let x = 48;
  if (panelNodes(G_START).length) {
    const w = placePanel(G_START, x, mainRowY, dimsStart);
    x += w + MIN_PANEL_GAP;
  }
  if (panelNodes(G_INPUT).length) {
    const w = placePanel(G_INPUT, x, mainRowY, dimsInput);
    x += w + MIN_PANEL_GAP;
  }

  const mainX = x;
  const rulesBandHeight = dimsRules.h;
  const rulesOriginY = mainRowY - rulesBandHeight - RULES_GAP_ABOVE_MAIN;

  if (panelNodes(G_RULES).length) {
    const rn = panelNodes(G_RULES);
    const cols = colsForPanel(G_RULES, rn.length, forceWrap);
    let i = 0;
    for (const n of rn) {
      if (opts.preserveManualPositions && n.ui?.manuallyPositioned) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      placed.set(n.id, {
        x: mainX + col * (NODE_W + FAST_BOARD_GRID_GAP_X),
        y: rulesOriginY + row * (NODE_H + FAST_BOARD_GRID_GAP_Y),
      });
      i += 1;
    }
  }

  placePanel(G_MAIN, mainX, mainRowY, { ...dimsMain, w: mainBlockW });
  let mainW = mainBlockW;
  for (const n of panelNodes(G_MAIN)) {
    const p = placed.get(n.id);
    if (p) mainW = Math.max(mainW, p.x - mainX + (n.ui?.width ?? NODE_W));
  }

  x = mainX + mainW + MIN_PANEL_GAP;
  if (panelNodes(G_OUT).length) {
    const w = placePanel(G_OUT, x, mainRowY, dimsOut);
    x += w + MIN_PANEL_GAP;
  }
  if (panelNodes(G_RESPONSE).length) {
    placePanel(G_RESPONSE, x, mainRowY, dimsResponse);
  }

  let nodesOut: SkillNodeV2[] = graph.nodes.map((n) => {
    const p = placed.get(n.id);
    if (!p) return n;
    if (opts.preserveManualPositions && n.ui?.manuallyPositioned) return n;
    return {
      ...n,
      ui: {
        ...n.ui,
        x: p.x,
        y: p.y,
        width: n.ui?.width ?? NODE_W,
        height: n.ui?.height ?? NODE_H,
        manuallyPositioned: n.ui?.manuallyPositioned ?? false,
      },
    };
  });

  nodesOut = resolveFastBoardOverlaps(nodesOut, opts.preserveManualPositions, plan);

  const groupsOut = plan.groups.map((g) => ({
    id: g.id,
    label: g.label,
  }));

  return {
    ...graph,
    nodes: nodesOut,
    groups: groupsOut,
  };
}

/** Push nodes apart within the same layout group only (never nudge Rules into Workflow, etc.). */
function resolveFastBoardOverlaps(
  nodes: SkillNodeV2[],
  preserveManual: boolean,
  plan: SkillLayoutPlanV2,
): SkillNodeV2[] {
  const groupOf = new Map<string, string>();
  for (const a of plan.nodeAssignments ?? []) {
    if (!a.groupId) continue;
    groupOf.set(a.nodeId, a.groupId);
  }

  const list = nodes.map((n) => ({ ...n }));
  const rect = (n: SkillNodeV2) => ({
    x: n.ui?.x ?? 0,
    y: n.ui?.y ?? 0,
    w: n.ui?.width ?? NODE_W,
    h: n.ui?.height ?? NODE_H,
  });
  const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i];
        const b = ordered[j];
        if (preserveManual && (a.ui?.manuallyPositioned || b.ui?.manuallyPositioned)) continue;
        const ga = groupOf.get(a.id);
        const gb = groupOf.get(b.id);
        if (!ga || !gb || ga !== gb) continue;
        const Ra = rect(a);
        const Rb = rect(b);
        if (!overlaps(Ra, Rb)) continue;
        const idx = list.findIndex((n) => n.id === b.id);
        if (idx < 0) continue;
        const shift = Ra.y + Ra.h + FAST_BOARD_GRID_GAP_Y - Rb.y;
        if (shift <= 0) continue;
        const ui = list[idx].ui ?? {};
        list[idx] = {
          ...list[idx],
          ui: {
            ...ui,
            x: ui.x ?? Rb.x,
            y: (ui.y ?? Rb.y) + shift,
            width: ui.width ?? NODE_W,
            height: ui.height ?? NODE_H,
          },
        };
        ordered[j] = list[idx];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return list;
}

/** Apply pixel coordinates from fast-board plan; caller merges plan metadata first. */
export function runFastBoardLayoutEngine(
  merged: SkillFlowGraphV2,
  preserveManualPositions: boolean,
): SkillFlowGraphV2 {
  const plan = merged.layout?.layoutPlan;
  if (!plan || !isSkillLayoutPlanV2(plan)) return merged;
  let next = computeFastBoardPositions(merged, plan, { preserveManualPositions });
  next = annotateSemanticEdgeKinds(next, plan);
  const now = new Date().toISOString();
  return {
    ...next,
    layout: {
      ...next.layout!,
      strategy: 'fast-board',
      orientation: 'left-to-right',
      lastLayoutAt: now,
      layoutAlgorithmVersion: CURRENT_SKILL_BOARD_LAYOUT_VERSION,
      layoutPlan: plan,
    },
  };
}

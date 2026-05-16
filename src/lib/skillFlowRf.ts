import { MarkerType, type Edge, type EdgeMarker, type Node } from '@xyflow/react';
import { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';
import { isSkillLayoutPlanV2, type SkillDataArtifactLayoutNode } from './skillFlowLayoutPlanV2';
import type { SkillEdgeV2, SkillFlowGraphV2, SkillGroupV2, SkillNodeV2 } from './skillFlowGraphV2';
import type { SkillLayoutGroup } from './skillFlowLayoutPlan';
import type { SkillValidationIssue } from './skillFlowValidation';
import {
  RESPONSE_EDGE_STROKE,
  resolveEdgeVisual,
  strokeForSvgMarker,
  VARIABLE_READ_EDGE_STROKE,
  VARIABLE_WRITE_EDGE_STROKE,
} from './skillFlowEdgeStyles';
import { isSkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import {
  assignOrthogonalEdgeLanes,
  nudgeSeparatedOrthogonalPaths,
  ORTHOGONAL_LANE_STRIDE,
  ORTHOGONAL_PORT_OFFSET,
  type OrthogonalLaneAssignment,
} from './skillFlowOrthogonalEdgePath';
import {
  buildLayoutObstaclesFromGraph,
  buildNodeToGroupIdMapFromPlan,
  filterObstaclesForEdge,
  orthogonalRouteAvoidingNodes,
  type LayoutObstacle,
  type OrthogonalRoutingPrimary,
  type RoutedPath,
} from './skillFlowLayoutRouting';

export const SKILL_FLOW_RF_TYPE = 'skillFlow';
export const SKILL_GROUP_RF_TYPE = 'skillGroup';
export const SKILL_ARTIFACT_RF_TYPE = 'skillArtifact';
export const SKILL_ROUTED_EDGE_RF_TYPE = 'skillRouted';
export const SKILL_ORTHOGONAL_EDGE_RF_TYPE = 'skillOrthogonal';

/**
 * React Flow handle ids on skill nodes — separate source vs target per side so edges resolve
 * to the correct Handle component when multiple handles share an edge.
 */
export const SKILL_FLOW_HANDLE_SRC = {
  L: 'src-l',
  R: 'src-r',
  T: 'src-t',
  B: 'src-b',
} as const;

export const SKILL_FLOW_HANDLE_TGT = {
  L: 'tgt-l',
  R: 'tgt-r',
  T: 'tgt-t',
  B: 'tgt-b',
} as const;

export type SkillFlowRfNodeData = {
  node: SkillNodeV2;
  selected: boolean;
  issues: SkillValidationIssue[];
  traceActive?: boolean;
  variableFlowRole?: 'set' | 'get' | 'set-get';
};

export type SkillGroupRfData =
  | { variant: 'layout'; group: SkillLayoutGroup; nodeCount: number }
  | { variant: 'user'; userGroup: SkillGroupV2; nodeCount: number };

function issuesForNode(nodeId: string, map: Map<string, SkillValidationIssue[]>): SkillValidationIssue[] {
  return map.get(nodeId) ?? [];
}

export function buildNodeIssueMap(issues: SkillValidationIssue[]): Map<string, SkillValidationIssue[]> {
  const m = new Map<string, SkillValidationIssue[]>();
  for (const i of issues) {
    if (!i.nodeId) continue;
    const arr = m.get(i.nodeId) ?? [];
    arr.push(i);
    m.set(i.nodeId, arr);
  }
  return m;
}

function bboxOf(members: SkillNodeV2[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!members.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of members) {
    const x = n.ui?.x ?? 0;
    const y = n.ui?.y ?? 0;
    const w = n.ui?.width ?? 220;
    const h = n.ui?.height ?? 96;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  return { minX, minY, maxX, maxY };
}

/** Axis-aligned frames for semantic layout groups — same geometry as group overlay nodes in `skillGraphToReactFlow`. */
export type SemanticGroupFrame = {
  groupPlanId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function computeSemanticGroupFrames(graph: SkillFlowGraphV2): SemanticGroupFrame[] {
  const workGraph = applyLiveNodePositionsToSkillGraph(graph, undefined);
  const rawPlan = graph.layout?.layoutPlan;
  const plan =
    rawPlan && (isSkillLayoutPlanV2(rawPlan) || isSkillLayoutPlanV3(rawPlan)) ? rawPlan : undefined;
  if (!plan?.groups?.length) return [];

  const byId = new Map(workGraph.nodes.map((n) => [n.id, n] as const));
  const out: SemanticGroupFrame[] = [];
  const sorted = [...plan.groups].sort((a, b) => a.order - b.order);
  for (const g of sorted) {
    const members = g.nodeIds.map((id) => byId.get(id)).filter((x): x is SkillNodeV2 => Boolean(x));
    const bb = bboxOf(members);
    if (!bb) continue;
    const p = framePaddingForGroup(g.id);
    const gw = bb.maxX - bb.minX + p.l + p.r;
    const gh = bb.maxY - bb.minY + p.t + p.b;
    const gx = bb.minX - p.l;
    const gy = bb.minY - p.t;
    out.push({ groupPlanId: g.id, x: gx, y: gy, w: gw, h: gh });
  }
  return out;
}

/** Smallest-area group frame containing `(flowX, flowY)` in flow coordinates; `null` if none. */
export function hitTestLayoutGroupAtFlowPoint(graph: SkillFlowGraphV2, flowX: number, flowY: number): string | null {
  const frames = computeSemanticGroupFrames(graph);
  const hits = frames.filter((f) => flowX >= f.x && flowX <= f.x + f.w && flowY >= f.y && flowY <= f.y + f.h);
  if (!hits.length) return null;
  hits.sort((a, b) => a.w * a.h - b.w * b.h);
  return hits[0].groupPlanId;
}

/** Tighter padding on the side that faces another stacked band — avoids huge translucent frames overlapping neighbors. */
function framePaddingForGroup(gid: string): { l: number; r: number; t: number; b: number } {
  const side = SKILL_LAYOUT_SPACING.groupPaddingX;
  const outer = Math.min(52, SKILL_LAYOUT_SPACING.groupPaddingY);
  const inner = 12;
  if (gid === 'fb-rules') return { l: side, r: side, t: outer, b: inner };
  if (gid === 'fb-main') return { l: side, r: side, t: inner, b: outer };
  return { l: side, r: side, t: outer, b: outer };
}

function nodeRect(n: SkillNodeV2) {
  const x = n.ui?.x ?? 0;
  const y = n.ui?.y ?? 0;
  const w = n.ui?.width ?? 220;
  const h = n.ui?.height ?? 96;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: x + w, b: y + h };
}

function estimateLaneMidY(s: SkillNodeV2, t: SkillNodeV2): number {
  const A = nodeRect(s);
  const B = nodeRect(t);
  const dx = B.cx - A.cx;
  const dy = B.cy - A.cy;
  const verticalDominant = Math.abs(dy) >= Math.abs(dx) * 0.52;
  if (verticalDominant) {
    if (dy > 0) return (A.b + B.y) / 2;
    return (A.y + B.b) / 2;
  }
  return (A.cy + B.cy) / 2;
}

export type SkillEdgeAnchors = {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  primary: OrthogonalRoutingPrimary;
  sourceHandle: string;
  targetHandle: string;
};

/** Port geometry + React Flow handle ids for settled and interactive edge rendering. */
export function computeSkillEdgeAnchors(
  s: SkillNodeV2,
  t: SkillNodeV2,
  laneCentered: number,
  fanStagger: number,
): SkillEdgeAnchors {
  const A = nodeRect(s);
  const B = nodeRect(t);
  const dx = B.cx - A.cx;
  const dy = B.cy - A.cy;
  const lane = laneCentered * ORTHOGONAL_PORT_OFFSET;
  const verticalDominant = Math.abs(dy) >= Math.abs(dx) * 0.52;

  if (verticalDominant) {
    if (dy > 0) {
      return {
        sx: A.cx + fanStagger + lane * 0.22,
        sy: A.b,
        tx: B.cx + fanStagger + lane * 0.22,
        ty: B.y,
        primary: 'vertical',
        sourceHandle: SKILL_FLOW_HANDLE_SRC.B,
        targetHandle: SKILL_FLOW_HANDLE_TGT.T,
      };
    }
    return {
      sx: A.cx + fanStagger + lane * 0.22,
      sy: A.y,
      tx: B.cx + fanStagger + lane * 0.22,
      ty: B.b,
      primary: 'vertical',
      sourceHandle: SKILL_FLOW_HANDLE_SRC.T,
      targetHandle: SKILL_FLOW_HANDLE_TGT.B,
    };
  }

  if (dx >= 0) {
    return {
      sx: A.r,
      sy: A.cy + lane,
      tx: B.x,
      ty: B.cy + lane + fanStagger,
      primary: 'horizontal',
      sourceHandle: SKILL_FLOW_HANDLE_SRC.R,
      targetHandle: SKILL_FLOW_HANDLE_TGT.L,
    };
  }
  return {
    sx: A.x,
    sy: A.cy + lane,
    tx: B.r,
    ty: B.cy + lane + fanStagger,
    primary: 'horizontal',
    sourceHandle: SKILL_FLOW_HANDLE_SRC.L,
    targetHandle: SKILL_FLOW_HANDLE_TGT.R,
  };
}

export interface SkillGraphToRfOptions {
  fadeNeighbors?: boolean;
  /** When false, omit layout-only data artifact nodes (variables bus). Default true. */
  showVariables?: boolean;
  /** During canvas drag, overlay these pixel positions on skill nodes before routing (smooth wires). */
  livePositions?: Map<string, { x: number; y: number }>;
}

function applyLiveNodePositionsToSkillGraph(
  graph: SkillFlowGraphV2,
  live?: Map<string, { x: number; y: number }>,
): SkillFlowGraphV2 {
  if (!live?.size) return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = live.get(n.id);
      if (!p) return n;
      return {
        ...n,
        ui: {
          ...n.ui,
          x: p.x,
          y: p.y,
          width: n.ui?.width ?? 220,
          height: n.ui?.height ?? 96,
        },
      };
    }),
  };
}

const ARTIFACT_W = 176;
const ARTIFACT_H = 72;

/** Spread attachment points for multiple edges meeting one node (px). */
const TARGET_FAN_IN_STEP = 26;

const ARROW_MARKER = { width: 26, height: 26 } as const;

function edgeWithResponseVisualMetadata(edge: SkillEdgeV2, target: SkillNodeV2 | undefined): SkillEdgeV2 {
  if (target?.kind !== 'response') return edge;
  return {
    ...edge,
    ui: {
      ...(edge.ui ?? {}),
      layoutColorKey: 'response',
      visualEmphasis: 'primary',
      labelVisible: edge.ui?.labelVisible ?? true,
    },
  };
}

/** Stroke for layout-only variable bus edges (producer → variable → consumer). */
type VariableEdgeSpec = { id: string; source: string; target: string; role: 'write' | 'read' };

const variableEdgeStrokeForRole = (role: VariableEdgeSpec['role']): string =>
  role === 'write' ? VARIABLE_WRITE_EDGE_STROKE : VARIABLE_READ_EDGE_STROKE;

function variableEdgeStrokeForTarget(role: VariableEdgeSpec['role'], target: SkillNodeV2 | undefined): string {
  return target?.kind === 'response' ? RESPONSE_EDGE_STROKE : variableEdgeStrokeForRole(role);
}

function stubSkillNodeFromArtifactRect(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
): SkillNodeV2 {
  return {
    id,
    label: '',
    kind: 'note',
    ui: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  };
}

function resolveRoutingEndpoint(
  id: string,
  byId: Map<string, SkillNodeV2>,
  artifactRectById: Map<string, { x: number; y: number; w: number; h: number }>,
): SkillNodeV2 | null {
  const n = byId.get(id);
  if (n) return n;
  const r = artifactRectById.get(id);
  return r ? stubSkillNodeFromArtifactRect(id, r) : null;
}

/** Edges from **`producedBy`** → variable card and variable → **`consumedBy`** (not part of `graph.edges`). */
function buildVariableEdgeSpecs(
  artifactPlan: SkillDataArtifactLayoutNode[] | undefined,
  byId: Map<string, SkillNodeV2>,
  artifactRectById: Map<string, { x: number; y: number; w: number; h: number }>,
): VariableEdgeSpec[] {
  if (!artifactPlan?.length) return [];
  const specs: VariableEdgeSpec[] = [];
  for (const art of artifactPlan) {
    if (!artifactRectById.has(art.id)) continue;
    for (const pid of art.producedBy ?? []) {
      if (!byId.has(pid)) continue;
      specs.push({
        id: `rf-var-write:${art.id}:${pid}`,
        source: pid,
        target: art.id,
        role: 'write',
      });
    }
    for (const cid of art.consumedBy ?? []) {
      if (!byId.has(cid)) continue;
      specs.push({
        id: `rf-var-read:${art.id}:${cid}`,
        source: art.id,
        target: cid,
        role: 'read',
      });
    }
  }
  return specs;
}

export function skillArrowMarker(stroke: string | undefined, edgeId: string): EdgeMarker & { id: string } {
  return {
    type: MarkerType.ArrowClosed,
    color: strokeForSvgMarker(stroke),
    ...ARROW_MARKER,
    id: `skill-arrow-${edgeId}`,
  };
}

const ARTIFACT_SEP_GAP = 96;

function rectsOverlap2D(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Push variable cards away from skill nodes (incl. notes) and from each other — same overlap idea as fast-board nudging. */
function nudgeArtifactRectsAwayFromSkillNodes(
  rects: Array<{ id: string; x: number; y: number; w: number; h: number }>,
  skillNodes: SkillNodeV2[],
  manualIds: Set<string>,
): void {
  const nodeRects = skillNodes.map((n) => ({
    id: n.id,
    x: n.ui?.x ?? 0,
    y: n.ui?.y ?? 0,
    w: n.ui?.width ?? 220,
    h: n.ui?.height ?? 96,
  }));

  for (let pass = 0; pass < 96; pass++) {
    let changed = false;
    for (const r of rects) {
      if (manualIds.has(r.id)) continue;
      const ox = r.x;
      const oy = r.y;
      const obstacles = [
        ...nodeRects,
        ...rects.filter((q) => q.id !== r.id),
      ];
      for (const o of obstacles) {
        if (!rectsOverlap2D(r, o)) continue;
        r.y = Math.max(r.y, o.y + o.h + ARTIFACT_SEP_GAP);
      }
      if (r.x !== ox || r.y !== oy) changed = true;
    }
    if (!changed) break;
  }

  for (let pass = 0; pass < 96; pass++) {
    let changed = false;
    for (const r of rects) {
      if (manualIds.has(r.id)) continue;
      const ox = r.x;
      const oy = r.y;
      const obstacles = [
        ...nodeRects,
        ...rects.filter((q) => q.id !== r.id),
      ];
      for (const o of obstacles) {
        if (!rectsOverlap2D(r, o)) continue;
        r.x = Math.max(r.x, o.x + o.w + ARTIFACT_SEP_GAP);
      }
      if (r.x !== ox || r.y !== oy) changed = true;
    }
    if (!changed) break;
  }
}

export function skillGraphToReactFlow(
  graph: SkillFlowGraphV2,
  selectedId: string | null,
  validationIssues: SkillValidationIssue[],
  options?: SkillGraphToRfOptions,
): {
  nodes: Node[];
  edges: Edge[];
} {
  const workGraph = applyLiveNodePositionsToSkillGraph(graph, options?.livePositions);
  const map = buildNodeIssueMap(validationIssues);
  const rawPlan = graph.layout?.layoutPlan;
  const plan =
    rawPlan && (isSkillLayoutPlanV2(rawPlan) || isSkillLayoutPlanV3(rawPlan))
      ? rawPlan
      : undefined;
  const fade = Boolean(options?.fadeNeighbors && selectedId);
  const showVariables = options?.showVariables !== false;

  const byId = new Map(workGraph.nodes.map((n) => [n.id, n] as const));

  const groupNodes: Node<SkillGroupRfData>[] = [];
  const groupRects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

  if (plan?.groups?.length) {
    const sorted = [...plan.groups].sort((a, b) => a.order - b.order);
    for (const g of sorted) {
      const members = g.nodeIds.map((id) => byId.get(id)).filter((x): x is SkillNodeV2 => Boolean(x));
      const bb = bboxOf(members);
      if (!bb) continue;
      const p = framePaddingForGroup(g.id);
      const gw = bb.maxX - bb.minX + p.l + p.r;
      const gh = bb.maxY - bb.minY + p.t + p.b;
      const gx = bb.minX - p.l;
      const gy = bb.minY - p.t;
      const gid = `rf-group-${g.id}`;
      groupRects.push({ id: gid, x: gx, y: gy, w: gw, h: gh });
      groupNodes.push({
        id: gid,
        type: SKILL_GROUP_RF_TYPE,
        position: { x: gx, y: gy },
        style: { width: gw, height: gh, zIndex: 0 },
        draggable: true,
        selectable: false,
        data: {
          variant: 'layout' as const,
          group: g as SkillLayoutGroup,
          nodeCount: members.length,
        },
      });
    }
  }

  const userGroups = graph.groups ?? [];
  for (const ug of userGroups) {
    const ids = ug.nodeIds ?? [];
    if (!ids.length) continue;
    const members = ids.map((id) => byId.get(id)).filter((x): x is SkillNodeV2 => Boolean(x));
    if (!members.length) continue;
    const bb = bboxOf(members);
    if (!bb) continue;
    const side = SKILL_LAYOUT_SPACING.groupPaddingX;
    const padY = Math.min(28, SKILL_LAYOUT_SPACING.groupPaddingY);
    const gw = bb.maxX - bb.minX + side * 2;
    const gh = bb.maxY - bb.minY + padY * 2;
    const gx = bb.minX - side;
    const gy = bb.minY - padY;
    const gid = `rf-user-group-${ug.id}`;
    groupRects.push({ id: gid, x: gx, y: gy, w: gw, h: gh });
    groupNodes.push({
      id: gid,
      type: SKILL_GROUP_RF_TYPE,
      position: { x: gx, y: gy },
      style: { width: gw, height: gh, zIndex: 1 },
      draggable: true,
      selectable: true,
      data: {
        variant: 'user' as const,
        userGroup: ug,
        nodeCount: members.length,
      },
    });
  }

  const artifactNodes: Node[] = [];
  const artifactRects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  const artifactPlan =
    plan && showVariables && (isSkillLayoutPlanV2(plan) || isSkillLayoutPlanV3(plan))
      ? plan.dataArtifacts
      : undefined;
  if (artifactPlan?.length) {
    const manualArtifactIds = new Set(
      artifactPlan.filter((a) => a.ui?.manuallyPositioned).map((a) => a.id),
    );
    for (const art of artifactPlan) {
      const consumers = (Array.isArray(art.consumedBy) ? art.consumedBy : [])
        .map((id) => byId.get(id))
        .filter((x): x is SkillNodeV2 => Boolean(x));
      let x = typeof art.ui?.x === 'number' ? art.ui!.x! : 48;
      let y = typeof art.ui?.y === 'number' ? art.ui!.y! : 48;
      if (consumers.length && (art.ui?.x === undefined || art.ui?.y === undefined)) {
        x = consumers.reduce((s, n) => s + (n.ui?.x ?? 0), 0) / consumers.length - ARTIFACT_W / 2;
        y = consumers.reduce((s, n) => s + (n.ui?.y ?? 0), 0) / consumers.length - 24;
      }
      artifactRects.push({ id: art.id, x, y, w: ARTIFACT_W, h: ARTIFACT_H });
    }
    nudgeArtifactRectsAwayFromSkillNodes(artifactRects, workGraph.nodes, manualArtifactIds);
    for (const rect of artifactRects) {
      const art = artifactPlan.find((a) => a.id === rect.id);
      if (!art) continue;
      artifactNodes.push({
        id: rect.id,
        type: SKILL_ARTIFACT_RF_TYPE,
        position: { x: rect.x, y: rect.y },
        zIndex: 4,
        draggable: true,
        selectable: true,
        data: { artifact: art },
        style: { width: ARTIFACT_W },
      });
    }
  }

  const artifactRectById = new Map(artifactRects.map((r) => [r.id, r] as const));
  const variableSpecs = buildVariableEdgeSpecs(
    showVariables ? artifactPlan : undefined,
    byId,
    artifactRectById,
  );

  const flowNodes: Node<SkillFlowRfNodeData>[] = workGraph.nodes.map((n) => {
    const w = n.ui?.width ?? 220;
    const z = (n.ui?.visualEmphasis === 'primary' ? 2 : 1) + 5;
    const hasVariableSet = n.kind === 'variable' && graph.edges.some((e) => e.target === n.id && e.ui?.semanticKind === 'data_write');
    const hasVariableGet = n.kind === 'variable' && graph.edges.some((e) => e.source === n.id && e.ui?.semanticKind === 'data_read');
    const variableFlowRole =
      hasVariableSet && hasVariableGet ? 'set-get' : hasVariableSet ? 'set' : hasVariableGet ? 'get' : undefined;
    return {
      id: n.id,
      type: SKILL_FLOW_RF_TYPE,
      position: { x: n.ui?.x ?? 0, y: n.ui?.y ?? 0 },
      zIndex: z,
      data: {
        node: n,
        selected: selectedId === n.id,
        issues: issuesForNode(n.id, map),
        variableFlowRole,
      },
      style: { width: w },
    };
  });

  const obstacles: LayoutObstacle[] = buildLayoutObstaclesFromGraph(workGraph.nodes, groupRects, artifactRects);

  const useOrthogonalLanes = graph.layout?.strategy === 'fast-board' && Boolean(plan);

  const orthogonalLaneMap = new Map<string, OrthogonalLaneAssignment>();
  /** Per-target fan-in: stagger attachment Y on shared targets so horizontal merges don't stack. */
  const fanInTyDelta = new Map<string, number>();
  if (plan) {
    const incomingByTarget = new Map<string, { id: string }[]>();
    for (const ed of graph.edges) {
      const arr = incomingByTarget.get(ed.target) ?? [];
      arr.push(ed);
      incomingByTarget.set(ed.target, arr);
    }
    for (const vs of variableSpecs) {
      const arr = incomingByTarget.get(vs.target) ?? [];
      arr.push(vs);
      incomingByTarget.set(vs.target, arr);
    }
    for (const [, inc] of incomingByTarget) {
      const sorted = [...inc].sort((a, b) => a.id.localeCompare(b.id));
      const n = sorted.length;
      sorted.forEach((ed, idx) => {
        fanInTyDelta.set(ed.id, (idx - (n - 1) / 2) * TARGET_FAN_IN_STEP);
      });
    }

    if (useOrthogonalLanes) {
      const mids: Array<{ id: string; midY: number }> = [];
      for (const ed of graph.edges) {
        const s = byId.get(ed.source);
        const t = byId.get(ed.target);
        if (!s || !t) continue;
        mids.push({ id: ed.id, midY: estimateLaneMidY(s, t) });
      }
      for (const vs of variableSpecs) {
        const s = resolveRoutingEndpoint(vs.source, byId, artifactRectById);
        const t = resolveRoutingEndpoint(vs.target, byId, artifactRectById);
        if (!s || !t) continue;
        mids.push({ id: vs.id, midY: estimateLaneMidY(s, t) });
      }
      const lanes = assignOrthogonalEdgeLanes(mids);
      lanes.forEach((v, k) => orthogonalLaneMap.set(k, v));
    }
  }

  const nodeToGroupId = plan ? buildNodeToGroupIdMapFromPlan(plan) : new Map<string, string>();

  const rawPaths = new Map<string, RoutedPath>();
  for (const ed of graph.edges) {
    const s = byId.get(ed.source);
    const t = byId.get(ed.target);
    if (!s || !t) continue;

    const fanStagger = fanInTyDelta.get(ed.id) ?? 0;
    const assign = useOrthogonalLanes
      ? orthogonalLaneMap.get(ed.id) ?? { laneIndex: 0, peersInBucket: 1 }
      : { laneIndex: 0, peersInBucket: 1 };
    const laneCentered = assign.laneIndex - (assign.peersInBucket - 1) / 2;
    const laneOffset = useOrthogonalLanes ? laneCentered * ORTHOGONAL_LANE_STRIDE : 0;
    const anchors = computeSkillEdgeAnchors(s, t, useOrthogonalLanes ? laneCentered : 0, fanStagger);
    const obs = filterObstaclesForEdge(obstacles, ed.source, ed.target, nodeToGroupId);
    rawPaths.set(
      ed.id,
      orthogonalRouteAvoidingNodes({
        sx: anchors.sx,
        sy: anchors.sy,
        tx: anchors.tx,
        ty: anchors.ty,
        laneMidOffset: laneOffset,
        primary: anchors.primary,
        obstacles: obs,
        ignoreNodeIds: new Set([ed.source, ed.target]),
      }),
    );
  }

  for (const vs of variableSpecs) {
    const s = resolveRoutingEndpoint(vs.source, byId, artifactRectById);
    const t = resolveRoutingEndpoint(vs.target, byId, artifactRectById);
    if (!s || !t) continue;

    const fanStagger = fanInTyDelta.get(vs.id) ?? 0;
    const assign = useOrthogonalLanes
      ? orthogonalLaneMap.get(vs.id) ?? { laneIndex: 0, peersInBucket: 1 }
      : { laneIndex: 0, peersInBucket: 1 };
    const laneCentered = assign.laneIndex - (assign.peersInBucket - 1) / 2;
    const laneOffset = useOrthogonalLanes ? laneCentered * ORTHOGONAL_LANE_STRIDE : 0;
    const anchors = computeSkillEdgeAnchors(s, t, useOrthogonalLanes ? laneCentered : 0, fanStagger);
    const obs = filterObstaclesForEdge(obstacles, vs.source, vs.target, nodeToGroupId);
    rawPaths.set(
      vs.id,
      orthogonalRouteAvoidingNodes({
        sx: anchors.sx,
        sy: anchors.sy,
        tx: anchors.tx,
        ty: anchors.ty,
        laneMidOffset: laneOffset,
        primary: anchors.primary,
        obstacles: obs,
        ignoreNodeIds: new Set([vs.source, vs.target]),
      }),
    );
  }

  const settledPathMap =
    plan && rawPaths.size > 0 ? nudgeSeparatedOrthogonalPaths(rawPaths) : rawPaths;

  const graphRfEdges: Edge[] = graph.edges.map((edge) => {
    const s = byId.get(edge.source);
    const t = byId.get(edge.target);
    const e = edgeWithResponseVisualMetadata(edge, t);
    const fanStagger = fanInTyDelta.get(e.id) ?? 0;
    const assign = useOrthogonalLanes
      ? orthogonalLaneMap.get(e.id) ?? { laneIndex: 0, peersInBucket: 1 }
      : { laneIndex: 0, peersInBucket: 1 };
    const laneCentered = assign.laneIndex - (assign.peersInBucket - 1) / 2;
    const laneOffset = useOrthogonalLanes ? laneCentered * ORTHOGONAL_LANE_STRIDE : 0;

    const anchors =
      s && t ? computeSkillEdgeAnchors(s, t, useOrthogonalLanes ? laneCentered : 0, fanStagger) : null;

    let points = s && t ? settledPathMap.get(e.id) : undefined;
    if (s && t && anchors && (!points || points.length < 2)) {
      const obs = filterObstaclesForEdge(obstacles, e.source, e.target, nodeToGroupId);
      points = orthogonalRouteAvoidingNodes({
        sx: anchors.sx,
        sy: anchors.sy,
        tx: anchors.tx,
        ty: anchors.ty,
        laneMidOffset: laneOffset,
        primary: anchors.primary,
        obstacles: obs,
        ignoreNodeIds: new Set([e.source, e.target]),
      });
    }

    const rv = resolveEdgeVisual(e, plan, {
      selectedNodeId: selectedId,
      fadeUnrelated: fade,
    });
    if (!s || !t || !anchors) {
      return {
        id: e.id,
        type: SKILL_ORTHOGONAL_EDGE_RF_TYPE,
        source: e.source,
        target: e.target,
        sourceHandle: SKILL_FLOW_HANDLE_SRC.R,
        targetHandle: SKILL_FLOW_HANDLE_TGT.L,
        label: e.label?.trim() || undefined,
        animated: false,
        style: {
          stroke: rv.stroke,
          strokeWidth: Math.max(rv.strokeWidth, 2.6),
          strokeDasharray: rv.strokeDasharray,
          opacity: rv.opacity,
        },
        markerEnd: skillArrowMarker(rv.stroke, e.id),
        data: {
          renderMode: 'settled' as const,
          routingPrimary: 'horizontal' as const,
          laneMidOffset: 0,
        },
      };
    }
    return {
      id: e.id,
      type: SKILL_ORTHOGONAL_EDGE_RF_TYPE,
      source: e.source,
      target: e.target,
      sourceHandle: anchors.sourceHandle,
      targetHandle: anchors.targetHandle,
      label: e.label?.trim() || undefined,
      animated: false,
      style: {
        stroke: rv.stroke,
        strokeWidth: Math.max(rv.strokeWidth, 2.6),
        strokeDasharray: rv.strokeDasharray,
        opacity: rv.opacity,
      },
      markerEnd: skillArrowMarker(rv.stroke, e.id),
      data: {
        points,
        renderMode: 'settled' as const,
        laneMidOffset: laneOffset,
        routingPrimary: anchors.primary,
      },
    };
  });

  const variableRfEdges: Edge[] = variableSpecs.map((vs) => {
    const s = resolveRoutingEndpoint(vs.source, byId, artifactRectById);
    const t = resolveRoutingEndpoint(vs.target, byId, artifactRectById);
    const fanStagger = fanInTyDelta.get(vs.id) ?? 0;
    const assign = useOrthogonalLanes
      ? orthogonalLaneMap.get(vs.id) ?? { laneIndex: 0, peersInBucket: 1 }
      : { laneIndex: 0, peersInBucket: 1 };
    const laneCentered = assign.laneIndex - (assign.peersInBucket - 1) / 2;
    const laneOffset = useOrthogonalLanes ? laneCentered * ORTHOGONAL_LANE_STRIDE : 0;
    const anchors =
      s && t ? computeSkillEdgeAnchors(s, t, useOrthogonalLanes ? laneCentered : 0, fanStagger) : null;

    let points = s && t ? settledPathMap.get(vs.id) : undefined;
    if (s && t && anchors && (!points || points.length < 2)) {
      const obs = filterObstaclesForEdge(obstacles, vs.source, vs.target, nodeToGroupId);
      points = orthogonalRouteAvoidingNodes({
        sx: anchors.sx,
        sy: anchors.sy,
        tx: anchors.tx,
        ty: anchors.ty,
        laneMidOffset: laneOffset,
        primary: anchors.primary,
        obstacles: obs,
        ignoreNodeIds: new Set([vs.source, vs.target]),
      });
    }

    const targetNode = byId.get(vs.target);
    const isWrite = vs.role === 'write';
    const isResponseTarget = targetNode?.kind === 'response';
    const stroke = variableEdgeStrokeForTarget(vs.role, targetNode);
    const strokeWidth = isResponseTarget ? 3.35 : isWrite ? 2.8 : 2.5;
    const strokeDasharray = isResponseTarget ? undefined : isWrite ? '3 5' : undefined;
    const opacity = isResponseTarget ? 1 : 0.95;

    if (!s || !t || !anchors) {
      return {
        id: vs.id,
        type: SKILL_ORTHOGONAL_EDGE_RF_TYPE,
        source: vs.source,
        target: vs.target,
        sourceHandle: SKILL_FLOW_HANDLE_SRC.R,
        targetHandle: SKILL_FLOW_HANDLE_TGT.L,
        style: {
          stroke,
          strokeWidth,
          ...(strokeDasharray ? { strokeDasharray } : {}),
          opacity,
        },
        markerEnd: skillArrowMarker(stroke, vs.id),
        data: {
          renderMode: 'settled' as const,
          routingPrimary: 'horizontal' as const,
          laneMidOffset: 0,
          variableEdgeRole: vs.role,
        },
      };
    }

    return {
      id: vs.id,
      type: SKILL_ORTHOGONAL_EDGE_RF_TYPE,
      source: vs.source,
      target: vs.target,
      sourceHandle: anchors.sourceHandle,
      targetHandle: anchors.targetHandle,
      style: {
        stroke,
        strokeWidth,
        ...(strokeDasharray ? { strokeDasharray } : {}),
        opacity,
      },
      markerEnd: skillArrowMarker(stroke, vs.id),
      data: {
        points,
        renderMode: 'settled' as const,
        laneMidOffset: laneOffset,
        routingPrimary: anchors.primary,
        variableEdgeRole: vs.role,
      },
    };
  });

  const edges: Edge[] = [...graphRfEdges, ...variableRfEdges];

  const nodesOut = [...groupNodes, ...artifactNodes, ...flowNodes];

  return { nodes: nodesOut, edges };
}

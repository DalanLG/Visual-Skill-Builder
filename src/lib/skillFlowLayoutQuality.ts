import type { SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';
import type { LayoutObstacle } from './skillFlowLayoutRouting';
import { inflatedRectFromObstacle, segmentHitsRect } from './skillFlowLayoutRouting';

const DEFAULT_W = 220;
const DEFAULT_H = 96;

export const BAD_LAYOUT_THRESHOLDS = {
  maxWidthHeightRatio: 4.2,
  maxSameLaneNodeRatio: 0.7,
  minNodesForBandHeuristic: 8,
} as const;

export interface SkillLayoutQualityReport {
  score: number;
  edgeNodeIntersections: number;
  edgeGroupIntersections: number;
  nodeOverlaps: number;
  groupOverlaps: number;
  edgeCrossings: number;
  averageEdgeLength: number;
  maxEdgeLength: number;
  widthHeightRatio: number;
  sameLaneNodeRatio: number;
  longStringDetected: boolean;
  unassignedNodes: string[];
  warnings: string[];
  /** Heuristic UX hints (e.g. heavy graphs). */
  lagRiskWarnings: string[];
}

function nodeRect(n: SkillNodeV2): { x: number; y: number; w: number; h: number } {
  return {
    x: n.ui?.x ?? 0,
    y: n.ui?.y ?? 0,
    w: n.ui?.width ?? DEFAULT_W,
    h: n.ui?.height ?? DEFAULT_H,
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function countGroupFrameOverlaps(graph: SkillFlowGraphV2, plan: SkillLayoutPlanV2 | SkillLayoutPlanV3): number {
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const padX = SKILL_LAYOUT_SPACING.groupPaddingX;
  const padY = SKILL_LAYOUT_SPACING.groupPaddingY;
  const frames: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const g of plan.groups) {
    const members = g.nodeIds.map((id) => byId.get(id)).filter(Boolean) as SkillNodeV2[];
    if (members.length === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of members) {
      const x = n.ui?.x ?? 0;
      const y = n.ui?.y ?? 0;
      const w = n.ui?.width ?? DEFAULT_W;
      const h = n.ui?.height ?? DEFAULT_H;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }
    frames.push({
      x: minX - padX,
      y: minY - padY,
      w: maxX - minX + padX * 2,
      h: maxY - minY + padY * 2,
    });
  }
  let overlaps = 0;
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (rectsOverlap(frames[i], frames[j])) overlaps += 1;
    }
  }
  return overlaps;
}

/** Bounding box of node set */
export function graphCanvasBounds(nodes: SkillNodeV2[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const r = nodeRect(n);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

export function detectOneLongStringLayout(graph: SkillFlowGraphV2): boolean {
  const nodes = graph.nodes;
  if (nodes.length <= BAD_LAYOUT_THRESHOLDS.minNodesForBandHeuristic) return false;

  const ys = nodes.map((n) => (n.ui?.y ?? 0) + (n.ui?.height ?? DEFAULT_H) / 2);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const variance = ys.reduce((s, y) => s + (y - mean) ** 2, 0) / ys.length;
  const stdev = Math.sqrt(variance);
  const narrowBand = stdev < 120;

  const bb = graphCanvasBounds(nodes);
  if (!bb) return false;
  const w = bb.maxX - bb.minX;
  const h = Math.max(1, bb.maxY - bb.minY);
  const ratio = w / h;

  const sameLaneRatio =
    ys.filter((y) => Math.abs(y - mean) < 55).length / nodes.length;

  return (
    narrowBand &&
    ratio > BAD_LAYOUT_THRESHOLDS.maxWidthHeightRatio &&
    sameLaneRatio > BAD_LAYOUT_THRESHOLDS.maxSameLaneNodeRatio
  );
}

function edgeLength(graph: SkillFlowGraphV2, e: SkillEdgeV2): number {
  const s = graph.nodes.find((n) => n.id === e.source);
  const t = graph.nodes.find((n) => n.id === e.target);
  if (!s || !t) return 0;
  const a = nodeRect(s);
  const b = nodeRect(t);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const cx2 = b.x + b.w / 2;
  const cy2 = b.y + b.h / 2;
  return Math.hypot(cx2 - cx, cy2 - cy);
}

/** Rough crossing estimate: count pairs of edges whose segments might cross (center lines). */
function estimateEdgeCrossings(graph: SkillFlowGraphV2): number {
  const edges = graph.edges;
  let crosses = 0;
  const centers = (e: SkillEdgeV2) => {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    if (!s || !t) return null;
    const a = nodeRect(s);
    const b = nodeRect(t);
    return {
      x1: a.x + a.w / 2,
      y1: a.y + a.h / 2,
      x2: b.x + b.w / 2,
      y2: b.y + b.h / 2,
    };
  };
  for (let i = 0; i < edges.length; i++) {
    const c1 = centers(edges[i]);
    if (!c1) continue;
    for (let j = i + 1; j < edges.length; j++) {
      const c2 = centers(edges[j]);
      if (!c2) continue;
      // segment intersection quick test
      const det = (c1.x2 - c1.x1) * (c2.y2 - c2.y1) - (c2.x2 - c2.x1) * (c1.y2 - c1.y1);
      if (Math.abs(det) < 1e-6) continue;
      crosses += 1;
    }
  }
  return Math.min(crosses, edges.length * 2);
}

export function computeSkillLayoutQuality(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV2 | SkillLayoutPlanV3 | undefined,
  obstacles: LayoutObstacle[],
): SkillLayoutQualityReport {
  const warnings: string[] = [];
  const lagRiskWarnings: string[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const unassigned: string[] = [];
  if (plan) {
    const assigned = new Set(plan.nodeAssignments.map((a) => a.nodeId));
    for (const id of nodeIds) {
      if (!assigned.has(id)) unassigned.push(id);
    }
  }

  let nodeOverlaps = 0;
  const rects = graph.nodes.map((n) => ({ id: n.id, ...nodeRect(n) }));
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (rectsOverlap(a, b)) nodeOverlaps += 1;
    }
  }

  const lengths = graph.edges.map((e) => edgeLength(graph, e));
  const avgLen = lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0;
  const maxLen = lengths.length ? Math.max(...lengths) : 0;

  const bb = graphCanvasBounds(graph.nodes);
  const w = bb ? bb.maxX - bb.minX : 0;
  const h = bb ? Math.max(1, bb.maxY - bb.minY) : 1;
  const widthHeightRatio = w / h;

  const ys = graph.nodes.map((n) => (n.ui?.y ?? 0) + (n.ui?.height ?? DEFAULT_H) / 2);
  const mean = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  const sameLaneNodeRatio = ys.length
    ? ys.filter((y) => Math.abs(y - mean) < 55).length / ys.length
    : 0;

  const longStringDetected = detectOneLongStringLayout(graph);

  const edgeCrossings = estimateEdgeCrossings(graph);

  const groupOverlaps = plan ? countGroupFrameOverlaps(graph, plan) : 0;

  let edgeNodeIntersections = 0;
  let edgeGroupIntersections = 0;
  for (const e of graph.edges) {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    if (!s || !t) continue;
    const p0 = { x: (s.ui?.x ?? 0) + (s.ui?.width ?? DEFAULT_W), y: (s.ui?.y ?? 0) + (s.ui?.height ?? DEFAULT_H) / 2 };
    const p1 = { x: t.ui?.x ?? 0, y: (t.ui?.y ?? 0) + (t.ui?.height ?? DEFAULT_H) / 2 };
    for (const o of obstacles) {
      if (o.id === e.source || o.id === e.target) continue;
      const r = inflatedRectFromObstacle(o);
      if (segmentHitsRect(p0, p1, r)) {
        if (o.kind === 'node' || o.kind === 'artifact') edgeNodeIntersections += 1;
        else if (o.kind === 'group') edgeGroupIntersections += 1;
      }
    }
  }

  if (avgLen > 720 && graph.edges.length > 6) {
    lagRiskWarnings.push('Average edge span is high; canvas interactions may feel heavy.');
  }
  if (graph.edges.length > 40) {
    lagRiskWarnings.push('Very large edge count — prefer grouping or artifact buses.');
  }

  let score = 100;
  score -= nodeOverlaps * 15;
  score -= groupOverlaps * 12;
  score -= edgeNodeIntersections * 8;
  score -= edgeGroupIntersections * 5;
  score -= edgeCrossings * 0.5;
  score -= Math.min(40, avgLen / 25);
  if (longStringDetected) score -= 35;
  if (sameLaneNodeRatio > BAD_LAYOUT_THRESHOLDS.maxSameLaneNodeRatio && graph.nodes.length > BAD_LAYOUT_THRESHOLDS.minNodesForBandHeuristic) {
    score -= 20;
  }
  if (widthHeightRatio > BAD_LAYOUT_THRESHOLDS.maxWidthHeightRatio && graph.nodes.length > 6) {
    score -= 15;
  }
  score = Math.max(0, Math.min(100, score));

  if (longStringDetected) warnings.push('Layout looks like a single horizontal band.');
  if (nodeOverlaps) warnings.push(`${nodeOverlaps} node overlap pairs detected.`);
  if (groupOverlaps) warnings.push(`${groupOverlaps} group frame overlap pair(s).`);

  return {
    score,
    edgeNodeIntersections,
    edgeGroupIntersections,
    nodeOverlaps,
    groupOverlaps,
    edgeCrossings,
    averageEdgeLength: avgLen,
    maxEdgeLength: maxLen,
    widthHeightRatio,
    sameLaneNodeRatio,
    longStringDetected,
    unassignedNodes: unassigned,
    warnings,
    lagRiskWarnings,
  };
}

export function layoutQualityBetter(a: SkillLayoutQualityReport, b: SkillLayoutQualityReport): boolean {
  if (a.longStringDetected !== b.longStringDetected) return !a.longStringDetected && b.longStringDetected;
  if (a.nodeOverlaps !== b.nodeOverlaps) return a.nodeOverlaps < b.nodeOverlaps;
  if (a.groupOverlaps !== b.groupOverlaps) return a.groupOverlaps < b.groupOverlaps;
  if (a.edgeNodeIntersections !== b.edgeNodeIntersections) return a.edgeNodeIntersections < b.edgeNodeIntersections;
  return a.score > b.score;
}

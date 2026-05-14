import type { Edge, Node } from '@xyflow/react';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_ARTIFACT_RF_TYPE, SKILL_FLOW_RF_TYPE } from './skillFlowRf';

/**
 * Applies selection, neighbor fade, and highlight styling without recomputing orthogonal routes.
 * Base geometry comes from `skillGraphToReactFlow(..., selectedId: null, { fadeNeighbors: false })`.
 */
export function applySkillFlowRfSelectionPresentation(
  graph: SkillFlowGraphV2,
  baseNodes: Node[],
  baseEdges: Edge[],
  selectedNodeIds: string[],
  selectedEdgeId: string | null,
  trace?: {
    activeNodeId?: string | null;
    activeEdgeId?: string | null;
    pulseEdgeIds?: string[];
  },
): { nodes: Node[]; edges: Edge[] } {
  const realNodeIds = new Set(graph.nodes.map((n) => n.id));
  const pulseEdges = new Set(trace?.pulseEdgeIds ?? []);
  const traceOn = Boolean(trace?.activeNodeId);
  const sel = new Set((traceOn ? [] : selectedNodeIds).filter((id) => realNodeIds.has(id)));
  const hasSel = !traceOn && sel.size > 0;
  const focusEdgeIds = new Set<string>([
    ...(trace?.activeEdgeId ? [trace.activeEdgeId] : []),
    ...pulseEdges,
  ]);
  const focusNodeIds = new Set<string>(trace?.activeNodeId ? [trace.activeNodeId] : []);

  if (trace?.activeNodeId) {
    for (const e of graph.edges) {
      const structural = e.ui?.semanticKind !== 'data_read' && e.ui?.semanticKind !== 'data_write';
      const touchesActive = e.source === trace.activeNodeId || e.target === trace.activeNodeId;
      if (touchesActive && structural) {
        focusEdgeIds.add(e.id);
      }
      if (focusEdgeIds.has(e.id)) {
        focusNodeIds.add(e.source);
        focusNodeIds.add(e.target);
      }
    }
  }

  const dimNodeStyle = (style: Node['style'] | undefined): Node['style'] => ({
    ...(style && typeof style === 'object' && !Array.isArray(style) ? style : {}),
    opacity: 0.3,
    filter: 'grayscale(0.35) saturate(0.65)',
  });

  const nodes = baseNodes.map((n) => {
    if (n.type === SKILL_FLOW_RF_TYPE && n.data && typeof n.data === 'object') {
      const selected = sel.has(n.id);
      const traceActive = trace?.activeNodeId === n.id;
      const traceFocused = !traceOn || focusNodeIds.has(n.id);
      return {
        ...n,
        selected,
        data: {
          ...n.data,
          selected,
          traceActive,
        },
        style: traceFocused ? n.style : dimNodeStyle(n.style),
        ...(traceFocused ? { zIndex: Math.max(typeof n.zIndex === 'number' ? n.zIndex : 0, traceActive ? 130 : 95) } : {}),
      };
    }
    if (traceOn && (n.type === SKILL_ARTIFACT_RF_TYPE || realNodeIds.has(n.id)) && !focusNodeIds.has(n.id)) {
      return { ...n, style: dimNodeStyle(n.style), zIndex: Math.min(typeof n.zIndex === 'number' ? n.zIndex : 0, 2) };
    }
    return n;
  });

  const edges = baseEdges.map((e) => {
    const incident =
      hasSel && (sel.has(e.source) || sel.has(e.target)) && realNodeIds.has(e.source) && realNodeIds.has(e.target);
    const edgeSel = !traceOn && selectedEdgeId === e.id;
    const traceActive = trace?.activeEdgeId === e.id;
    const tracePulse = pulseEdges.has(e.id);
    const traceFocused = !traceOn || focusEdgeIds.has(e.id);
    const highlight = incident || edgeSel || traceActive || tracePulse || (traceOn && traceFocused);

    const baseStyle =
      e.style && typeof e.style === 'object' && !Array.isArray(e.style)
        ? { ...(e.style as Record<string, unknown>) }
        : {};

    if (hasSel && !incident) {
      const op = baseStyle.opacity;
      baseStyle.opacity = typeof op === 'number' ? op * 0.25 : 0.22;
    }
    if (traceOn && !traceFocused) {
      baseStyle.opacity = 0.3;
      baseStyle.strokeWidth = Math.max(Number(baseStyle.strokeWidth) || 2, 1.8);
    }
    if (highlight) {
      const sw = Number(baseStyle.strokeWidth);
      baseStyle.strokeWidth = Math.max(Number.isFinite(sw) ? sw : 2.5, 3.6);
      baseStyle.opacity = 1;
    }
    if (traceActive || tracePulse) {
      baseStyle.strokeWidth = Math.max(Number(baseStyle.strokeWidth) || 0, tracePulse ? 4 : 3.8);
      baseStyle.opacity = 1;
      if (tracePulse) baseStyle.strokeDasharray = '9 5';
    }

    return {
      ...e,
      style: baseStyle as Edge['style'],
      selected: edgeSel,
      animated: traceFocused && (e.animated || tracePulse),
      ...(highlight ? { zIndex: tracePulse ? 120 : 90 } : {}),
    };
  });

  return { nodes, edges };
}

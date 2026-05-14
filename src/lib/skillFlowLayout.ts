import dagre from 'dagre';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

export type LayoutDirection = 'TB' | 'LR' | 'BT' | 'RL';

const DEFAULT_NODE_W = 220;
const DEFAULT_NODE_H = 100;

export interface DagreLayoutOptions {
  direction?: LayoutDirection;
  nodeSep?: number;
  rankSep?: number;
  marginX?: number;
  marginY?: number;
}

/**
 * Apply Dagre layout; overwrites `node.ui.x` / `y` unless `respectManual` and node has `manuallyPositioned`.
 */
export function applyDagreLayout(
  graph: SkillFlowGraphV2,
  opts?: DagreLayoutOptions & { respectManual?: boolean },
): SkillFlowGraphV2 {
  const {
    direction = 'LR',
    nodeSep = 80,
    rankSep = 180,
    marginX = 24,
    marginY = 24,
    respectManual = true,
  } = opts ?? {};

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
    marginx: marginX,
    marginy: marginY,
  });

  for (const n of graph.nodes) {
    if (respectManual && n.ui?.manuallyPositioned) continue;
    const w = n.ui?.width ?? DEFAULT_NODE_W;
    const h = n.ui?.height ?? DEFAULT_NODE_H;
    g.setNode(n.id, { width: w, height: h });
  }

  for (const e of graph.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  try {
    dagre.layout(g);
  } catch {
    return graph;
  }

  const nodes = graph.nodes.map((node) => {
    if (respectManual && node.ui?.manuallyPositioned) return node;
    if (!g.hasNode(node.id)) {
      const x = node.ui?.x ?? 0;
      const y = node.ui?.y ?? 0;
      return {
        ...node,
        ui: {
          ...node.ui,
          x,
          y,
          width: node.ui?.width ?? DEFAULT_NODE_W,
          height: node.ui?.height ?? DEFAULT_NODE_H,
          manuallyPositioned: false,
        },
      };
    }
    const pos = g.node(node.id);
    const w = node.ui?.width ?? DEFAULT_NODE_W;
    const h = node.ui?.height ?? DEFAULT_NODE_H;
    const x = pos.x - w / 2;
    const y = pos.y - h / 2;
    return {
      ...node,
      ui: {
        ...node.ui,
        x,
        y,
        width: w,
        height: h,
        manuallyPositioned: false,
      },
    };
  });

  return { ...graph, nodes };
}

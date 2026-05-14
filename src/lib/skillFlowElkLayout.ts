import ELK from 'elkjs/lib/elk.bundled.js';
import type { SkillEdgeV2, SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';
import type { SkillLayoutGroupV2 } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV2 } from './skillFlowLayoutPlanV2';
import { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';

const DEFAULT_W = 220;
const DEFAULT_H = 96;

/** Max groups placed side-by-side before wrapping to the next row (reduces “one long line”). */
const MAX_GROUPS_PER_ROW = 3;

function nodeBox(n: SkillNodeV2): { w: number; h: number } {
  return { w: n.ui?.width ?? DEFAULT_W, h: n.ui?.height ?? DEFAULT_H };
}

/** Run ELK layered layout on a subset of nodes; returns map id -> top-left absolute offset within subgraph (0,0). */
export async function elkLayoutSubgraph(
  nodeIds: string[],
  edges: SkillEdgeV2[],
  nodeById: Map<string, SkillNodeV2>,
): Promise<{ positions: Map<string, { x: number; y: number }>; width: number; height: number }> {
  const idSet = new Set(nodeIds);
  const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  if (nodeIds.length === 0) {
    return { positions: new Map(), width: 100, height: 100 };
  }

  const elk = new ELK();
  const children = nodeIds.map((id) => {
    const n = nodeById.get(id);
    const { w, h } = n ? nodeBox(n) : { w: DEFAULT_W, h: DEFAULT_H };
    return { id, width: w, height: h };
  });

  const elkEdges = subEdges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  const graph = {
    id: 'subroot',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(SKILL_LAYOUT_SPACING.nodeGapX),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(SKILL_LAYOUT_SPACING.nodeGapY + 40),
    },
    children,
    edges: elkEdges,
  };

  try {
    const laid = await elk.layout(graph as Parameters<typeof elk.layout>[0]);
    const positions = new Map<string, { x: number; y: number }>();
    const walk = (nodes: typeof laid.children) => {
      if (!nodes) return;
      for (const ch of nodes) {
        if (ch.x !== undefined && ch.y !== undefined) {
          positions.set(ch.id, { x: ch.x, y: ch.y });
        }
        if (ch.children?.length) walk(ch.children);
      }
    };
    walk(laid.children);
    const width = laid.width ?? 400;
    const height = laid.height ?? 300;
    return { positions, width, height };
  } catch {
    const positions = new Map<string, { x: number; y: number }>();
    let x = 0;
    for (const id of nodeIds) {
      positions.set(id, { x, y: 0 });
      x += DEFAULT_W + SKILL_LAYOUT_SPACING.nodeGapX;
    }
    return {
      positions,
      width: Math.max(x, 360),
      height: DEFAULT_H + SKILL_LAYOUT_SPACING.groupPaddingY * 2,
    };
  }
}

function laneYOffset(plan: SkillLayoutPlanV2, group: SkillLayoutGroupV2): number {
  const lane = plan.lanes.find((l) => l.id === group.laneId);
  if (!lane) return 0;
  const swim = plan.strategy === 'swimlane-workflow' || plan.strategy === 'decision-tree';
  if (swim) {
    if (lane.kind === 'upper-branch') return -95;
    if (lane.kind === 'lower-branch') return 95;
    if (lane.kind === 'main-flow') return 0;
  }
  const band = lane.yBand ?? lane.order * 48;
  return Math.min(140, band * 0.35);
}

/**
 * Multi-row grouped packing: groups advance along X, wrap every MAX_GROUPS_PER_ROW; rows stack on Y.
 */
export async function runGroupedLayoutEngine(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV2,
  preserveManual: boolean,
): Promise<SkillFlowGraphV2> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const sortedGroups = [...(plan.groups ?? [])].sort((a, b) => a.order - b.order);

  const maxPerRow =
    plan.strategy === 'mind-map' ? 2 : plan.strategy === 'hybrid-map' ? MAX_GROUPS_PER_ROW : MAX_GROUPS_PER_ROW;

  const rows: SkillLayoutGroupV2[][] = [];
  for (let i = 0; i < sortedGroups.length; i += maxPerRow) {
    rows.push(sortedGroups.slice(i, i + maxPerRow));
  }

  const baseY = SKILL_LAYOUT_SPACING.groupPaddingY;
  const header = SKILL_LAYOUT_SPACING.groupHeaderHeight;

  const updates = new Map<string, { x: number; y: number }>();

  let rowBaseY: number = baseY;

  for (const row of rows) {
    let cursorX = SKILL_LAYOUT_SPACING.groupPaddingX;
    let rowMaxInnerBottom = 0;

    for (const g of row) {
      const ids = [...new Set(g.nodeIds ?? [])].filter((id) => nodeById.has(id));
      if (!ids.length) continue;

      const { positions, width, height } = await elkLayoutSubgraph(ids, graph.edges, nodeById);

      const laneShift = laneYOffset(plan, g);
      const innerTop = rowBaseY + header + laneShift;
      const boxW = width + SKILL_LAYOUT_SPACING.groupPaddingX * 2;
      const innerBottom = innerTop + height + SKILL_LAYOUT_SPACING.groupPaddingY;
      rowMaxInnerBottom = Math.max(rowMaxInnerBottom, innerBottom);

      for (const id of ids) {
        const n = nodeById.get(id);
        if (!n) continue;
        if (preserveManual && n.ui?.manuallyPositioned) continue;
        const p = positions.get(id);
        if (!p) continue;
        updates.set(id, {
          x: cursorX + SKILL_LAYOUT_SPACING.groupPaddingX + p.x,
          y: innerTop + p.y,
        });
      }

      cursorX += boxW + SKILL_LAYOUT_SPACING.groupGapX;
    }

    rowBaseY = rowMaxInnerBottom > rowBaseY ? rowMaxInnerBottom + SKILL_LAYOUT_SPACING.groupGapY : rowBaseY + 280;
  }

  const assigned = new Set<string>();
  for (const g of plan.groups ?? []) {
    for (const id of g.nodeIds ?? []) assigned.add(id);
  }

  const orphans = graph.nodes.filter((n) => !assigned.has(n.id));
  if (orphans.length) {
    let ox = SKILL_LAYOUT_SPACING.groupPaddingX;
    const oy = rowBaseY + header;
    for (const n of orphans) {
      if (preserveManual && n.ui?.manuallyPositioned) continue;
      updates.set(n.id, { x: ox, y: oy });
      ox += DEFAULT_W + SKILL_LAYOUT_SPACING.nodeGapX;
    }
  }

  const nodes = graph.nodes.map((n) => {
    const u = updates.get(n.id);
    if (!u) return n;
    return {
      ...n,
      ui: {
        ...n.ui,
        x: u.x,
        y: u.y,
        width: n.ui?.width ?? DEFAULT_W,
        height: n.ui?.height ?? DEFAULT_H,
        manuallyPositioned: preserveManual && n.ui?.manuallyPositioned ? true : false,
      },
    };
  });

  return { ...graph, nodes };
}

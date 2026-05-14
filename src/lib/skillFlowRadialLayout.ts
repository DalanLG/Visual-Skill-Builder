import type { SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';
import type { SkillLayoutGroupV2 } from './skillFlowLayoutPlanV2';
import type { SkillLayoutPlanV3 } from './skillFlowLayoutPlanV3';
import type { SkillRadialSector } from './skillFlowLayoutPlanV3';
import { elkLayoutSubgraph } from './skillFlowElkLayout';
import { SKILL_LAYOUT_SPACING } from './skillFlowLayoutSpacing';

const DEFAULT_W = 220;
const DEFAULT_H = 96;

/** Ellipse radii for sector placement (px) */
export const RADIAL_SPIDER_DEFAULTS = {
  centerX: 520,
  centerY: 380,
  radiusX: 560,
  radiusY: 320,
} as const;

const HUB_TOKENS =
  /\b(framing|target|golden|strategy|decision|core|main|goal|hub|central)\b/i;

function sectorAngleFromPlacement(placement: SkillRadialSector['placement']): number {
  const map: Record<SkillRadialSector['placement'], number> = {
    top: -Math.PI / 2,
    'top-right': -Math.PI / 4,
    right: 0,
    'bottom-right': Math.PI / 4,
    bottom: Math.PI / 2,
    'bottom-left': (3 * Math.PI) / 4,
    left: Math.PI,
    'top-left': (-3 * Math.PI) / 4,
  };
  return map[placement];
}

/** Deterministic hub pick: explicit plan → goal kind → label tokens → max degree */
export function pickCenterNodeId(graph: SkillFlowGraphV2, plan?: SkillLayoutPlanV3): string | null {
  if (plan?.centerNodeId && graph.nodes.some((n) => n.id === plan.centerNodeId)) {
    return plan.centerNodeId;
  }
  const goal = graph.nodes.find((n) => n.kind === 'goal');
  if (goal) return goal.id;

  let best: string | null = null;
  let bestScore = -1;
  for (const n of graph.nodes) {
    let s = 0;
    if (HUB_TOKENS.test(n.label)) s += 80;
    const deg = graph.edges.filter((e) => e.source === n.id || e.target === n.id).length;
    s += deg * 3;
    if (n.kind === 'decision') s += 25;
    if (s > bestScore) {
      bestScore = s;
      best = n.id;
    }
  }
  return best ?? graph.nodes[0]?.id ?? null;
}

/**
 * Radial spider layout: hub near canvas center; other groups on an ellipse by sector/order.
 */
export async function runRadialSpiderLayout(
  graph: SkillFlowGraphV2,
  plan: SkillLayoutPlanV3,
  preserveManual: boolean,
): Promise<SkillFlowGraphV2> {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const centerId = pickCenterNodeId(graph, plan);
  const cx = RADIAL_SPIDER_DEFAULTS.centerX;
  const cy = RADIAL_SPIDER_DEFAULTS.centerY;
  const rx = RADIAL_SPIDER_DEFAULTS.radiusX;
  const ry = RADIAL_SPIDER_DEFAULTS.radiusY;

  const sortedGroups = [...(plan.groups ?? [])].sort((a, b) => a.order - b.order);
  const hubGroup = centerId ? sortedGroups.find((g) => (g.nodeIds ?? []).includes(centerId)) : undefined;

  const updates = new Map<string, { x: number; y: number }>();

  async function placeGroupAt(
    g: SkillLayoutGroupV2,
    originX: number,
    originY: number,
  ): Promise<void> {
    const ids = [...new Set(g.nodeIds ?? [])].filter((id) => nodeById.has(id));
    if (!ids.length) return;
    const { positions } = await elkLayoutSubgraph(ids, graph.edges, nodeById);
    const header = SKILL_LAYOUT_SPACING.groupHeaderHeight;
    const pad = SKILL_LAYOUT_SPACING.groupPaddingX;
    for (const id of ids) {
      const n = nodeById.get(id);
      if (!n) continue;
      if (preserveManual && n.ui?.manuallyPositioned) continue;
      const p = positions.get(id);
      if (!p) continue;
      updates.set(id, {
        x: originX + pad + p.x,
        y: originY + header + p.y,
      });
    }
  }

  if (hubGroup && centerId) {
    const ids = [...new Set(hubGroup.nodeIds ?? [])].filter((id) => nodeById.has(id));
    if (ids.length) {
      const { positions, width, height } = await elkLayoutSubgraph(ids, graph.edges, nodeById);
      const hubLocal = positions.get(centerId);
      if (hubLocal) {
        const pad = SKILL_LAYOUT_SPACING.groupPaddingX;
        const header = SKILL_LAYOUT_SPACING.groupHeaderHeight;
        const originX = cx - hubLocal.x - width / 2 - pad;
        const originY = cy - hubLocal.y - height / 2 - header;
        for (const id of ids) {
          const n = nodeById.get(id);
          if (!n) continue;
          if (preserveManual && n.ui?.manuallyPositioned) continue;
          const p = positions.get(id);
          if (!p) continue;
          updates.set(id, {
            x: originX + pad + p.x,
            y: originY + header + p.y,
          });
        }
      }
    }
  }

  const others = sortedGroups.filter((g) => g.id !== hubGroup?.id);
  const nOthers = Math.max(1, others.length);
  let idx = 0;

  for (const g of others) {
    let theta = -Math.PI / 2 + (idx / nOthers) * 2 * Math.PI;
    const sector = plan.radialSectors?.find((s) => (s.groupIds ?? []).includes(g.id));
    if (sector) {
      theta = sectorAngleFromPlacement(sector.placement);
    }
    idx += 1;
    const gx = cx + Math.cos(theta) * rx - 200;
    const gy = cy + Math.sin(theta) * ry - 120;
    await placeGroupAt(g, gx, gy);
  }

  const orphans = graph.nodes.filter((n) => !updates.has(n.id));
  if (orphans.length) {
    let ox = cx + rx + 120;
    const oy = cy;
    for (const n of orphans) {
      if (preserveManual && n.ui?.manuallyPositioned) continue;
      updates.set(n.id, { x: ox, y: oy });
      ox += DEFAULT_W + SKILL_LAYOUT_SPACING.nodeGapX;
    }
  }

  const nodes: SkillNodeV2[] = graph.nodes.map((n) => {
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

export function isRadialLikeStrategy(s: string): boolean {
  return s === 'radial-spider-map' || s === 'hub-and-spoke';
}

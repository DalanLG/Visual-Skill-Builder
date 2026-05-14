import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_LAYOUT_PLAN_V3_VERSION } from './skillFlowLayoutPlanV3';

/** Optional baseline quality from the current canvas — steering hints for the model */
export type SkillLayoutQualityPromptHint = {
  score: number;
  longStringDetected: boolean;
  warnings: string[];
};

/** Compact JSON-safe snapshot for Codex layout planner */
export function buildCompactGraphForLayoutPrompt(
  graph: SkillFlowGraphV2,
  layoutQuality?: SkillLayoutQualityPromptHint,
): string {
  const branchEdges = graph.edges.filter((e) => e.kind === 'branch').length;
  const sequenceEdges = graph.edges.filter((e) => e.kind === 'sequence').length;
  const rawPlan = graph.layout?.layoutPlan;
  let layoutPlanSummary: Record<string, unknown> | null = null;
  if (rawPlan && typeof rawPlan === 'object') {
    const p = rawPlan as unknown as Record<string, unknown>;
    layoutPlanSummary = {
      version: p.version,
      strategy: typeof p.strategy === 'string' ? p.strategy : undefined,
      groupCount: Array.isArray(p.groups) ? p.groups.length : undefined,
    };
  }

  const payload = {
    graphId: graph.id,
    name: graph.name,
    description: graph.description ?? '',
    metrics: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      branchEdges,
      sequenceEdges,
    },
    layoutStrategy: graph.layout?.strategy,
    layoutPlanSummary,
    layoutQuality: layoutQuality ?? undefined,
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      label: n.label,
      summary: (n.summary ?? '').slice(0, 200),
      priority: typeof n.layer === 'number' ? n.layer : 0,
      status: n.status ?? 'valid',
      tags: n.tags ?? [],
      currentGroup: n.groupId ?? null,
      currentLayer: n.layer ?? 0,
      currentOrder: 0,
      currentPosition: { x: n.ui?.x ?? 0, y: n.ui?.y ?? 0 },
      manuallyPositioned: n.ui?.manuallyPositioned === true,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      label: e.label ?? '',
      priority: e.kind === 'sequence' ? 2 : 1,
    })),
    currentGroups: (graph.groups ?? []).map((g) => ({ id: g.id, label: g.label })),
  };
  return JSON.stringify(payload, null, 0);
}

export function buildSkillGraphLayoutPlanPrompt(graph: SkillFlowGraphV2): string {
  const compact = buildCompactGraphForLayoutPrompt(graph);
  return [
    'You are a visual workflow layout planner.',
    '',
    'You receive a skill graph with nodes and edges. Your job is not to change the skill content. Your job is to create a semantic layout plan so the graph becomes easy for a human to understand.',
    '',
    'Return one JSON object only matching SkillLayoutPlanV1 schema:',
    '- version must be "1.0"',
    `- graphId must be "${graph.id}"`,
    '- orientation: "left-to-right" | "top-to-bottom"',
    '- layoutIntent: short string',
    '- groups: array with id, label, kind (phase|task|decision|research|scoring|generation|validation|output|rules|tools|guardrails|examples|misc), nodeIds, order, laneId?, visual: { colorKey, emphasis }',
    '- lanes: array with id, label, kind (main-flow|decision-branch|supporting-rules|tools|validation|outputs|fallbacks), order',
    '- nodeAssignments: one entry per graph node id with nodeId, groupId?, laneId?, role, layer, order, preferredPosition?, visualEmphasis',
    '- edgePlans: one entry per graph edge id with edgeId, routeKind (main|branch|support|constraint|validation|tool|fallback|deemphasized), visible, labelVisible, visualEmphasis',
    '- mainPath: ordered node ids for primary workflow',
    '- branchPaths optional; if present each entry MUST include: id, label, startNodeId (existing node id — typically the decision node), nodeIds (subset of graph nodes on this branch), placement (upper|lower|parallel). If you omit branchPaths entirely, that is OK.',
    '',
    'Rules:',
    '- Do not invent new skill nodes.',
    '- Do not delete existing nodes.',
    '- Do not rename nodes.',
    '- Do not change node content.',
    '- Only assign nodes to groups, lanes, roles, layers, order, and edge visual plans.',
    '',
    'Prioritize:',
    '1. readable main path',
    '2. clear grouping',
    '3. minimal edge crossings',
    '4. meaningful phase panels',
    '5. branch separation',
    '6. muted support edges',
    '7. outputs/conclusions at the end',
    '',
    'Create groups when nodes belong to the same task, phase, or purpose.',
    'Prefer 4 to 8 groups for medium graphs.',
    'Main workflow should flow left to right.',
    '',
    'Graph JSON:',
    compact,
  ].join('\n');
}

/** Codex prompt for SkillLayoutPlanV2 — semantic strategy, swimlanes, optional layout artifacts */
export function buildSkillGraphLayoutPlanPromptV2(
  graph: SkillFlowGraphV2,
  layoutQuality?: SkillLayoutQualityPromptHint,
): string {
  const compact = buildCompactGraphForLayoutPrompt(graph, layoutQuality);
  return [
    'You are a semantic workflow layout planner for a desktop skill graph editor.',
    '',
    'Do NOT change skill content: do not add/remove/rename nodes or edges in the skill graph. Only emit a **SkillLayoutPlanV2** JSON object that describes grouping, lanes, assignments, edge styling metadata, and optional **layout-only data artifacts**.',
    '',
    'Return **one JSON object only** (no Markdown fences, no prose):',
    `- version: "2.0"`,
    `- graphId: "${graph.id}"`,
    '- strategy: "grouped-workflow" | "mind-map" | "hybrid-map" | "swimlane-workflow" | "decision-tree" | "dataflow"',
    '- orientation: "left-to-right" | "top-to-bottom" | "radial"',
    '- intent: short human-readable layout goal',
    '- groups[]: id, label, kind (start|input|preparation|research|analysis|scoring|decision|generation|validation|output|rules|tools|guardrails|examples|fallback|misc|phase|task), nodeIds, order, laneId?, layoutRole (main-panel|side-panel|branch-panel|output-panel|support-panel|data-panel), visual: { colorKey (start|input|research|analysis|scoring|decision|generation|validation|output|rules|tools|guardrails|artifact|neutral|goal), emphasis }',
    '- lanes[]: id, label, kind (main-flow|upper-branch|lower-branch|supporting-rules|validation|outputs|tools|artifact-bus|support), order, yBand (number, vertical hint)',
    '- nodeAssignments[]: one per graph node — nodeId, groupId, laneId?, role, layer, order, placement (inside-group|right-sidecar|above-main|below-main|artifact-bus), visualEmphasis',
    '- edgePlans[]: one per graph edge — edgeId, routeKind (main|branch|support|constraint|validation|tool|fallback|deemphasized|artifact), colorKey (main|decision|muted|artifact|…), visible, labelVisible, visualEmphasis, routingPolicy (orthogonal-avoid-obstacles|direct-with-clearance|bus|hidden-until-selected)',
    '- mainPath: ordered node ids for the primary story',
    '- branchPaths optional — each: id, label, startNodeId (required, existing node), nodeIds, placement (upper|lower|parallel), endNodeId optional',
    '- dataArtifacts optional — visual-only nodes: id (unique), label, kind (variable|intermediate-result|score-table|research-notes|candidate-list|decision-state|output-draft), producedBy[] (producer node ids), consumedBy[] (consumer node ids), description?, exportBehavior "visual-only" | "include-in-markdown", visual { colorKey: "artifact", emphasis }. Artifact ids MUST NOT match any skill node id.',
    '- constraints optional — maxGroupsPerRow, minGroupSeparation, preferVerticalBranches',
    '',
    'Steering (from current canvas metrics):',
    '- If layoutQuality.longStringDetected is true or layoutQuality.score is low, prefer **swimlane-workflow** or **hybrid-map**, more groups, vertical separation (lanes / yBand), not a single horizontal strip.',
    '- Use branchPaths when there are branch edges; set startNodeId to a real decision or branch node.',
    '- Prefer meaningful phases over one long row of panels.',
    '',
    'Graph JSON:',
    compact,
  ].join('\n');
}

export function buildSkillGraphLayoutPlanRepairPrompt(planJson: string, graph: SkillFlowGraphV2): string {
  const compact = buildCompactGraphForLayoutPrompt(graph);
  return [
    'Validate and repair this SkillLayoutPlanV1 JSON.',
    '',
    'Return repaired JSON only.',
    'No Markdown.',
    'No comments.',
    'No prose.',
    '',
    'Rules:',
    '- Do not add or remove skill nodes.',
    '- Do not add or remove skill edges.',
    '- Every referenced nodeId must exist in the graph.',
    '- Every referenced edgeId must exist in the graph.',
    '- Every graph node must have exactly one node assignment.',
    '- Group nodeIds must reference existing nodes.',
    '- Lane IDs referenced by groups or assignments must exist.',
    '- Main path must reference existing nodes.',
    '- If branchPaths is included: every entry MUST have startNodeId set to an existing graph node id (use the decision node or the first node in nodeIds). Do not leave startNodeId empty.',
    '- If you cannot satisfy branchPaths correctly, omit branchPaths entirely.',
    '- Remove invalid references.',
    '- Fix duplicate group IDs.',
    '- Fix duplicate lane IDs.',
    '- Fix missing required fields.',
    '- Keep the plan as close as possible to the original.',
    '',
    'Broken or partial plan JSON:',
    '---',
    planJson.slice(0, 100000),
    '---',
    '',
    'Authoritative graph:',
    compact,
  ].join('\n');
}

export function buildSkillGraphLayoutPlanRepairPromptV2(planJson: string, graph: SkillFlowGraphV2): string {
  const compact = buildCompactGraphForLayoutPrompt(graph);
  return [
    'Validate and repair this SkillLayoutPlanV2 JSON (version "2.0").',
    '',
    'Return repaired JSON only.',
    'No Markdown.',
    'No comments.',
    'No prose.',
    '',
    'Rules:',
    '- Do not add or remove skill nodes or edges from the skill graph.',
    '- graphId must match the authoritative graph.',
    '- Every referenced nodeId and edgeId must exist in the graph.',
    '- Every graph node must have exactly one node assignment.',
    '- Group nodeIds must reference existing nodes.',
    '- Lane IDs referenced by groups or assignments must exist.',
    '- Main path must reference existing nodes.',
    '- dataArtifacts ids must be unique and must NOT collide with any skill node id.',
    '- dataArtifacts entries must include producedBy and consumedBy as JSON arrays (not producerIds); each id must exist on the graph.',
    '- If branchPaths is included: every entry MUST have startNodeId set to an existing graph node id.',
    '- If you cannot satisfy branchPaths correctly, omit branchPaths entirely.',
    '- Remove invalid references; fix duplicate IDs; fill required fields.',
    '- Keep the plan as close as possible to the original.',
    '',
    'Broken or partial plan JSON:',
    '---',
    planJson.slice(0, 100000),
    '---',
    '',
    'Authoritative graph:',
    compact,
  ].join('\n');
}

export type SkillLayoutPlanV3PromptMode = 'radial-spider-map' | 'visual-coding-board';

/** Codex prompt for SkillLayoutPlanV3 — radial spider / visual-coding strategies + hub metadata */
export function buildSkillGraphLayoutPlanPromptV3(
  graph: SkillFlowGraphV2,
  layoutQuality?: SkillLayoutQualityPromptHint,
  options?: { mode?: SkillLayoutPlanV3PromptMode },
): string {
  const compact = buildCompactGraphForLayoutPrompt(graph, layoutQuality);
  const mode = options?.mode ?? 'radial-spider-map';
  const strategyHint =
    mode === 'visual-coding-board'
      ? 'Prefer **visual-coding-board**: board-like placement with clear variable / artifact lanes when **dataArtifacts** help.'
      : 'Prefer **radial-spider-map** or **hub-and-spoke**: pick a **centerNodeId** (main goal or hub step), place clusters in **radialSectors** around an ellipse, fan sequence edges from center where possible.';

  return [
    'You are a semantic workflow layout planner for a desktop skill graph editor.',
    '',
    'Do NOT change skill content: do not add/remove/rename nodes or edges. Emit **SkillLayoutPlanV3** JSON only.',
    '',
    'Return **one JSON object only** (no Markdown fences, no prose):',
    `- version: "${SKILL_LAYOUT_PLAN_V3_VERSION}"`,
    `- graphId: "${graph.id}"`,
    '- strategy: include **radial-spider-map** | **hub-and-spoke** | **visual-coding-board** | grouped-workflow | mind-map | hybrid-map | swimlane-workflow | decision-tree | dataflow',
    '- orientation: "left-to-right" | "top-to-bottom" | "radial"',
    '- intent: short layout goal',
    '- **centerNodeId** optional but encouraged for radial/hub — must be an existing graph node id (typically goal or highest-degree hub).',
    '- **radialSectors** optional — array of { id, label, placement (top|top-right|right|bottom-right|bottom|bottom-left|left|top-left), groupIds[], order }',
    '- groups[], lanes[], nodeAssignments[], edgePlans[], mainPath[], branchPaths?, dataArtifacts?, constraints? — same semantics as V2 (see V2 prompt).',
    '- edgePlans: include **colorKey** where possible so primary flows are not neutral gray (main, decision, artifact, validation, muted).',
    '',
    'Steering:',
    strategyHint,
    '- If layoutQuality.longStringDetected or low score: avoid a single long horizontal strip; use sectors, lanes, or board regions.',
    '- branchPaths: each entry MUST have **startNodeId** when present.',
    '',
    'Graph JSON:',
    compact,
  ].join('\n');
}

export function buildSkillGraphLayoutPlanRepairPromptV3(planJson: string, graph: SkillFlowGraphV2): string {
  const compact = buildCompactGraphForLayoutPrompt(graph);
  return [
    `Validate and repair this SkillLayoutPlanV3 JSON (version "${SKILL_LAYOUT_PLAN_V3_VERSION}").`,
    '',
    'Return repaired JSON only.',
    'No Markdown.',
    'No comments.',
    'No prose.',
    '',
    'Rules:',
    '- Do not add or remove skill nodes or edges from the skill graph.',
    '- graphId must match the authoritative graph.',
    '- version must remain "3.0".',
    '- Every referenced nodeId and edgeId must exist in the graph.',
    '- Every graph node must have exactly one node assignment.',
    '- **centerNodeId** if set must reference an existing node.',
    '- **radialSectors** groupIds must reference existing group ids.',
    '- dataArtifacts ids unique; no collision with skill node ids; use producedBy/consumedBy arrays.',
    '- branchPaths: each MUST have startNodeId when included; otherwise omit branchPaths.',
    '- Remove invalid references; fix duplicate IDs; fill required fields.',
    '- Keep the plan as close as possible to the original.',
    '',
    'Broken or partial plan JSON:',
    '---',
    planJson.slice(0, 100000),
    '---',
    '',
    'Authoritative graph:',
    compact,
  ].join('\n');
}

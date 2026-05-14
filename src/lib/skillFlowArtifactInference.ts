import type { SkillDataArtifactLayoutNode } from './skillFlowLayoutPlanV2';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';

/** Minimum number of distinct dependency targets before we synthesize a visual variable bus. */
const FANOUT_THRESHOLD = 2;

/** Heuristic layout-only artifacts when many nodes depend on one producer (visual bus). */
export function inferDataArtifactsForGraph(graph: SkillFlowGraphV2): SkillDataArtifactLayoutNode[] | undefined {
  const outDepends = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'depends_on') continue;
    const arr = outDepends.get(e.source) ?? [];
    arr.push(e.target);
    outDepends.set(e.source, arr);
  }

  const out: SkillDataArtifactLayoutNode[] = [];
  const graphIds = new Set(graph.nodes.map((n) => n.id));

  for (const [source, targets] of outDepends) {
    const uniq = [...new Set(targets)].filter((id) => graphIds.has(id));
    if (uniq.length < FANOUT_THRESHOLD || !graphIds.has(source)) continue;
    const id = `inferred-bus-${source}`;
    const srcNode = graph.nodes.find((n) => n.id === source);
    const label = srcNode?.label ? `Shared (${srcNode.label})` : `Shared deps (${source})`;
    out.push({
      id,
      label,
      kind: 'variable',
      producedBy: [source],
      consumedBy: uniq,
      exportBehavior: 'visual-only',
      visual: { colorKey: 'artifact', emphasis: 'secondary' },
    });
  }

  return out.length ? out : undefined;
}

export function mergeInferredArtifactsIntoPlan<T extends { dataArtifacts?: SkillDataArtifactLayoutNode[] }>(
  plan: T,
  graph: SkillFlowGraphV2,
): T {
  const inferred = inferDataArtifactsForGraph(graph);
  if (!inferred?.length) return plan;
  const existing = plan.dataArtifacts ?? [];
  const byId = new Set(existing.map((a) => a.id));
  const merged = [...existing];
  for (const a of inferred) {
    if (!byId.has(a.id)) merged.push(a);
  }
  return { ...plan, dataArtifacts: merged };
}

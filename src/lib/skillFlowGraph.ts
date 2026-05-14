import { extractJsonObject, type SkillFile } from './mdSkillTaskImport';

export const SKILL_FLOW_GRAPH_VERSION = 1 as const;

export interface SkillFlowNode {
  id: string;
  label: string;
  description?: string;
}

export interface SkillFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** Persisted skill definition as a directed graph (n8n-style processes). */
export interface SkillFlowGraphV1 {
  version: typeof SKILL_FLOW_GRAPH_VERSION;
  name: string;
  description?: string;
  nodes: SkillFlowNode[];
  edges: SkillFlowEdge[];
}

export function skillFileToLinearGraph(skill: SkillFile): SkillFlowGraphV1 {
  const nodes: SkillFlowNode[] = skill.steps.map((step, i) => ({
    id: `step-${i}`,
    label: step.slice(0, 120) + (step.length > 120 ? '…' : ''),
    description: step.length > 120 ? step : undefined,
  }));
  const edges: SkillFlowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    });
  }
  return {
    version: SKILL_FLOW_GRAPH_VERSION,
    name: skill.name,
    description: skill.description,
    nodes,
    edges,
  };
}

export function normalizeSkillFlowGraph(raw: unknown): SkillFlowGraphV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  if (o.version === 1 || o.version === SKILL_FLOW_GRAPH_VERSION) {
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) return null;
    if (!Array.isArray(o.nodes)) return null;
    const nodes: SkillFlowNode[] = [];
    for (const item of o.nodes) {
      if (!item || typeof item !== 'object') continue;
      const n = item as Record<string, unknown>;
      const id = typeof n.id === 'string' ? n.id.trim() : '';
      const label = typeof n.label === 'string' ? n.label.trim() : '';
      if (!id || !label) continue;
      nodes.push({
        id,
        label,
        ...(typeof n.description === 'string' && n.description.trim() ? { description: n.description.trim() } : {}),
      });
    }
    if (!nodes.length) return null;
    const edges: SkillFlowEdge[] = [];
    if (Array.isArray(o.edges)) {
      for (const item of o.edges) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        const id = typeof e.id === 'string' ? e.id.trim() : '';
        const source = typeof e.source === 'string' ? e.source.trim() : '';
        const target = typeof e.target === 'string' ? e.target.trim() : '';
        if (!id || !source || !target) continue;
        edges.push({
          id,
          source,
          target,
          ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
        });
      }
    }
    return {
      version: SKILL_FLOW_GRAPH_VERSION,
      name,
      ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description.trim() } : {}),
      nodes,
      edges,
    };
  }

  const sf = raw as Partial<SkillFile>;
  if (typeof sf.name === 'string' && Array.isArray(sf.steps)) {
    return skillFileToLinearGraph(sf as SkillFile);
  }
  return null;
}

export function parseSkillFlowGraphJson(text: string): SkillFlowGraphV1 | null {
  try {
    const raw = JSON.parse(text) as unknown;
    return normalizeSkillFlowGraph(raw);
  } catch {
    return null;
  }
}

export function parseSkillFlowGraphFromStdout(stdout: string): { graph: SkillFlowGraphV1 } | { error: string } {
  const blob = extractJsonObject(stdout);
  if (!blob) return { error: 'No JSON object found in Codex output.' };
  try {
    const raw = JSON.parse(blob) as unknown;
    const graph = normalizeSkillFlowGraph(raw);
    if (!graph) return { error: 'JSON did not match SkillFlowGraphV1.' };
    return { graph };
  } catch {
    return { error: 'Invalid JSON from Codex.' };
  }
}

export function buildSkillGraphOutlinePrompt(): string {
  return [
    'You analyze a Markdown document that describes a reusable skill or workflow.',
    'Read the markdown file referenced in this message.',
    'Produce a concise outline: overall purpose, inputs/outputs if any, and ordered processes or stages.',
    'Use markdown bullets and numbering. Do not output JSON in this step.',
  ].join('\n');
}

export function buildSkillFlowGraphJsonPrompt(outline: string): string {
  return [
    'Convert the outline below into ONE JSON object only — a directed graph of processes (nodes) and connections (edges), similar to n8n.',
    'Outline:',
    '---',
    outline.trim(),
    '---',
    'Required shape (no markdown fences, no commentary):',
    '{',
    '  "version": 1,',
    '  "name": "short_skill_id",',
    '  "description": "optional string",',
    '  "nodes": [ { "id": "n1", "label": "Title", "description": "optional" } ],',
    '  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "label": "optional" } ]',
    '}',
    'Rules:',
    '- Every node needs unique string id and non-empty label.',
    '- Every edge needs unique id; source and target must match node ids.',
    '- Express real dependencies from the outline (not only a linear chain unless the doc is linear).',
  ].join('\n');
}

export function slugifyGraphName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'skill';
}

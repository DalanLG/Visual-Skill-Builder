import {
  canonicalizeSkillGraph,
  defaultContractForNode,
  normalizeVariableName,
} from './skillFlowCanonical';
import type { SkillFlowGraphV2, SkillNodeKind, SkillNodeV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import type { SkillMarkdownIr, SkillMarkdownIrSection } from './skillFlowMarkdownIr';

function slugPart(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return slug || fallback;
}

function summaryFrom(section: SkillMarkdownIrSection): string {
  const source = section.bullets[0] || section.text.split(/\n+/).find(Boolean) || section.title;
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function kindForSection(section: SkillMarkdownIrSection): SkillNodeKind {
  const hay = `${section.title} ${section.text}`.toLowerCase();
  if (/goal|objective|purpose/.test(hay)) return 'goal';
  if (/input|precondition|context|requirement/.test(hay)) return 'input';
  if (/response|final answer|final reply/.test(hay)) return 'response';
  if (/output|deliverable|result|export/.test(hay)) return 'output';
  if (/decision|branch|choose|if\b|criteria/.test(hay)) return 'decision';
  if (/rule|constraint|must|never|always/.test(hay)) return 'rule';
  if (/guardrail|safety|avoid|forbidden/.test(hay)) return 'guardrail';
  if (/validate|check|verify|quality/.test(hay)) return 'validation';
  if (/example|sample/.test(hay)) return 'example';
  if (/tool|api|search|browser|script/.test(hay)) return 'tool';
  return 'step';
}

function reusableVariableForSection(section: SkillMarkdownIrSection): string | null {
  const hay = `${section.title} ${section.text}`.toLowerCase();
  if (!/(report|research|notes|draft|dataset|data|facts|score|decision state|analysis|output)/.test(hay)) {
    return null;
  }
  return normalizeVariableName(section.title, 'section_artifact');
}

function nodeFromSection(section: SkillMarkdownIrSection, index: number): SkillNodeV2 {
  const kind = kindForSection(section);
  const contract = defaultContractForNode(kind, section.title);
  const variable = reusableVariableForSection(section);
  const instructions = section.bullets.length ? section.bullets.slice(0, 10) : section.text ? [section.text] : contract.instructions;
  const node: SkillNodeV2 = {
    id: `node-${index + 1}-${slugPart(section.title, 'section')}`,
    label: section.title.slice(0, 80) || `Step ${index + 1}`,
    kind,
    summary: summaryFrom(section),
    body: section.text || section.bullets.join('\n'),
    contract: {
      ...contract,
      purpose: summaryFrom(section),
      inputs: contract.inputs,
      instructions,
      outputs: variable ? [`Reusable artifact ${variable}`] : contract.outputs,
      writes: variable ? [variable] : [],
    },
    variableWrites: variable ? [variable] : undefined,
    status: 'valid',
    layer: index,
    ui: { x: index * 280, y: 0, width: 220, height: 96, manuallyPositioned: false },
  };
  return node;
}

export function fallbackGraphFromMarkdownIr(ir: SkillMarkdownIr): SkillFlowGraphV2 {
  const title = ir.title || ir.frontmatter.name || 'Imported Skill';
  const description = ir.description || `Imported from Markdown with ${ir.sections.length} parsed sections.`;
  const sourceSections = ir.sections.filter((s) => s.title && s.title !== 'Document');
  const sections =
    sourceSections.length > 0
      ? sourceSections
      : [
          {
            depth: 1,
            title,
            text: description,
            bullets: [],
            codeLanguages: [],
          },
        ];

  const nodes = sections.slice(0, 24).map(nodeFromSection);
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${index + 1}-${node.id}-${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id,
    kind: 'sequence' as const,
    ui: { semanticKind: 'main_flow' as const },
  }));

  const graph: SkillFlowGraphV2 = {
    version: SKILL_FLOW_GRAPH_V2_VERSION,
    id: slugPart(title, 'imported-skill'),
    name: title,
    description,
    sourceType: 'markdown',
    nodes,
    edges,
  };
  return canonicalizeSkillGraph(graph);
}

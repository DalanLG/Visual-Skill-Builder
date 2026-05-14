import { canonicalizeSkillGraph, contractToBody } from './skillFlowCanonical';
import type { SkillFlowGraphV2, SkillNodeV2 } from './skillFlowGraphV2';

function yamlScalar(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return JSON.stringify(oneLine);
}

function sortByLayerThenLabel(a: SkillNodeV2, b: SkillNodeV2): number {
  const la = typeof a.layer === 'number' ? a.layer : 999;
  const lb = typeof b.layer === 'number' ? b.layer : 999;
  if (la !== lb) return la - lb;
  return a.label.localeCompare(b.label);
}

function bulletList(lines: string[], values: string[] | undefined): void {
  if (!values?.length) return;
  for (const value of values) lines.push(`- ${value}`);
}

function nodeLabel(graph: SkillFlowGraphV2, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.label ?? id;
}

function workflowNodes(graph: SkillFlowGraphV2): SkillNodeV2[] {
  return graph.nodes
    .filter((n) => n.kind !== 'variable' && n.kind !== 'group' && n.kind !== 'note' && n.kind !== 'response')
    .sort(sortByLayerThenLabel);
}

/**
 * Deterministic official SKILL.md fallback export.
 * The visual graph stays the editable source; this produces the agent-facing artifact.
 */
export function graphToSkillMarkdown(input: SkillFlowGraphV2): string {
  const graph = canonicalizeSkillGraph(input);
  const lines: string[] = [];
  const description = graph.description?.trim() || `Use the ${graph.name} visual skill graph as an executable workflow.`;

  lines.push('---');
  lines.push(`name: ${yamlScalar(graph.name)}`);
  lines.push(`description: ${yamlScalar(description)}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${graph.name}`);
  lines.push('');
  lines.push(description);
  lines.push('');

  const variables = graph.nodes
    .filter((n) => n.kind === 'variable' && n.variable?.exportBehavior !== 'visual-only')
    .sort((a, b) => (a.variable?.variableName ?? a.label).localeCompare(b.variable?.variableName ?? b.label));

  lines.push('## Variables / Artifacts');
  lines.push('');
  if (!variables.length) {
    lines.push('- No reusable artifacts are declared yet.');
  } else {
    for (const variableNode of variables) {
      const v = variableNode.variable;
      if (!v) continue;
      lines.push(`### ${v.variableName}`);
      lines.push('');
      lines.push(`- Label: ${v.label ?? variableNode.label}`);
      lines.push(`- Type: ${v.dataType ?? 'unknown'}`);
      lines.push(`- Artifact kind: ${v.artifactKind ?? 'custom'}`);
      lines.push(`- Storage: ${v.storage ?? 'workspace-file'}`);
      if (v.pathTemplate) lines.push(`- Path template: \`${v.pathTemplate}\``);
      if (v.description) lines.push(`- Description: ${v.description}`);
      const producers = (v.producedBy ?? []).map((id) => nodeLabel(graph, id));
      const consumers = (v.consumedBy ?? []).map((id) => nodeLabel(graph, id));
      if (producers.length) lines.push(`- Created by: ${producers.join(', ')}`);
      if (consumers.length) lines.push(`- Used by: ${consumers.join(', ')}`);
      lines.push('');
      lines.push(`Create \`${v.variableName}\` as a ${v.dataType ?? 'markdown'} artifact before any step reads it.`);
      if (v.storage === 'workspace-file' || !v.storage) {
        lines.push(`If stored to disk, write it to the resolved path template \`${v.pathTemplate ?? '.codex/skill-runs/{skillSlug}/{runId}/{variableName}.md'}\`.`);
      }
      lines.push('');
    }
  }

  lines.push('## Workflow');
  lines.push('');
  const nodes = workflowNodes(graph);
  if (!nodes.length) {
    lines.push('No workflow nodes are declared yet.');
    lines.push('');
  }
  nodes.forEach((node, index) => {
    const c = node.contract;
    lines.push(`### ${index + 1}. ${node.label}`);
    lines.push('');
    lines.push(`Kind: ${node.kind}`);
    lines.push('');
    if (c?.purpose || node.summary) {
      lines.push(c?.purpose ?? node.summary ?? '');
      lines.push('');
    }
    if (c?.reads?.length) {
      lines.push('Read variables:');
      bulletList(lines, c.reads.map((v) => `\`${v}\``));
      lines.push('');
    }
    if (c?.inputs?.length) {
      lines.push('Inputs:');
      bulletList(lines, c.inputs);
      lines.push('');
    }
    if (c?.instructions?.length) {
      lines.push('Instructions:');
      bulletList(lines, c.instructions);
      lines.push('');
    } else if (node.body?.trim()) {
      lines.push(contractToBody(c, node.body));
      lines.push('');
    }
    if (c?.outputs?.length || c?.writes?.length) {
      lines.push('Outputs:');
      bulletList(lines, c?.outputs);
      bulletList(lines, c?.writes?.map((v) => `Write \`${v}\`.`));
      lines.push('');
    }
    if (c?.checks?.length) {
      lines.push('Checks:');
      bulletList(lines, c.checks);
      lines.push('');
    }
    if (c?.failureModes?.length) {
      lines.push('Failure modes:');
      bulletList(lines, c.failureModes);
      lines.push('');
    }
    if (c?.examples?.length) {
      lines.push('Examples:');
      bulletList(lines, c.examples);
      lines.push('');
    }
  });

  const rules = graph.nodes.filter((n) => n.kind === 'rule' || n.kind === 'guardrail').sort(sortByLayerThenLabel);
  if (rules.length) {
    lines.push('## Rules And Guardrails');
    lines.push('');
    for (const rule of rules) {
      lines.push(`### ${rule.label}`);
      lines.push('');
      lines.push(rule.contract?.purpose ?? rule.summary ?? rule.body ?? '');
      if (rule.contract?.instructions?.length) bulletList(lines, rule.contract.instructions);
      if (rule.contract?.checks?.length) {
        lines.push('');
        lines.push('Checks:');
        bulletList(lines, rule.contract.checks);
      }
      lines.push('');
    }
  }

  const outputs = graph.nodes.filter((n) => n.kind === 'output').sort(sortByLayerThenLabel);
  if (outputs.length) {
    lines.push('## Final Output');
    lines.push('');
    for (const output of outputs) {
      lines.push(`- ${output.label}: ${output.contract?.purpose ?? output.summary ?? 'Produce the final deliverable.'}`);
    }
    lines.push('');
  }

  const response = graph.nodes.find((n) => n.kind === 'response');
  if (response) {
    lines.push('## Final Response');
    lines.push('');
    lines.push(response.contract?.purpose ?? response.summary ?? 'Compose the final AI response for the user.');
    if (response.contract?.instructions?.length) {
      lines.push('');
      lines.push('Response instructions:');
      bulletList(lines, response.contract.instructions);
    }
    if (response.contract?.examples?.length) {
      lines.push('');
      lines.push('Example response shape:');
      bulletList(lines, response.contract.examples);
    }
    lines.push('');
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

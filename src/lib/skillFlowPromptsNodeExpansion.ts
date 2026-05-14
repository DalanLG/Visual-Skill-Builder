import type { SkillFlowGraphV2, SkillNodeKind, SkillNodeV2 } from './skillFlowGraphV2';

export type SkillNodeExpansionPromptInput = {
  skillName?: string;
  skillDescription?: string;
  requestedKind: SkillNodeKind;
  userPrompt: string;
  sourceNode?: SkillNodeV2 | null;
  /** Compact JSON-ish lines for nearby nodes */
  nearbyNodesSummary: string;
  existingVariablesSummary: string;
  existingOutputsSummary: string;
};

function summarizeNode(n: SkillNodeV2): string {
  const bits = [n.kind, n.label];
  if (n.summary) bits.push(n.summary.slice(0, 120));
  return bits.join(' | ');
}

export function buildNearbyNodesForPrompt(graph: SkillFlowGraphV2, centerId: string | undefined, limit = 8): string {
  if (!centerId) return '(none)';
  const ids = new Set<string>([centerId]);
  for (const e of graph.edges) {
    if (e.source === centerId) ids.add(e.target);
    if (e.target === centerId) ids.add(e.source);
  }
  const lines: string[] = [];
  for (const id of ids) {
    const n = graph.nodes.find((x) => x.id === id);
    if (n) lines.push(`- ${summarizeNode(n)}`);
    if (lines.length >= limit) break;
  }
  return lines.length ? lines.join('\n') : '(none)';
}

export function buildSkillNodeExpansionPrompt(input: SkillNodeExpansionPromptInput): string {
  const src = input.sourceNode ? summarizeNode(input.sourceNode) : '(none — unconnected node)';
  return [
    'You expand a short user idea into one structured node for a visual AI skill builder.',
    'You create exactly one node for the same canonical visual skill graph.',
    '',
    'Return exactly one JSON object.',
    'Return JSON only.',
    'No Markdown.',
    'No comments.',
    'No prose before or after JSON.',
    '',
    `The user selected this node kind: ${input.requestedKind}`,
    '',
    'The user wrote this rough idea:',
    input.userPrompt.trim() || '(empty)',
    '',
    'The new node will be connected from this source node, if provided:',
    src,
    '',
    'Nearby skill context:',
    input.nearbyNodesSummary,
    '',
    'Existing variable nodes:',
    input.existingVariablesSummary,
    '',
    'Existing output nodes:',
    input.existingOutputsSummary,
    '',
    'Skill name:',
    input.skillName ?? '(unnamed)',
    '',
    'Skill description:',
    input.skillDescription ?? '(none)',
    '',
    'Your job:',
    '- Create one concise, useful node.',
    '- Keep it consistent with the existing skill.',
    '- Do not invent unrelated behavior.',
    '- Do not create multiple nodes.',
    '- Do not rewrite the whole graph.',
    '- Do not duplicate an existing node.',
    '- Use a short label under 48 characters.',
    '- Use a summary under 160 characters.',
    '- Write a practical body with clear instructions.',
    '- Return the same contract shape used by graph import: purpose, inputs, instructions, outputs, checks, failureModes, examples, reads, writes.',
    '- If the node is a variable, create a valid variableName like $evidence_bundle (snake after $) and include artifact metadata.',
    '- Treat variables as reusable artifacts, not decorative cards.',
    '- If this node produces reusable output, add variableWrites and contract.writes.',
    '- If this node needs prior artifact context, add variableReads and contract.reads.',
    '- Match the surrounding graph architecture and variable naming style.',
    '- If the node is a decision, include branchLabels if useful.',
    '- If the node is validation, include validationChecklist.',
    '- If the node is a rule or guardrail, make it strict and clear.',
    '- If the node is a tool, describe when/how the tool should be used.',
    '- If the node is output, describe the final deliverable.',
    '- If the node is response, make it the final terminal answer node: no outgoing workflow, summarize incoming contributors, and include contract.examples with a concrete sample answer, not instructions about answering.',
    '',
    'Return this JSON shape:',
    '{',
    '  "kind": "step | decision | input | output | response | rule | tool | validation | guardrail | example | variable | note",',
    '  "label": "short label",',
    '  "summary": "one sentence summary",',
    '  "body": "detailed node instructions",',
    '  "contract": {',
    '    "purpose": "why this node exists",',
    '    "inputs": ["required context, artifacts, or variables"],',
    '    "instructions": ["specific agent actions"],',
    '    "outputs": ["node deliverables"],',
    '    "checks": ["completion checks"],',
    '    "failureModes": ["what can go wrong and recovery"],',
    '    "examples": ["optional examples"],',
    '    "reads": ["$variable_name"],',
    '    "writes": ["$variable_name"]',
    '  },',
    '  "tags": ["optional"],',
    '  "variable": { "variableName": "$name", "label": "Human name", "dataType": "markdown|json|text|object|list|unknown", "artifactKind": "research-report|notes|decision-state|extracted-data|output-draft|custom", "storage": "in-memory|workspace-file", "pathTemplate": ".codex/skill-runs/{skillSlug}/{runId}/{variableName}.md", "description": "", "sampleValue": "", "exportBehavior": "include-in-markdown" },',
    '  "variableReads": ["$a"],',
    '  "variableWrites": ["$b"],',
    '  "suggestedEdgeSemanticKind": "main|branch|data-read|data-write|rule|guardrail|tool|validation|fallback|output",',
    '  "validationChecklist": [],',
    '  "branchLabels": [],',
    '  "warnings": []',
    '}',
    '',
    'Use kind exactly equal to the requested kind unless the user idea clearly requires a small adjustment.',
  ].join('\n');
}

export function buildSkillNodeExpansionRepairPrompt(brokenJson: string, hints?: string[]): string {
  return [
    'Repair this generated skill node JSON.',
    '',
    'Return JSON only.',
    'No Markdown.',
    'No comments.',
    'No prose.',
    '',
    'Fix:',
    '- invalid JSON',
    '- missing kind',
    '- invalid kind',
    '- missing label',
    '- label longer than 48 characters',
    '- summary longer than 160 characters',
    '- invalid variable name (must match $snake_case)',
    '- invalid edge semantic kind string',
    '- missing variable field for variable kind nodes',
    '',
    hints?.length ? `Hints:\n${hints.join('\n')}` : '',
    '',
    'Broken text:',
    brokenJson.slice(0, 12000),
  ]
    .filter(Boolean)
    .join('\n');
}

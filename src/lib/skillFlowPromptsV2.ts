/**
 * Codex prompts for SkillFlowGraphV2 — outline (no JSON), strict JSON, repair pass.
 */

const CANONICAL_GRAPH_SCHEMA = [
  '{',
  '  "version": "2.0",',
  '  "id": "kebab-case-or-uuid",',
  '  "name": "short skill title",',
  '  "description": "optional string",',
  '  "sourceType": "markdown|visual|mixed",',
  '  "nodes": [',
  '    {',
  '      "id": "kebab-id",',
  '      "label": "short title max ~48 chars",',
  '      "kind": "goal|role|input|output|response|step|rule|note|decision|group|tool|validation|guardrail|example|variable",',
  '      "summary": "one line max ~160 chars",',
  '      "body": "human-readable node instructions generated from contract",',
  '      "contract": {',
  '        "purpose": "why this node exists",',
  '        "inputs": ["required context, artifacts, or variables"],',
  '        "instructions": ["specific agent actions"],',
  '        "outputs": ["node deliverables"],',
  '        "checks": ["completion checks"],',
  '        "failureModes": ["what can go wrong and recovery"],',
  '        "examples": ["optional short examples"],',
  '        "reads": ["$variable_name"],',
  '        "writes": ["$variable_name"]',
  '      },',
  '      "variable": {',
  '        "variableName": "$snake_case",',
  '        "label": "Human name",',
  '        "dataType": "markdown|json|text|object|list|unknown",',
  '        "artifactKind": "research-report|notes|decision-state|extracted-data|output-draft|custom",',
  '        "storage": "in-memory|workspace-file",',
  '        "pathTemplate": ".codex/skill-runs/{skillSlug}/{runId}/{variableName}.md",',
  '        "producedBy": ["node-id"],',
  '        "consumedBy": ["node-id"],',
  '        "exportBehavior": "include-in-markdown"',
  '      },',
  '      "variableReads": ["$name"],',
  '      "variableWrites": ["$name"],',
  '      "tags": ["optional"],',
  '      "layer": 0,',
  '      "status": "valid"',
  '    }',
  '  ],',
  '  "edges": [',
  '    { "id": "e1", "source": "n1", "target": "n2", "kind": "sequence|depends_on|branch|parallel", "label": "optional", "ui": { "semanticKind": "main_flow|dependency|branch|parallel|support|constraint|data_read|data_write" } }',
  '  ],',
  '  "groups": [ { "id": "g1", "label": "Optional group", "nodeIds": ["n1"] } ]',
  '}',
].join('\n');

export function buildSkillMarkdownToGraphPromptV2(input: { markdownIr: string; sourcePath?: string }): string {
  return [
    'You convert a skill specification into the canonical visual skill graph.',
    'Return JSON only. Use SkillFlowGraphV2 version "2.0".',
    'Every node must include label, kind, summary, body, and contract.',
    'Represent reusable intermediate outputs as variable nodes.',
    'Use data_write edges from producer steps to variables.',
    'Use data_read edges from variables to consumer steps.',
    'Include exactly one terminal response node of kind "response" labeled "Response". It must be the final sink: no workflow step may happen after it and it must have no outgoing edges.',
    'Connect every final output, completed terminal workflow step, or final variable that contributes to the answer into this response node only after the producer step for that output/variable has completed.',
    'The response node represents the final AI response returned to the user, not an intermediate output artifact. Its contract examples must contain a concrete example answer with realistic placeholder content, not instructions about how to answer.',
    'If a variable is a report, notes bundle, draft, extracted dataset, or reusable decision state, use dataType "markdown" or "json" and storage "workspace-file".',
    'Infer variables when a step produces reusable context, reports, drafts, extracted facts, scores, decisions, or intermediate files.',
    'Keep nodes compact: summary should be shorter than body; body should follow the same contract structure as generated nodes.',
    'The visual graph is the editable source of truth; the compiled SKILL.md will be derived from it later.',
    '',
    'Required JSON shape:',
    CANONICAL_GRAPH_SCHEMA,
    '',
    input.sourcePath ? `Source path: ${input.sourcePath}` : 'Source path: (pasted markdown)',
    '',
    'Markdown parse IR:',
    '---',
    input.markdownIr.slice(0, 120000),
    '---',
  ].join('\n');
}

export function buildSkillPromptToGraphPromptV2(userPrompt: string): string {
  return [
    'You convert a user request into the canonical visual skill graph.',
    'Return JSON only. Use SkillFlowGraphV2 version "2.0".',
    'Every node must include label, kind, summary, body, and contract.',
    'Represent reusable intermediate outputs as variable nodes.',
    'Use data_write edges from producer steps to variables.',
    'Use data_read edges from variables to consumer steps.',
    'Include exactly one terminal response node of kind "response" labeled "Response". It must be the final sink: no workflow step may happen after it and it must have no outgoing edges.',
    'Connect every final output, completed terminal workflow step, or final variable that contributes to the answer into this response node only after the producer step for that output/variable has completed.',
    'The response node represents the final AI response returned to the user, not an intermediate output artifact. Its contract examples must contain a concrete example answer with realistic placeholder content, not instructions about how to answer.',
    'Make the graph useful for a human to edit visually and for a later compiler to produce SKILL.md.',
    'If the request implies reports, notes, extracted data, drafts, scores, or reusable decisions, model them as variables/artifacts.',
    '',
    'Required JSON shape:',
    CANONICAL_GRAPH_SCHEMA,
    '',
    'User request:',
    '---',
    userPrompt.trim(),
    '---',
  ].join('\n');
}

export function buildSkillGraphToMarkdownCompilePromptV2(graphJson: string): string {
  return [
    'You compile a visual skill graph into an official Codex SKILL.md.',
    'Output Markdown only.',
    'Start with YAML frontmatter containing name and description.',
    'Include a Variables / Artifacts section.',
    'Include a Final Response section based on the graph response node; this is the final answer behavior, not a normal workflow step.',
    'For every variable, explain what creates it, where it is stored if applicable, and which later steps must use it.',
    'Do not include canvas coordinates, node ids, or implementation metadata.',
    'Preserve the contract semantics: purpose, inputs, instructions, outputs, checks, failure modes, examples, reads, and writes.',
    'Make the Markdown optimized for an AI agent executing the skill, not for displaying the graph.',
    '',
    'Graph JSON:',
    '---',
    graphJson.slice(0, 140000),
    '---',
  ].join('\n');
}

export function validateCompiledSkillMarkdown(markdown: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const text = markdown.trim();
  if (!text.startsWith('---')) issues.push('Missing YAML frontmatter.');
  if (!/^---[\s\S]*?\bname\s*:/m.test(text)) issues.push('Frontmatter missing name.');
  if (!/^---[\s\S]*?\bdescription\s*:/m.test(text)) issues.push('Frontmatter missing description.');
  if (!/Variables\s*\/\s*Artifacts|Variables|Artifacts/i.test(text)) issues.push('Missing Variables / Artifacts section.');
  if (!/Workflow|Steps|Procedure|Instructions/i.test(text)) issues.push('Missing workflow instructions section.');
  return { ok: issues.length === 0, issues };
}

export function buildSkillGraphOutlinePromptV2(): string {
  return [
    'You analyze a Markdown document that describes a reusable skill or workflow.',
    'Read the markdown file referenced in this message.',
    '',
    'Produce a structured outline with exactly these numbered sections (use headings and bullets):',
    '1. Purpose — one paragraph.',
    '2. Audience / operator.',
    '3. Preconditions.',
    '4. Inputs (artifacts, data, context).',
    '5. Outputs (artifacts, decisions).',
    '6. Ordered stages or phases (numbered).',
    '7. Decision points or branches.',
    '8. Rules, constraints, guardrails.',
    '9. Failure modes / rollback.',
    '10. Open questions or ambiguities.',
    '',
    'For anything missing from the document, write "Not specified" for that subsection.',
    'Do not output JSON or markdown code fences in this step.',
  ].join('\n');
}

export function buildSkillFlowGraphJsonPromptV2(outline: string): string {
  return [
    'Convert the outline below into ONE JSON object only — a directed graph for a skill planner.',
    'No markdown fences, no commentary before or after the JSON.',
    '',
    'Outline:',
    '---',
    outline.trim(),
    '---',
    '',
    'Required JSON shape:',
    '{',
    '  "version": "2.0",',
    '  "id": "kebab-case-or-uuid",',
    '  "name": "short_skill_title",',
    '  "description": "optional string",',
    '  "nodes": [',
    '    {',
    '      "id": "kebab-id",',
    '      "label": "short title max ~48 chars",',
    '      "kind": "goal|role|input|output|response|step|rule|note|decision|group",',
    '      "summary": "optional one line max ~160 chars",',
    '      "body": "optional longer instructions",',
    '      "tags": ["optional"],',
    '      "layer": 0,',
    '      "status": "valid",',
    '      "ui": { "x": 0, "y": 0, "width": 220, "height": 96, "manuallyPositioned": false }',
    '    }',
    '  ],',
    '  "edges": [',
    '    { "id": "e1", "source": "n1", "target": "n2", "kind": "sequence|depends_on|branch|parallel", "label": "optional" }',
    '  ],',
    '  "groups": [ { "id": "g1", "label": "Optional group" } ]',
    '}',
    '',
    'Rules:',
    '- Use kebab-case for ids where possible.',
    '- Every node needs unique id, non-empty label, and valid kind.',
    '- Every edge needs unique id; source and target must reference node ids.',
    '- Prefer a DAG that reflects dependencies from the outline (not only a linear chain unless the outline is linear).',
    '- Optional "groups" should name 2–5 high-level phases (e.g. intake, core, rules, output) that match the outline; use them to cluster related node ids for visual grouping in the workbench (ids must be unique).',
    '- Keep labels and summaries short; put detail in body.',
    '- version MUST be the string "2.0".',
  ].join('\n');
}

export function buildSkillFlowGraphRepairPromptV2(brokenJson: string, validationHints?: string[]): string {
  const hints =
    validationHints?.filter(Boolean).length ?
      [`Validation issues to fix:`, ...validationHints.filter(Boolean).map((h) => `- ${h}`), '']
    : [];
  return [
    'The following text was supposed to be a single JSON object for SkillFlowGraphV2 (version "2.0").',
    'It may be truncated, wrapped in prose, or invalid.',
    '',
    ...hints,
    'Broken or noisy input:',
    '---',
    brokenJson.slice(0, 120000),
    '---',
    '',
    'Output ONLY one valid JSON object matching the schema from the graph JSON prompt:',
    '- version "2.0", id, name, nodes[], edges[], optional groups[].',
    '- nodes have id, label, kind, summary, body, contract; edges have id, source, target, kind.',
    '- preserve variable nodes and data_write/data_read semantic edges.',
    '- include or preserve exactly one response node of kind "response" that final outputs/terminal steps flow into.',
    '- response must be the final sink: no outgoing edges, no workflow steps after it, and examples should describe the final answer shape.',
    '- schema reminder:',
    CANONICAL_GRAPH_SCHEMA,
    'No markdown fences, no commentary.',
  ].join('\n');
}

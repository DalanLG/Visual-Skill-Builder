/**
 * Codex prompts for the canonical SkillFlowGraphV3 import/export boundary.
 * Function names keep the V2 suffix for existing UI call sites.
 */

const CANONICAL_GRAPH_SCHEMA = [
  '{',
  '  "schemaVersion": "SkillFlowGraphV3",',
  '  "skill": {',
  '    "slug": "kebab-case-skill-slug",',
  '    "name": "Human skill name",',
  '    "description": "Routing description: what the skill does and when to use it.",',
  '    "language": "en",',
  '    "activation": {',
  '      "useWhen": ["specific trigger/use case"],',
  '      "dontUseWhen": ["specific non-use case"],',
  '      "outputsAndSuccessCriteria": ["observable successful output"]',
  '    },',
  '    "compatibility": null,',
  '    "allowedTools": null,',
  '    "tags": []',
  '  },',
  '  "graph": {',
  '    "entryNodeId": "start_or_first_task_id",',
  '    "responseNodeId": "response_id",',
  '    "nodes": [',
  '      {',
  '        "id": "kebab-id",',
  '        "kind": "start|task|decision|parallel_fork|parallel_join|guardrail|artifact|response|loop_controller|subflow",',
  '        "label": "short label",',
  '        "summary": "one-line summary",',
  '        "body": "agent-facing instructions",',
  '        "contract": {',
  '          "purpose": "why this node exists",',
  '          "inputs": [],',
  '          "instructions": [],',
  '          "outputs": [],',
  '          "checks": [{ "id": "check_id", "description": "machine-readable check", "severity": "warn" }],',
  '          "failureModes": [{ "id": "failure_id", "description": "what can go wrong", "severity": "medium", "recovery": "what to do" }],',
  '          "examples": [{ "input": "optional", "output": "example result" }],',
  '          "reads": ["$artifact_name"],',
  '          "writes": ["$artifact_name"]',
  '        },',
  '        "execution": {',
  '          "preconditions": [],',
  '          "postconditions": [],',
  '          "sideEffectLevel": "none|local_write|external_write|network",',
  '          "idempotency": "idempotent|non_idempotent|unknown",',
  '          "retryPolicy": null,',
  '          "timeoutMs": null,',
  '          "requiresHumanApproval": false',
  '        },',
  '        "recovery": { "onCheckFailureGoto": null, "onRuntimeFailureGoto": null, "fallbackResponseMode": "block|degrade|ask_user|silent_skip" },',
  '        "artifactSpec": null,',
  '        "responseSpec": null,',
  '        "tags": [],',
  '        "layer": 0',
  '      }',
  '    ],',
  '    "edges": [',
  '      { "id": "e1", "from": "source-id", "to": "target-id", "semanticKind": "main_flow|data_write|data_read|branch_true|branch_false|branch_default|parallel_start|parallel_join|dependency|recovery|response_contribution", "label": null, "condition": null, "guard": null, "priority": null }',
  '    ],',
  '    "resources": [],',
  '    "sourceAnchors": []',
  '  },',
  '  "compileHints": {',
  '    "keepSkillMdUnderTokens": 5000,',
  '    "preferReferencesForLargeExamples": true,',
  '    "preferredSectionOrder": ["What this skill does", "Use when", "Don\'t use when", "Required inputs", "Variables / Artifacts", "Workflow", "Guardrails and failure handling", "Final response"]',
  '  }',
  '}',
].join('\n');

export function buildSkillMarkdownToGraphPromptV2(input: { markdownIr: string; sourcePath?: string }): string {
  return [
    'You convert a Markdown skill document into the canonical editable graph SkillFlowGraphV3.',
    'The graph is the only source of truth. Return JSON only. Do not write prose.',
    '',
    'Goal:',
    'Preserve workflow semantics, dataflow, guardrails, examples, and final response behavior while keeping the graph human-editable.',
    '',
    'Hard rules:',
    '- Output exactly one SkillFlowGraphV3 object.',
    '- Use the schema exactly. No extra top-level keys.',
    '- There must be exactly one response node, and it must have no outgoing edges.',
    '- Every data dependency must pass through an artifact node.',
    '- Do not invent artifacts, branches, tools, or failure modes unless strongly implied by the source.',
    '- If the source is ambiguous, choose the smallest editable graph that preserves intent.',
    '- Prefer atomic task nodes over large vague nodes.',
    '- Decision logic must use explicit decision nodes and branch edges.',
    '- Parallel work must use explicit parallel_fork and parallel_join nodes when branches reconverge.',
    '- Reads/writes fields must agree with data_read/data_write edges.',
    '- If a value is unknown and the schema allows null, use null.',
    '',
    'What to preserve:',
    '- headings and section boundaries',
    '- ordered steps and nested substeps',
    '- code fences and command examples',
    '- named inputs, outputs, files, variables, paths, schemas',
    '- explicit rules, prohibitions, guardrails, edge cases, and examples',
    '- the user-facing final response behavior',
    '',
    'Validation before returning:',
    '- exactly one entry node and one response node',
    '- all non-start operational nodes are reachable from the entry',
    '- the response node is reachable',
    '- no dangling edges',
    '- no data_read edge from an artifact that has neither a producer nor input artifactKind',
    '- every decision node has explicit branch conditions and one default or exhaustive coverage',
    '- every parallel_fork has a corresponding parallel_join if branches reconverge',
    '',
    'Required JSON shape:',
    CANONICAL_GRAPH_SCHEMA,
    '',
    input.sourcePath ? `Source path: ${input.sourcePath}` : 'Source path: (pasted markdown)',
    '',
    'Markdown parse IR package:',
    '---',
    input.markdownIr.slice(0, 120000),
    '---',
  ].join('\n');
}

export function buildSkillPromptToGraphPromptV2(userPrompt: string): string {
  return [
    'You turn a plain-language skill request into the canonical editable graph SkillFlowGraphV3.',
    'Return JSON only. Do not answer the user task directly.',
    '',
    'Interpretation policy:',
    '- Design a reusable skill workflow that another agent could execute.',
    '- Prefer the smallest graph that is reusable and editable.',
    '- Make stable low-risk assumptions only; keep uncertain assumptions visible in node text.',
    '- Every named file, variable, report, plan, or output becomes an artifact node.',
    '- Every artifact read/write must be represented by edges.',
    '- Every branch must be an explicit decision node with branch edges.',
    '- Exactly one response node must end the graph and have no outgoing edges.',
    '- The response node must include responseSpec with missing-data behavior and evidence policy.',
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
    'You compile SkillFlowGraphV3 into an agent-facing Codex SKILL.md.',
    'Output Markdown only.',
    '',
    'Hard rules:',
    '- Start with YAML frontmatter containing name and description.',
    '- Description must be routable: what the skill does and when to use it.',
    '- Keep SKILL.md compact; use references/ paths for large examples or schema detail when needed.',
    "- Include Use when and Don't use when sections from activation metadata.",
    '- Include artifacts/variables explicitly with names, meaning, storage behavior, producers, and consumers.',
    '- Include workflow steps as executable instructions, not graph UI commentary.',
    '- Include guardrails and failure handling.',
    '- Include final response behavior from the dedicated response node.',
    '- Do not include canvas coordinates, graph ids, node ids, or implementation metadata.',
    '- If graph prose conflicts with explicit edges or responseSpec, prefer explicit graph semantics.',
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
  if (!/Use when/i.test(text)) issues.push('Missing Use when section.');
  if (!/Don'?t use when|Do not use when/i.test(text)) issues.push("Missing Don't use when section.");
  if (!/Variables\s*\/\s*Artifacts|Variables|Artifacts/i.test(text)) issues.push('Missing Variables / Artifacts section.');
  if (!/Workflow|Steps|Procedure|Instructions/i.test(text)) issues.push('Missing workflow instructions section.');
  if (!/Final Response/i.test(text)) issues.push('Missing Final Response section.');
  return { ok: issues.length === 0, issues };
}

export function buildSkillGraphOutlinePromptV2(): string {
  return [
    'You analyze a Markdown document that describes a reusable skill or workflow.',
    'Read the markdown file referenced in this message.',
    '',
    'Produce a structured outline with exactly these numbered sections (use headings and bullets):',
    '1. Purpose - one paragraph.',
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
    'Convert the outline below into ONE JSON object only: a SkillFlowGraphV3.',
    'No markdown fences, no commentary before or after the JSON.',
    '',
    'Outline:',
    '---',
    outline.trim(),
    '---',
    '',
    'Required JSON shape:',
    CANONICAL_GRAPH_SCHEMA,
    '',
    'Rules:',
    '- Use kebab-case ids where possible.',
    '- Every node needs unique id, non-empty label, kind, summary, body, contract, execution, and recovery.',
    '- Every edge needs unique id and valid from/to node ids.',
    '- Prefer a DAG that reflects dependencies from the outline.',
    '- version MUST be represented as schemaVersion "SkillFlowGraphV3".',
  ].join('\n');
}

export function buildSkillFlowGraphRepairPromptV2(brokenJson: string, validationHints?: string[]): string {
  const hints =
    validationHints?.filter(Boolean).length
      ? ['Validation issues to fix:', ...validationHints.filter(Boolean).map((h) => `- ${h}`), '']
      : [];
  return [
    'The following text was supposed to be one SkillFlowGraphV3 JSON object.',
    'It may be truncated, wrapped in prose, or invalid.',
    '',
    ...hints,
    'Broken or noisy input:',
    '---',
    brokenJson.slice(0, 120000),
    '---',
    '',
    'Output ONLY one valid JSON object matching SkillFlowGraphV3:',
    '- preserve source semantics and existing valid nodes/edges',
    '- repair only schema, JSON, and listed validation issues',
    '- preserve artifact nodes and data_write/data_read edges',
    '- include or preserve exactly one response node that final outputs or terminal steps flow into',
    '- response must be the final sink with no outgoing edges and a responseSpec',
    '- do not inflate the graph with speculative branches, tools, or artifacts',
    '- schema reminder:',
    CANONICAL_GRAPH_SCHEMA,
    'No markdown fences, no commentary.',
  ].join('\n');
}

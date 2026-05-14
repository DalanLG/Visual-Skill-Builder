
/** Codex stdout → first balanced JSON object string */
export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  const s = trimmed;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function slugifySkillName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'skill';
}

export function stagingImportPath(prefix: 'task' | 'skill'): string {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : `${Date.now().toString(36)}`;
  return `.visual-skill-builder/imports/${prefix}-${id}.md`;
}

export function buildTaskOutlinePrompt(): string {
  return [
    'You help import a Markdown specification into structured workbench task cards.',
    'Read the markdown file referenced in this message (paths are appended by the tool).',
    'Produce a concise outline with:',
    '1. Main goal / title',
    '2. Key constraints or risks (bullet list)',
    '3. Ordered work items (numbered) suitable as implementation tasks',
    'Use markdown. Do not output JSON in this step.',
  ].join('\n');
}

export function buildTaskJsonPrompt(outline: string): string {
  return [
    'Convert the outline below into JSON only.',
    'Outline:',
    '---',
    outline.trim(),
    '---',
    'Output a single JSON object with this exact shape (no markdown fences, no prose before or after):',
    '{',
    '  "tasks": [',
    '    {',
    '      "goal": "string",',
    '      "scope": "string",',
    '      "criteria": "string",',
    '      "expectedOutputs": "string"',
    '    }',
    '  ]',
    '}',
    'Include one or more tasks. Each task needs all four string fields with substantive content.',
  ].join('\n');
}

export function buildSkillOutlinePrompt(): string {
  return [
    'You help import a Markdown document into a reusable Codex skill definition.',
    'Read the markdown file referenced in this message.',
    'Produce a concise outline: purpose, prerequisites, ordered steps (numbered), suggested verification checks.',
    'Use markdown. Do not output JSON in this step.',
  ].join('\n');
}

export function buildSkillJsonPrompt(outline: string): string {
  return [
    'Convert the outline below into one JSON object only.',
    'Outline:',
    '---',
    outline.trim(),
    '---',
    'Output must match this shape (no markdown fences, no commentary):',
    '{',
    '  "name": "short_skill_name",',
    '  "description": "optional string",',
    '  "steps": ["step 1", "step 2"],',
    '  "checks": ["optional check"],',
    '  "definitionOfDone": "optional string"',
    '}',
    '"name" and "steps" (non-empty array of strings) are required; other fields optional.',
  ].join('\n');
}

export interface TaskImportDraft {
  goal: string;
  scope: string;
  criteria: string;
  expectedOutputs: string;
}

export interface SkillFile {
  name: string;
  description?: string;
  steps: string[];
  checks?: string[];
  definitionOfDone?: string;
}

export function normalizeSkillJson(raw: unknown): SkillFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  if (!Array.isArray(o.steps)) return null;
  const steps = o.steps.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  if (!steps.length) return null;
  const checks = Array.isArray(o.checks)
    ? o.checks.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : undefined;
  const out: SkillFile = {
    name,
    steps,
    ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description.trim() } : {}),
    ...(checks?.length ? { checks } : {}),
    ...(typeof o.definitionOfDone === 'string' && o.definitionOfDone.trim()
      ? { definitionOfDone: o.definitionOfDone.trim() }
      : {}),
  };
  return out;
}

export function parseSkillJsonFromStdout(stdout: string): { skill: SkillFile } | { error: string } {
  const blob = extractJsonObject(stdout);
  if (!blob) return { error: 'No JSON object found in Codex output.' };
  try {
    const raw = JSON.parse(blob) as unknown;
    const skill = normalizeSkillJson(raw);
    if (!skill) return { error: 'JSON did not match a valid SkillFile shape.' };
    return { skill };
  } catch {
    return { error: 'Invalid JSON from Codex.' };
  }
}

export function normalizeTaskImportJson(raw: unknown): TaskImportDraft[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let rows: unknown[];
  if (Array.isArray(o.tasks)) rows = o.tasks;
  else if (typeof o.goal === 'string') rows = [raw];
  else return null;

  const out: TaskImportDraft[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const t = row as Record<string, unknown>;
    const goal = typeof t.goal === 'string' ? t.goal.trim() : '';
    if (!goal) continue;
    const scope = typeof t.scope === 'string' ? t.scope.trim() : '';
    const criteria = typeof t.criteria === 'string' ? t.criteria.trim() : '';
    const expectedOutputs = typeof t.expectedOutputs === 'string' ? t.expectedOutputs.trim() : '';
    out.push({
      goal,
      scope: scope || `Implement only what is needed to complete: ${goal}`,
      criteria: criteria || 'Code changes are correct, tests/checks pass, and docs updated when behavior changes.',
      expectedOutputs: expectedOutputs || 'Changed files list, command/check summary, and a short implementation report.',
    });
  }
  return out.length ? out : null;
}

export function parseTaskImportJsonFromStdout(stdout: string): { tasks: TaskImportDraft[] } | { error: string } {
  const blob = extractJsonObject(stdout);
  if (!blob) return { error: 'No JSON object found in Codex output.' };
  try {
    const raw = JSON.parse(blob) as unknown;
    const tasks = normalizeTaskImportJson(raw);
    if (!tasks?.length) return { error: 'JSON did not contain valid tasks.' };
    return { tasks };
  } catch {
    return { error: 'Invalid JSON from Codex.' };
  }
}

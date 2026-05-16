import { describe, expect, it } from 'vitest';
import { parseSkillMarkdownToIr, skillMarkdownIrToPromptJson } from './skillFlowMarkdownIr';

describe('parseSkillMarkdownToIr', () => {
  it('captures block structure, source anchors, tables, fences, and references', () => {
    const ir = parseSkillMarkdownToIr(`---
name: demo-skill
description: Demo description
---
# Demo Skill

Use this skill when a report must be produced.

## Workflow

1. Read the input.
2. Write the report artifact.

| Field | Meaning |
| --- | --- |
| report | final output |

\`\`\`bash
echo test
\`\`\`

[docs]: ./references/docs.md "Docs"
`);

    expect(ir.title).toBe('demo-skill');
    expect(ir.frontmatter.description).toBe('Demo description');
    expect(ir.sectionOutline.some((s) => s.title === 'Workflow')).toBe(true);
    expect(ir.blocks.some((b) => b.type === 'table')).toBe(true);
    expect(ir.blocks.some((b) => b.type === 'code_fence' && b.language === 'bash')).toBe(true);
    expect(ir.referenceDefinitions[0]).toMatchObject({ label: 'docs', href: './references/docs.md' });
    expect(ir.candidates.artifacts.some((a) => /report/i.test(a))).toBe(true);
    expect(ir.sections.every((s) => typeof s.startLine === 'number' && typeof s.endLine === 'number')).toBe(true);
  });

  it('serializes prompt package with candidate semantics', () => {
    const json = skillMarkdownIrToPromptJson(parseSkillMarkdownToIr('# Skill\n\nFinal response should mention the output.'));
    expect(json).toContain('candidateSemantics');
    expect(json).toContain('responseHints');
  });
});

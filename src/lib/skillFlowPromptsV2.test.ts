import { describe, expect, it } from 'vitest';
import {
  buildSkillFlowGraphRepairPromptV2,
  buildSkillGraphToMarkdownCompilePromptV2,
  buildSkillMarkdownToGraphPromptV2,
  buildSkillPromptToGraphPromptV2,
} from './skillFlowPromptsV2';

describe('SkillFlowGraphV3 prompts', () => {
  it('markdown import prompt includes V3 schema and graph invariants', () => {
    const prompt = buildSkillMarkdownToGraphPromptV2({ markdownIr: '{"sectionOutline":[]}' });
    expect(prompt).toContain('SkillFlowGraphV3');
    expect(prompt).toContain('Every data dependency must pass through an artifact node');
    expect(prompt).toContain('response node');
    expect(prompt).toContain('data_read');
    expect(prompt).toContain('data_write');
  });

  it('free prompt import asks for reusable workflow assumptions', () => {
    const prompt = buildSkillPromptToGraphPromptV2('Build a research skill');
    expect(prompt).toContain('Design a reusable skill workflow');
    expect(prompt).toContain('responseSpec');
  });

  it('compile prompt requires routable SKILL.md sections', () => {
    const prompt = buildSkillGraphToMarkdownCompilePromptV2('{"schemaVersion":"SkillFlowGraphV3"}');
    expect(prompt).toContain('Use when');
    expect(prompt).toContain("Don't use when");
    expect(prompt).toContain('final response behavior');
  });

  it('repair prompt limits changes to diagnostics', () => {
    const prompt = buildSkillFlowGraphRepairPromptV2('{broken', ['response missing']);
    expect(prompt).toContain('repair only schema, JSON, and listed validation issues');
    expect(prompt).toContain('do not inflate the graph');
  });
});

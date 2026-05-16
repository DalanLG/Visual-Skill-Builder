/**
 * Smoke / integration tests: panel mounts and the two creation paths wire through
 * staged files, Codex generation, parsing, layout, and graph persistence.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SkillsSetupPanel from './SkillsSetupPanel';
import type { SkillFlowGraphV2 } from '../../lib/skillFlowGraphV2';

const WORKSPACE_ROOT = 'X:/fixture-workspace';

function generatedGraph(name: string): SkillFlowGraphV2 {
  return {
    version: '2.0',
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    description: `${name} generated during test.`,
    sourceType: 'visual',
    nodes: [
      {
        id: 'step-1',
        label: 'Analyze request',
        kind: 'step',
        summary: 'Analyze the request.',
        contract: {
          purpose: 'Analyze the request.',
          inputs: ['User request'],
          instructions: ['Identify the intended outcome.'],
          outputs: ['Analysis notes'],
          checks: ['The request is understood.'],
          failureModes: ['Ask for clarification.'],
          examples: [],
          reads: [],
          writes: [],
        },
      },
      {
        id: 'response',
        label: 'Response',
        kind: 'response',
        summary: 'Compose the final response.',
        contract: {
          purpose: 'Compose the final AI response.',
          inputs: ['Analysis notes'],
          instructions: ['Return the final answer.'],
          outputs: ['Final response'],
          checks: ['The answer is complete.'],
          failureModes: ['If analysis is missing, rerun the prior step.'],
          examples: ['Summary: The skill analyzed the request and returned a concise recommendation.'],
          reads: [],
          writes: [],
        },
      },
    ],
    edges: [
      {
        id: 'edge-step-response',
        source: 'step-1',
        target: 'response',
        kind: 'sequence',
        ui: { semanticKind: 'main_flow', layoutColorKey: 'response' },
      },
    ],
  };
}

function installElectronMock(options?: { markdownByPath?: Map<string, string> }) {
  const markdownByPath = options?.markdownByPath ?? new Map<string, string>();
  window.electronAPI = {
    fsExists: vi.fn().mockResolvedValue({ exists: false }),
    fsReadDir: vi.fn().mockResolvedValue([]),
    fsReadFile: vi.fn(async ({ filePath }: { filePath: string }) => markdownByPath.get(filePath) ?? ''),
    fsWriteFile: vi.fn().mockResolvedValue({ ok: true }),
    fsMkdir: vi.fn().mockResolvedValue({ ok: true }),
    fsUnlink: vi.fn().mockResolvedValue({ ok: true }),
    fsRmdir: vi.fn().mockResolvedValue({ ok: true }),
    fsStat: vi.fn().mockResolvedValue({
      ok: true as const,
      mtimeMs: Date.now(),
      isFile: true,
      isDirectory: false,
    }),
    getConfig: vi.fn().mockResolvedValue({
      environments: [],
      defaults: {
        codexExecutable: '',
        defaultWorkspacePath: '',
        maxConcurrentSessions: 4,
        loggingLevel: 'info',
        defaultCodexModel: 'gpt-5.4',
        defaultCodexReasoningEffort: 'medium',
      },
    }),
    onAppLog: vi.fn(() => () => {}),
    onWorkspaceChange: vi.fn(() => () => {}),
    codexExec: vi.fn().mockResolvedValue({
      ok: true,
      stdout: JSON.stringify(generatedGraph('Generated Skill')),
      stderr: '',
    }),
  } as unknown as NonNullable<typeof window.electronAPI>;
}

beforeEach(() => {
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  installElectronMock();
});

afterEach(() => {
  delete (window as unknown as { [key: string]: unknown })['electronAPI'];
  delete (globalThis as unknown as { [key: string]: unknown })['ResizeObserver'];
});

describe('SkillsSetupPanel', () => {
  it('renders Setup -> Skills UI without ReferenceError when graph is empty', async () => {
    render(<SkillsSetupPanel workspaceRoot={WORKSPACE_ROOT} projectRules="" />);
    expect(await screen.findByText(/Saved skills/i)).toBeTruthy();
    expect(screen.getByText(/No graph yet/i)).toBeTruthy();
  });

  it('creates and saves a graph from a prompt end to end', async () => {
    const api = window.electronAPI!;
    vi.mocked(api.codexExec).mockResolvedValueOnce({
      ok: true,
      stdout: JSON.stringify(generatedGraph('Prompt Skill')),
      stderr: '',
    });

    render(<SkillsSetupPanel workspaceRoot={WORKSPACE_ROOT} projectRules="" />);

    fireEvent.change(await screen.findByPlaceholderText(/describe the skill/i), {
      target: { value: 'Build a skill that summarizes research notes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create graph from prompt/i }));

    await waitFor(() => expect(api.codexExec).toHaveBeenCalledTimes(1));
    expect(api.codexExec).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: WORKSPACE_ROOT,
        model: 'gpt-5.4-mini',
        modelReasoningEffort: 'medium',
        message: expect.stringContaining('You convert a user request into the canonical visual skill graph.'),
      }),
    );
    await waitFor(() =>
      expect(api.fsWriteFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '.codex/skills/prompt-skill/skill.graph.json',
          workspaceRoot: WORKSPACE_ROOT,
        }),
      ),
    );
    expect((await screen.findAllByText(/Prompt graph finished: Prompt Skill/i)).length).toBeGreaterThan(0);
  });

  it('stages pasted Markdown, imports it through Codex, and saves the generated graph', async () => {
    const markdown = '# Pasted Skill\n\nUse the notes to produce a final answer.';
    const markdownByPath = new Map<string, string>();
    installElectronMock({ markdownByPath });
    const api = window.electronAPI!;
    vi.mocked(api.fsWriteFile).mockImplementation(async ({ filePath, content }) => {
      if (String(filePath).startsWith('.visual-skill-builder/imports/')) {
        markdownByPath.set(String(filePath), String(content));
      }
      return { ok: true };
    });
    vi.mocked(api.codexExec).mockResolvedValueOnce({
      ok: true,
      stdout: JSON.stringify(generatedGraph('Pasted Markdown Skill')),
      stderr: '',
    });

    render(<SkillsSetupPanel workspaceRoot={WORKSPACE_ROOT} projectRules="" />);

    fireEvent.change(await screen.findByPlaceholderText(/paste Markdown/i), {
      target: { value: markdown },
    });
    fireEvent.click(screen.getByRole('button', { name: /run import/i }));

    await waitFor(() =>
      expect(api.fsWriteFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: expect.stringMatching(/^\.visual-skill-builder\/imports\/skill-[a-f0-9]+\.md$/),
          content: markdown,
          workspaceRoot: WORKSPACE_ROOT,
        }),
      ),
    );
    await waitFor(() => expect(api.codexExec).toHaveBeenCalledTimes(1));
    expect(api.codexExec).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRoot: WORKSPACE_ROOT,
        model: 'gpt-5.4',
        modelReasoningEffort: 'medium',
        message: expect.stringContaining('You convert a skill specification into the canonical visual skill graph.'),
      }),
    );
    await waitFor(() =>
      expect(api.fsWriteFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '.codex/skills/pasted-markdown-skill/skill.graph.json',
          workspaceRoot: WORKSPACE_ROOT,
        }),
      ),
    );
    expect((await screen.findAllByText(/Import finished: Pasted Markdown Skill/i)).length).toBeGreaterThan(0);
  });
});

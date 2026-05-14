/**
 * Smoke / integration test: panel mounts with mocked Electron APIs (catches missing hooks like saveStatus).
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkillsSetupPanel from './SkillsSetupPanel';

function installElectronMock() {
  window.electronAPI = {
    fsExists: vi.fn().mockResolvedValue({ exists: false }),
    fsReadDir: vi.fn().mockResolvedValue([]),
    fsReadFile: vi.fn(),
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
      },
    }),
    onAppLog: vi.fn(() => () => {}),
    onWorkspaceChange: vi.fn(() => () => {}),
    codexExec: vi.fn(),
  } as unknown as NonNullable<typeof window.electronAPI>;
}

beforeEach(() => {
  installElectronMock();
});

afterEach(() => {
  delete window.electronAPI;
});

describe('SkillsSetupPanel', () => {
  it('renders Setup → Skills UI without ReferenceError when graph is empty', async () => {
    render(<SkillsSetupPanel workspaceRoot="X:/fixture-workspace" projectRules="" />);
    expect(await screen.findByText(/Saved skills/i)).toBeTruthy();
    expect(screen.getByText(/No graph yet/i)).toBeTruthy();
  });
});

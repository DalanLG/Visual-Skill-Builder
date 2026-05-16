/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import type { SetupStatus, VisualSkillBuilderConfig } from '../vite-env.d';

const readyStatus: SetupStatus = {
  node: { status: 'ok', label: 'Node.js', detail: 'v22.15.0', path: 'C:/Program Files/nodejs/node.exe' },
  npm: { status: 'ok', label: 'npm', detail: '10.9.2', path: 'C:/Program Files/nodejs/npm.cmd' },
  codex: { status: 'ok', label: 'Codex CLI', detail: 'codex-cli 0.125.0', path: 'C:/Users/me/AppData/Roaming/Visual Skill Builder/codex-cli/node_modules/.bin/codex.cmd' },
  auth: { status: 'missing', label: 'Codex auth', detail: 'Sign in to Codex.' },
  workspace: { status: 'missing', label: 'Skills workspace', detail: 'Choose a folder for skill files.' },
  smokeTest: { status: 'unknown', label: 'Smoke test', detail: 'Run verification after signing in.' },
  appManagedCodexDir: 'C:/Users/me/AppData/Roaming/Visual Skill Builder/codex-cli',
  appManagedCodexPath: 'C:/Users/me/AppData/Roaming/Visual Skill Builder/codex-cli/node_modules/.bin/codex.cmd',
  setupComplete: false,
  setupMode: 'automatic',
  diagnostics: ['Windows setup avoids npm.ps1 and codex.ps1.'],
};

const config: VisualSkillBuilderConfig = {
  environments: [],
  defaults: {
    codexExecutable: 'codex',
    defaultWorkspacePath: '',
    loggingLevel: 'info',
    defaultCodexModel: 'gpt-5.4',
    defaultCodexReasoningEffort: 'medium',
  },
};

function installElectronMock(status: SetupStatus = readyStatus) {
  let currentStatus = status;
  window.electronAPI = {
    getConfig: vi.fn().mockResolvedValue(config),
    getConfigPath: vi.fn().mockResolvedValue('visual-skill-builder.config.json'),
    saveConfig: vi.fn().mockImplementation(async (next) => next),
    setupStatus: vi.fn().mockImplementation(async () => currentStatus),
    setupSetMode: vi.fn().mockImplementation(async (mode) => {
      currentStatus = { ...currentStatus, setupMode: mode };
      return currentStatus;
    }),
    setupInstallCodex: vi.fn().mockImplementation(async () => ({ ok: true, status: currentStatus })),
    setupLoginCodex: vi.fn().mockImplementation(async () => ({ ok: true, status: currentStatus })),
    setupVerifyCodex: vi.fn().mockImplementation(async () => {
      currentStatus = { ...currentStatus, setupComplete: true };
      return { ok: true, status: currentStatus };
    }),
    setupOpenExternal: vi.fn().mockResolvedValue({ ok: true }),
    onSetupLog: vi.fn(() => () => {}),
    showFolderPicker: vi.fn().mockResolvedValue('X:/skills'),
    openEnvironment: vi.fn(),
    closeLauncher: vi.fn(),
    getEnvContext: vi.fn().mockResolvedValue(null),
    onAppLog: vi.fn(() => () => {}),
    codexExec: vi.fn(),
    fsReadFile: vi.fn(),
    fsExists: vi.fn(),
    fsStat: vi.fn(),
    fsWriteFile: vi.fn(),
    fsReadDir: vi.fn(),
    fsMkdir: vi.fn(),
    fsUnlink: vi.fn(),
    fsRename: vi.fn(),
    fsRmdir: vi.fn(),
    patchApply: vi.fn(),
    attachmentsStore: vi.fn(),
    attachmentsDataUrl: vi.fn(),
  };
}

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronMock();
  });

  it('renders automatic setup actions and calls the app-managed Codex installer', async () => {
    render(
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /install \/ repair codex/i }));

    await waitFor(() => expect(window.electronAPI?.setupInstallCodex).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Windows setup avoids npm\.ps1/i)).toBeTruthy();
  });

  it('switches to manual checklist with Windows-safe commands', async () => {
    render(
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^manual$/i }));

    expect(await screen.findByText(/npm\.cmd install --prefix/i)).toBeTruthy();
    expect(screen.getByText(/login --device-auth/i)).toBeTruthy();
  });

  it('keeps verification errors visible after status refresh', async () => {
    installElectronMock({
      ...readyStatus,
      workspace: { status: 'ok', label: 'Skills workspace', detail: 'Workspace folder is available.', path: 'X:/skills' },
    });
    vi.mocked(window.electronAPI!.setupVerifyCodex!).mockResolvedValueOnce({
      ok: false,
      error: 'Codex needs an upgrade, but repair failed: npm failed',
    });

    render(
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText(/repair failed: npm failed/i)).toBeTruthy();
  });

  it('runs verification from the setup action and reports success', async () => {
    installElectronMock({
      ...readyStatus,
      workspace: { status: 'ok', label: 'Skills workspace', detail: 'Workspace folder is available.', path: 'X:/skills' },
    });

    render(
      <MemoryRouter>
        <SetupWizard />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^verify$/i }));

    await waitFor(() => expect(window.electronAPI?.setupVerifyCodex).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/builder is ready/i)).toBeTruthy();
  });
});

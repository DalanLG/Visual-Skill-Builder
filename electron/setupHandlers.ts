import { BrowserWindow, app, ipcMain, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { loadConfig, saveConfig, type CodexInterfaceConfig } from './config';

export type SetupRequirementStatus = 'ok' | 'missing' | 'error' | 'unknown';

export interface SetupCheck {
  status: SetupRequirementStatus;
  label: string;
  detail?: string;
  path?: string;
}

export interface SetupStatus {
  node: SetupCheck;
  npm: SetupCheck;
  codex: SetupCheck;
  auth: SetupCheck;
  workspace: SetupCheck;
  smokeTest: SetupCheck;
  appManagedCodexDir: string;
  appManagedCodexPath?: string;
  setupComplete: boolean;
  setupMode: 'automatic' | 'manual';
  completedAt?: string;
  diagnostics: string[];
}

type CommandResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

const CODEX_PACKAGE = '@openai/codex@latest';
const SMOKE_PROMPT = 'Reply with exactly: visual-skill-builder-ready';

function appManagedCodexDir(): string {
  return path.join(app.getPath('userData'), 'codex-cli');
}

function appManagedCodexPath(): string {
  return process.platform === 'win32'
    ? path.join(appManagedCodexDir(), 'node_modules', '.bin', 'codex.cmd')
    : path.join(appManagedCodexDir(), 'node_modules', '.bin', 'codex');
}

function pathEntries(envPath = process.env.PATH || process.env.Path || ''): string[] {
  return envPath.split(path.delimiter).filter(Boolean);
}

function findExecutable(names: string[]): string | null {
  for (const dir of pathEntries()) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch {
        // Continue scanning PATH.
      }
    }
  }
  return null;
}

function resolveNodeExecutable(): string | null {
  if (process.platform === 'win32') return findExecutable(['node.exe', 'node.cmd']);
  return findExecutable(['node']);
}

function resolveNpmExecutable(): string | null {
  if (process.platform === 'win32') return findExecutable(['npm.cmd', 'npm.exe']);
  return findExecutable(['npm']);
}

function resolveNpmCommand(): { command: string; argsPrefix: string[]; displayName: string } | null {
  const npm = resolveNpmExecutable();
  if (!npm) return null;
  if (process.platform !== 'win32' || !/\.cmd$/iu.test(npm)) {
    return { command: npm, argsPrefix: [], displayName: npm };
  }
  const node = resolveNodeExecutable();
  const npmCli = path.join(path.dirname(npm), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (node && fs.existsSync(npmCli)) {
    return { command: node, argsPrefix: [npmCli], displayName: `${node} ${npmCli}` };
  }
  return { command: npm, argsPrefix: [], displayName: npm };
}

function resolveCodexNodeCommand(codexPath: string): { command: string; argsPrefix: string[]; displayName: string } {
  if (process.platform === 'win32' && /\.cmd$/iu.test(codexPath)) {
    const node = resolveNodeExecutable();
    const binDir = path.dirname(codexPath);
    const codexJs = path.basename(binDir).toLowerCase() === '.bin'
      ? path.resolve(path.dirname(binDir), '@openai', 'codex', 'bin', 'codex.js')
      : path.resolve(binDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (node && fs.existsSync(codexJs)) {
      return { command: node, argsPrefix: [codexJs], displayName: `${node} ${codexJs}` };
    }
  }
  return { command: codexPath, argsPrefix: [], displayName: codexPath };
}

function isWindowsShellShim(command: string): boolean {
  return process.platform === 'win32' && (!path.isAbsolute(command) || /\.(cmd|bat)$/iu.test(command));
}

function displayArg(arg: string): string {
  return /[\s"]/u.test(arg) ? `"${arg.replace(/"/gu, '\\"')}"` : arg;
}

function cmdQuote(arg: string): string {
  if (!arg) return '""';
  if (!/[\s"&|<>^]/u.test(arg)) return arg;
  return `"${arg.replace(/"/gu, '""')}"`;
}

function spawnTarget(command: string, args: string[]): { command: string; args: string[]; display: string } {
  if (!isWindowsShellShim(command)) {
    return { command, args, display: [command, ...args].map(displayArg).join(' ') };
  }
  const shellCommand = process.env.ComSpec || 'cmd.exe';
  const commandLine = `call ${[command, ...args].map(cmdQuote).join(' ')}`;
  const wrappedArgs = ['/d', '/c', commandLine];
  return {
    command: shellCommand,
    args: wrappedArgs,
    display: `${shellCommand} /d /c ${displayArg(commandLine)}`,
  };
}

function emitSetupLog(message: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) win.webContents.send('setup:log', { message });
  });
}

async function runCommand(
  command: string,
  args: string[],
  opts?: {
    cwd?: string;
    stdin?: string;
    timeoutMs?: number;
    stream?: boolean;
    openUrls?: boolean;
  },
): Promise<CommandResult> {
  const target = spawnTarget(command, args);
  if (opts?.stream) emitSetupLog(`Running ${target.display}`);
  return new Promise((resolve) => {
    const child = spawn(target.command, target.args, {
      cwd: opts?.cwd,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const openedUrls = new Set<string>();
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          child.kill();
          finish({ ok: false, code: null, stdout, stderr, error: `Timed out after ${Math.round(opts.timeoutMs! / 1000)}s` });
        }, opts.timeoutMs)
      : null;
    const handleChunk = (chunk: unknown, kind: 'stdout' | 'stderr') => {
      const text = String(chunk);
      if (kind === 'stdout') stdout += text;
      else stderr += text;
      if (opts?.stream) emitSetupLog(text.trimEnd());
      if (opts?.openUrls) {
        const urls = text.match(/https?:\/\/[^\s)]+/giu) ?? [];
        for (const url of urls) {
          if (openedUrls.has(url)) continue;
          openedUrls.add(url);
          void shell.openExternal(url);
        }
      }
    };
    child.stdout?.on('data', (chunk) => handleChunk(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => handleChunk(chunk, 'stderr'));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      finish({ ok: false, code: null, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      finish({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    if (opts?.stdin != null) child.stdin?.end(opts.stdin);
    else child.stdin?.end();
  });
}

async function commandVersion(command: string, args: string[], timeoutMs = 10_000): Promise<string | undefined> {
  const result = await runCommand(command, args, { timeoutMs });
  return result.ok ? (result.stdout || result.stderr).split(/\r?\n/u)[0]?.trim() : undefined;
}

async function codexCommandVersion(codexPath: string, timeoutMs = 10_000): Promise<string | undefined> {
  const codex = resolveCodexNodeCommand(codexPath);
  const result = await runCommand(codex.command, [...codex.argsPrefix, '--version'], { timeoutMs });
  return result.ok ? (result.stdout || result.stderr).split(/\r?\n/u)[0]?.trim() : undefined;
}

function resolveCodexExecutable(config: CodexInterfaceConfig): string | null {
  const managed = appManagedCodexPath();
  try {
    if (fs.statSync(managed).isFile()) return managed;
  } catch {
    // Continue to configured / PATH fallback.
  }
  const configured = config.defaults.codexExecutable?.trim();
  if (configured && configured !== 'codex') {
    try {
      if (fs.statSync(configured).isFile()) return configured;
    } catch {
      // Continue to PATH fallback.
    }
  }
  if (process.platform === 'win32') return findExecutable(['codex.cmd', 'codex.exe']);
  return findExecutable(['codex']);
}

function authLooksMissing(text: string): boolean {
  return /(not logged in|login required|unauthori[sz]ed|401|sign in|authentication)/iu.test(text);
}

function codexNeedsUpgrade(text: string): boolean {
  return /(requires a newer version of Codex|Please upgrade to the latest app or CLI|upgrade.*Codex)/iu.test(text);
}

function codexHasUnsupportedStdinPrompt(text: string): boolean {
  return /(unexpected argument '-' found|Usage:\s*codex exec)/iu.test(text);
}

async function detectAuth(codexPath: string | null): Promise<SetupCheck> {
  if (!codexPath) return { status: 'unknown', label: 'Codex auth', detail: 'Install Codex before signing in.' };
  const status = await runCommand(codexPath, ['login', 'status'], { timeoutMs: 15_000 });
  const text = `${status.stdout}\n${status.stderr}\n${status.error ?? ''}`.trim();
  if (status.ok && /logged in|authenticated|using an api key|chatgpt/iu.test(text)) {
    return { status: 'ok', label: 'Codex auth', detail: text.split(/\r?\n/u)[0] || 'Signed in.' };
  }
  if (status.ok && text) return { status: 'unknown', label: 'Codex auth', detail: text.split(/\r?\n/u)[0] };
  if (authLooksMissing(text)) return { status: 'missing', label: 'Codex auth', detail: 'Sign in to Codex.' };
  return { status: 'unknown', label: 'Codex auth', detail: text || 'Could not confirm login status yet.' };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const config = loadConfig();
  const diagnostics: string[] = [];
  const nodePath = resolveNodeExecutable();
  const npmPath = resolveNpmExecutable();
  const managedPath = appManagedCodexPath();
  const codexPath = resolveCodexExecutable(config);
  const workspacePath = config.defaults.defaultWorkspacePath?.trim() || config.environments[0]?.rootPath?.trim() || '';

  const node: SetupCheck = nodePath
    ? { status: 'ok', label: 'Node.js', path: nodePath, detail: await commandVersion(nodePath, ['--version']) }
    : { status: 'missing', label: 'Node.js', detail: 'Node.js is required to install app-managed Codex.' };

  const npm: SetupCheck = npmPath
    ? { status: 'ok', label: 'npm', path: npmPath, detail: await commandVersion(npmPath, ['--version']) }
    : { status: 'missing', label: 'npm', detail: 'npm.cmd was not found on PATH.' };

  let codex: SetupCheck = { status: 'missing', label: 'Codex CLI', detail: 'App-managed Codex is not installed yet.' };
  if (codexPath) {
    const version = await codexCommandVersion(codexPath);
    codex = {
      status: 'ok',
      label: 'Codex CLI',
      path: codexPath,
      detail: version || 'Installed.',
    };
  }

  const auth = await detectAuth(codexPath);

  let workspace: SetupCheck = { status: 'missing', label: 'Skills workspace', detail: 'Choose a folder for skill files.' };
  if (workspacePath) {
    try {
      const st = fs.statSync(path.resolve(workspacePath));
      workspace = st.isDirectory()
        ? { status: 'ok', label: 'Skills workspace', path: workspacePath, detail: 'Workspace folder is available.' }
        : { status: 'error', label: 'Skills workspace', path: workspacePath, detail: 'Configured path is not a folder.' };
    } catch (e) {
      workspace = {
        status: 'error',
        label: 'Skills workspace',
        path: workspacePath,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const smokeTest: SetupCheck = config.setupCompletedAt
    ? { status: 'ok', label: 'Smoke test', detail: 'Last verification completed.' }
    : { status: 'unknown', label: 'Smoke test', detail: 'Run verification after signing in.' };

  if (process.platform === 'win32') diagnostics.push('Windows setup avoids npm.ps1 and codex.ps1 because PowerShell execution policy may block script shims.');
  if (!nodePath) diagnostics.push('Install Node.js 20+ before automatic Codex setup.');
  if (!npmPath) diagnostics.push('npm.cmd was not found; automatic install cannot run.');
  if (codexPath && codexPath !== managedPath) diagnostics.push(`Using detected Codex: ${codexPath}. Press Install / Repair Codex to switch to the app-managed latest CLI.`);
  if (codexPath === managedPath) diagnostics.push('Using app-managed Codex. This avoids stale global CLI versions.');

  const setupComplete =
    Boolean(config.setupCompletedAt) &&
    codex.status === 'ok' &&
    auth.status === 'ok' &&
    workspace.status === 'ok';

  return {
    node,
    npm,
    codex,
    auth,
    workspace,
    smokeTest,
    appManagedCodexDir: appManagedCodexDir(),
    appManagedCodexPath: fs.existsSync(managedPath) ? managedPath : undefined,
    setupComplete,
    setupMode: config.setupMode ?? 'automatic',
    completedAt: config.setupCompletedAt,
    diagnostics,
  };
}

async function saveLastStatus(patch?: Partial<CodexInterfaceConfig>): Promise<SetupStatus> {
  const status = await getSetupStatus();
  const config = loadConfig();
  saveConfig({
    ...config,
    ...patch,
    lastSetupStatus: status,
  });
  return status;
}

async function installAppManagedCodex(): Promise<{ ok: true; codexPath: string; version?: string } | { ok: false; error: string }> {
  const npm = resolveNpmCommand();
  if (!npm) return { ok: false, error: 'npm.cmd was not found on PATH. Install Node.js 20+ or use manual setup.' };
  const installDir = appManagedCodexDir();
  await fs.promises.mkdir(installDir, { recursive: true });
  emitSetupLog(`Installing ${CODEX_PACKAGE} into ${installDir}`);
  const result = await runCommand(npm.command, [...npm.argsPrefix, 'install', '--prefix', installDir, CODEX_PACKAGE], {
    cwd: os.homedir(),
    timeoutMs: 180_000,
    stream: true,
  });
  if (!result.ok) {
    await saveLastStatus();
    return { ok: false, error: result.error || result.stderr || `npm exited with ${result.code}` };
  }
  const codexPath = appManagedCodexPath();
  const version = await codexCommandVersion(codexPath);
  const config = loadConfig();
  saveConfig({
    ...config,
    codexInstallDir: installDir,
    codexVersion: version,
    defaults: {
      ...config.defaults,
      codexExecutable: codexPath,
    },
  });
  emitSetupLog(`Installed app-managed Codex${version ? ` (${version})` : ''}.`);
  return { ok: true, codexPath, version };
}

async function runVerification(codex: string, workspacePath: string): Promise<CommandResult> {
  const codexCommand = resolveCodexNodeCommand(codex);
  return runCommand(
    codexCommand.command,
    [...codexCommand.argsPrefix, 'exec', '--full-auto', '--skip-git-repo-check', '--model', 'gpt-5.4', '--cd', workspacePath, SMOKE_PROMPT],
    { cwd: workspacePath, timeoutMs: 120_000, stream: true },
  );
}

export function registerSetupHandlers(): void {
  ipcMain.handle('setup:status', async () => saveLastStatus());

  ipcMain.handle('setup:set-mode', async (_e, mode: 'automatic' | 'manual') => {
    const config = loadConfig();
    saveConfig({ ...config, setupMode: mode });
    return saveLastStatus();
  });

  ipcMain.handle('setup:installCodex', async () => {
    const installed = await installAppManagedCodex();
    if (!installed.ok) return { ok: false, error: installed.error, status: await saveLastStatus() };
    return { ok: true, status: await saveLastStatus(), message: 'Codex installed/repaired. Verification will use the app-managed CLI.' };
  });

  ipcMain.handle('setup:loginCodex', async (_e, payload?: { deviceCode?: boolean }) => {
    const config = loadConfig();
    const codex = resolveCodexExecutable(config);
    if (!codex) return { ok: false, error: 'Codex is not installed yet.' };
    const args = payload?.deviceCode ? ['login', '--device-auth'] : ['login'];
    const codexCommand = resolveCodexNodeCommand(codex);
    const result = await runCommand(codexCommand.command, [...codexCommand.argsPrefix, ...args], {
      cwd: os.homedir(),
      timeoutMs: 300_000,
      stream: true,
      openUrls: true,
    });
    await saveLastStatus();
    return result.ok ? { ok: true } : { ok: false, error: result.error || result.stderr || `Codex login exited with ${result.code}` };
  });

  ipcMain.handle('setup:verifyCodex', async () => {
    const config = loadConfig();
    const codex = resolveCodexExecutable(config);
    if (!codex) return { ok: false, error: 'Codex is not installed yet.' };
    const workspacePath = config.defaults.defaultWorkspacePath?.trim() || config.environments[0]?.rootPath?.trim() || app.getPath('documents');
    try {
      await fs.promises.mkdir(workspacePath, { recursive: true });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    emitSetupLog('Running Codex verification.');
    let activeCodex = codex;
    let result = await runVerification(activeCodex, workspacePath);
    let output = `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`.trim();
    if (codexNeedsUpgrade(output) || codexHasUnsupportedStdinPrompt(output)) {
      const reason = codexNeedsUpgrade(output)
        ? 'Codex reported that it is too old.'
        : 'Codex rejected the verification prompt format.';
      emitSetupLog(`${reason} Installing the app-managed latest Codex and retrying verification.`);
      const installed = await installAppManagedCodex();
      if (!installed.ok) return { ok: false, error: `Codex needs an upgrade, but repair failed: ${installed.error}`, status: await saveLastStatus() };
      activeCodex = installed.codexPath;
      emitSetupLog('Retrying verification with the repaired app-managed Codex.');
      result = await runVerification(activeCodex, workspacePath);
      output = `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`.trim();
    }
    if (!result.ok || authLooksMissing(output)) {
      await saveLastStatus();
      const upgradeHint = codexNeedsUpgrade(output) ? ' Codex still reports that the CLI is too old after repair.' : '';
      return { ok: false, error: `${result.error || output || 'Codex verification failed.'}${upgradeHint}`, status: await saveLastStatus() };
    }
    const completedAt = new Date().toISOString();
    const nextConfig = loadConfig();
    saveConfig({
      ...nextConfig,
      setupCompletedAt: completedAt,
      setupMode: nextConfig.setupMode ?? 'automatic',
      codexInstallDir: nextConfig.codexInstallDir || appManagedCodexDir(),
      defaults: {
        ...nextConfig.defaults,
        codexExecutable: activeCodex,
        defaultWorkspacePath: workspacePath,
      },
    });
    return { ok: true, status: await saveLastStatus() };
  });

  ipcMain.handle('setup:openExternal', async (_e, url: string) => {
    if (!/^https?:\/\//iu.test(url)) return { ok: false, error: 'Only http(s) URLs can be opened.' };
    await shell.openExternal(url);
    return { ok: true };
  });
}

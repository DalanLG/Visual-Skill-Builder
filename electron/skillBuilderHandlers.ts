import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { v4 as uuid } from 'uuid';
import { loadConfig } from './config';

function getCodexExecutable(): string {
  const config = loadConfig();
  return config.defaults?.codexExecutable || 'codex';
}

function resolveWithinWorkspace(workspaceRoot: string, targetPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, targetPath || '.');
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path outside workspace');
  return resolved;
}

function sendLog(msg: string): void {
  const payload: { sessionId: null; message: string } = { sessionId: null, message: msg };
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('app:log', payload);
    }
  });
}

function getMime(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

const CODEX_MODEL_MAX_LEN = 128;
const CODEX_MODEL_PATTERN = /^[a-zA-Z0-9._-]+$/;
const DEFAULT_CODEX_MODEL_ID = 'gpt-5.4';
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
const REASONING_EFFORTS = new Set<string>(['minimal', 'low', 'medium', 'high', 'xhigh']);

function parseCodexModel(model?: string): { model?: string; error?: string } {
  if (model == null || String(model).trim() === '') return {};
  const s = String(model).trim();
  if (s.length > CODEX_MODEL_MAX_LEN) return { error: `Model id too long (max ${CODEX_MODEL_MAX_LEN} characters).` };
  if (!CODEX_MODEL_PATTERN.test(s)) return { error: 'Invalid model id: use only letters, digits, dots, underscores, and hyphens.' };
  return { model: s };
}

function parseReasoningEffort(raw?: string): { effort?: ReasoningEffort; error?: string } {
  if (raw == null || String(raw).trim() === '') return { effort: 'medium' };
  const s = String(raw).trim().toLowerCase();
  if (REASONING_EFFORTS.has(s)) return { effort: s as ReasoningEffort };
  return { error: 'Invalid reasoning effort. Use minimal, low, medium, high, or xhigh.' };
}

function resolveCodexCommand(raw: string, env: NodeJS.ProcessEnv, log: (msg: string) => void): string {
  let codexCmd = raw.trim() || 'codex';
  if (process.platform === 'win32' && !path.isAbsolute(codexCmd)) {
    const npmPath = path.join(process.env.APPDATA || '', 'npm');
    const codexCmdPath = path.join(npmPath, 'codex.cmd');
    const codexExePath = path.join(npmPath, 'codex');
    if (fs.existsSync(codexCmdPath)) {
      codexCmd = codexCmdPath;
      log(`[codex:exec] resolved to codex.cmd: ${codexCmd}`);
    } else if (fs.existsSync(codexExePath)) {
      codexCmd = codexExePath;
      log(`[codex:exec] resolved to codex: ${codexCmd}`);
    } else {
      env.PATH = npmPath + path.delimiter + (env.PATH || env.Path || '');
      log(`[codex:exec] added npm global bin to PATH: ${npmPath}`);
    }
  }
  return codexCmd;
}

export function registerSkillBuilderHandlers(): void {
  ipcMain.handle('codex:exec', async (_e, payload: {
    workspaceRoot: string;
    message: string;
    model?: string;
    modelReasoningEffort?: string;
  }) => {
    const parsedModel = parseCodexModel(payload.model);
    if (parsedModel.error) return { ok: false, error: parsedModel.error };
    const parsedReasoning = parseReasoningEffort(payload.modelReasoningEffort);
    if (parsedReasoning.error) return { ok: false, error: parsedReasoning.error };

    const codexModel = parsedModel.model ?? loadConfig().defaults.defaultCodexModel ?? DEFAULT_CODEX_MODEL_ID;
    const reasoningEffort = parsedReasoning.effort ?? 'medium';
    const cwd = path.resolve(payload.workspaceRoot);
    const message = String(payload.message || '').trim();
    const log = (msg: string) => sendLog(msg);
    const env = { ...process.env };
    const codexCmd = resolveCodexCommand(getCodexExecutable(), env, log);

    log(`[codex:exec] cmd="${codexCmd}" cwd="${cwd}" messageLen=${message.length}`);
    log(`[codex:exec] model=${codexModel}`);
    log(`[codex:exec] model_reasoning_effort=${reasoningEffort}`);

    return new Promise<{ ok: boolean; stdout?: string; stderr?: string; error?: string }>((resolve) => {
      const args = ['exec', '--full-auto', '--model', codexModel, '-c', `model_reasoning_effort=${reasoningEffort}`, '--cd', cwd, '-'];
      log(`[codex:exec] spawn: ${codexCmd} ${args.join(' ')} (prompt via stdin, len=${message.length})`);
      const proc = spawn(codexCmd, args, {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdin?.write(message, 'utf8');
      proc.stdin?.end();
      proc.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
        log(`[codex:stdout] ${String(chunk).slice(0, 200)}`);
      });
      proc.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
        log(`[codex:stderr] ${String(chunk).slice(0, 200)}`);
      });
      proc.on('error', (err) => {
        log(`[codex:exec] spawn error: ${err.message}`);
        resolve({ ok: false, error: err.message });
      });
      proc.on('close', (code, signal) => {
        const out = stdout.trim();
        const err = stderr.trim();
        log(`[codex:exec] close code=${code} signal=${signal || 'null'}`);
        if (signal) resolve({ ok: code === 0, error: `Exited with ${signal}`, stdout: out || undefined, stderr: err || undefined });
        else if (code !== 0 && !out) resolve({ ok: false, error: err || `Exit code ${code}`, stderr: err || undefined });
        else resolve({ ok: true, stdout: out || undefined, stderr: err || undefined });
      });
    });
  });

  ipcMain.handle('fs:readFile', async (_, { filePath, workspaceRoot }) => {
    const resolved = resolveWithinWorkspace(workspaceRoot, filePath);
    return fs.promises.readFile(resolved, 'utf-8').catch((e: Error) => ({ error: e.message }));
  });

  ipcMain.handle('fs:exists', async (_, { filePath, workspaceRoot }: { filePath: string; workspaceRoot: string }) => {
    try {
      await fs.promises.access(resolveWithinWorkspace(workspaceRoot, filePath));
      return { exists: true };
    } catch {
      return { exists: false };
    }
  });

  ipcMain.handle('fs:stat', async (_, { filePath, workspaceRoot }: { filePath: string; workspaceRoot: string }) => {
    try {
      const st = await fs.promises.stat(resolveWithinWorkspace(workspaceRoot, filePath));
      return { ok: true as const, mtimeMs: st.mtimeMs, isFile: st.isFile(), isDirectory: st.isDirectory() };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('fs:writeFile', async (_, { filePath, content, workspaceRoot }) => {
    const resolved = resolveWithinWorkspace(workspaceRoot, filePath);
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, content, 'utf-8');
    return { ok: true };
  });

  ipcMain.handle('fs:readDir', async (_, { dirPath, workspaceRoot }) => {
    const resolved = resolveWithinWorkspace(workspaceRoot, dirPath || '.');
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    return entries.map((d) => ({ name: d.name, isFile: d.isFile() }));
  });

  ipcMain.handle('fs:mkdir', async (_, { dirPath, workspaceRoot }) => {
    await fs.promises.mkdir(resolveWithinWorkspace(workspaceRoot, dirPath), { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('fs:unlink', async (_, { filePath, workspaceRoot }) => {
    await fs.promises.unlink(resolveWithinWorkspace(workspaceRoot, filePath));
    return { ok: true };
  });

  ipcMain.handle('fs:rename', async (_, { oldPath, newPath, workspaceRoot }) => {
    await fs.promises.rename(resolveWithinWorkspace(workspaceRoot, oldPath), resolveWithinWorkspace(workspaceRoot, newPath));
    return { ok: true };
  });

  ipcMain.handle('fs:rmdir', async (_, { dirPath, workspaceRoot }) => {
    await fs.promises.rmdir(resolveWithinWorkspace(workspaceRoot, dirPath));
    return { ok: true };
  });

  ipcMain.handle('fs:copyIntoWorkspace', async (_, { sourcePaths, destRelativePath, workspaceRoot }: { sourcePaths: string[]; destRelativePath?: string; workspaceRoot: string }) => {
    const destResolved = resolveWithinWorkspace(workspaceRoot, destRelativePath || '.');
    for (const src of sourcePaths) {
      const resolvedSrc = path.resolve(src);
      try {
        const stat = await fs.promises.stat(resolvedSrc);
        const destPath = path.join(destResolved, path.basename(resolvedSrc));
        if (stat.isDirectory()) await fs.promises.cp(resolvedSrc, destPath, { recursive: true });
        else {
          await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
          await fs.promises.copyFile(resolvedSrc, destPath);
        }
      } catch (e) {
        console.error('Copy failed:', resolvedSrc, e);
      }
    }
    return { ok: true };
  });

  ipcMain.handle('attachments:store', async (_, { sourcePaths, workspaceRoot }: { sourcePaths: string[]; workspaceRoot: string }) => {
    const root = path.resolve(workspaceRoot);
    const relative = path.join(root, '.visual-skill-builder/attachments');
    await fs.promises.mkdir(relative, { recursive: true });
    const result: { id: string; path: string; name: string; mimeType: string; size: number }[] = [];
    for (const src of sourcePaths) {
      const resolvedSrc = path.resolve(src);
      try {
        await fs.promises.access(resolvedSrc);
      } catch {
        continue;
      }
      const name = path.basename(resolvedSrc);
      const id = uuid();
      const dest = path.join(relative, id + path.extname(name));
      await fs.promises.copyFile(resolvedSrc, dest);
      const stat = await fs.promises.stat(dest);
      const relPath = path.join('.visual-skill-builder/attachments', id + path.extname(name));
      result.push({ id, path: relPath, name, mimeType: getMime(name), size: stat.size });
    }
    return result;
  });

  ipcMain.handle('attachments:dataUrl', async (_, { relativePath, workspaceRoot }: { relativePath: string; workspaceRoot: string }) => {
    const resolved = resolveWithinWorkspace(workspaceRoot, relativePath);
    const buf = await fs.promises.readFile(resolved);
    return `data:${getMime(path.basename(resolved))};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('patch:apply', async (_, { filePath, patchContent, workspaceRoot }) => {
    const resolved = resolveWithinWorkspace(workspaceRoot, filePath);
    const dmpModule = require('diff-match-patch');
    const DMP = dmpModule && (dmpModule.diff_match_patch || dmpModule.default || dmpModule);
    const patcher = typeof DMP === 'function' ? new DMP() : DMP;
    const current = await fs.promises.readFile(resolved, 'utf-8').catch(() => '');
    const patches = patcher.patch_fromText(patchContent);
    const [result] = patcher.patch_apply(patches, current);
    await fs.promises.writeFile(resolved, result, 'utf-8');
    return { ok: true };
  });
}

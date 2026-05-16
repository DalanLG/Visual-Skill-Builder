import { randomUUID } from 'crypto';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { loadConfig, getConfigPath, saveConfig } from './config';
import { registerSkillBuilderHandlers } from './skillBuilderHandlers';
import { registerSetupHandlers } from './setupHandlers';

let mainWindow: BrowserWindow | null = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const envContextByWindow = new Map<number, { environmentId: string; envName: string; rootPath: string }>();
const watchersByWindow = new Map<number, { close: () => void }>();
const skillsStudioBootstrapById = new Map<string, string>();

function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function appIndexPath(): string {
  return path.join(__dirname, '../dist/index.html');
}

function loadRoute(win: BrowserWindow, hash: string): void {
  if (isDev) void win.loadURL(`http://localhost:5173/${hash}`);
  else void win.loadFile(appIndexPath(), { hash });
}

function createLauncherWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 840,
    minHeight: 560,
    title: 'Visual Skill Builder',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRoute(mainWindow, '#/launcher');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function watchWorkspace(win: BrowserWindow, rootPath: string): void {
  void import('chokidar').then((chokidarModule) => {
    if (win.isDestroyed()) return;
    const watcher = chokidarModule.default.watch(rootPath, {
      persistent: true,
      ignoreInitial: true,
    });
    const send = () => {
      if (!win.isDestroyed()) win.webContents.send('workspace:changed');
    };
    watcher.on('add', send);
    watcher.on('change', send);
    watcher.on('unlink', send);
    watcher.on('addDir', send);
    watcher.on('unlinkDir', send);
    watchersByWindow.set(win.webContents.id, watcher);
  }).catch((err) => console.error('chokidar load failed', err));
}

function forgetWindow(win: BrowserWindow): void {
  const watcher = watchersByWindow.get(win.webContents.id);
  if (watcher) {
    watcher.close();
    watchersByWindow.delete(win.webContents.id);
  }
  envContextByWindow.delete(win.webContents.id);
}

function createEnvironmentWindow(environmentId: string, envName: string, rootPath: string): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: 'Visual Skill Builder',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  envContextByWindow.set(win.webContents.id, { environmentId, envName, rootPath });
  watchWorkspace(win, rootPath);
  win.on('closed', () => forgetWindow(win));
  loadRoute(win, `#/env/${encodeURIComponent(environmentId)}`);
}

app.whenReady().then(() => {
  registerSkillBuilderHandlers();
  registerSetupHandlers();

  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('get-config-path', () => getConfigPath());
  ipcMain.handle('save-config', (_e, config) => {
    saveConfig(config);
    return loadConfig();
  });
  ipcMain.handle('get-env-context', (e) => envContextByWindow.get(e.sender.id) ?? null);

  ipcMain.handle('dialog:showFolderPicker', async (e, options?: { defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'], defaultPath: options?.defaultPath };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });

  ipcMain.handle('dialog:showAddFiles', async (e, options?: { defaultPath?: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      defaultPath: options?.defaultPath,
    };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return { canceled, filePaths: filePaths || [] };
  });

  ipcMain.handle('dialog:showOpenFile', async (e, options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      defaultPath: options?.defaultPath,
      filters: options?.filters ?? [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });

  ipcMain.handle('dialog:showSaveFile', async (e, options?: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.SaveDialogOptions = {
      defaultPath: options?.defaultPath,
      filters: options?.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
    };
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    return canceled || !filePath ? null : filePath;
  });

  ipcMain.on('open-environment', (_e, { environmentId, name, rootPath }) => {
    createEnvironmentWindow(environmentId, name, rootPath);
  });

  ipcMain.on('close-launcher', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('skills-studio:open-window', async (e, graphJson: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (typeof graphJson !== 'string') return { ok: false, error: 'invalid-payload' };
    if (graphJson.length > 26_214_400) return { ok: false, error: 'payload-too-large' };
    const ctx = envContextByWindow.get(e.sender.id);
    if (!ctx) return { ok: false, error: 'no-env-context' };

    const bootstrapId = randomUUID();
    skillsStudioBootstrapById.set(bootstrapId, graphJson);

    const parent = BrowserWindow.fromWebContents(e.sender);
    const win = new BrowserWindow({
      width: 1500,
      height: 960,
      minWidth: 1100,
      minHeight: 760,
      title: 'Visual Skill Builder Studio',
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
      },
      ...(parent ? { parent } : {}),
    });

    envContextByWindow.set(win.webContents.id, ctx);
    watchWorkspace(win, ctx.rootPath);
    win.on('closed', () => {
      forgetWindow(win);
      skillsStudioBootstrapById.delete(bootstrapId);
    });

    loadRoute(win, `#/env/${encodeURIComponent(ctx.environmentId)}/skills-studio?bootstrap=${encodeURIComponent(bootstrapId)}`);
    return { ok: true };
  });

  ipcMain.handle('skills-studio:get-bootstrap', (_e, bootstrapId: unknown): string | null => {
    if (typeof bootstrapId !== 'string' || !bootstrapId.trim()) return null;
    return skillsStudioBootstrapById.get(bootstrapId) ?? null;
  });

  ipcMain.handle('skills-studio:close-window', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });

  createLauncherWindow();
});

app.on('window-all-closed', () => app.quit());

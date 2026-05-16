import { contextBridge, ipcRenderer } from 'electron';

const electron = require('electron') as { webUtils?: { getPathForFile: (file: File) => string } };
const webUtils = electron.webUtils;

let lastDroppedFiles: { paths: string[]; names: string[] } = { paths: [], names: [] };

document.addEventListener(
  'drop',
  (e: DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const paths: string[] = [];
    const names: string[] = [];
    const useWebUtils = typeof webUtils?.getPathForFile === 'function';
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const p = useWebUtils ? webUtils!.getPathForFile(file) : (file as File & { path?: string }).path;
        if (p) {
          paths.push(p);
          names.push(file.name);
        }
      } catch {
        // ignore per-file errors
      }
    }
    if (paths.length > 0) lastDroppedFiles = { paths, names };
  },
  true,
);

function getLastDroppedFiles(): { paths: string[]; names: string[] } {
  const out = lastDroppedFiles;
  lastDroppedFiles = { paths: [], names: [] };
  return out;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getLastDroppedFiles,
  getConfig: () => ipcRenderer.invoke('get-config'),
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),
  saveConfig: (config: unknown) => ipcRenderer.invoke('save-config', config),
  setupStatus: () => ipcRenderer.invoke('setup:status'),
  setupSetMode: (mode: 'automatic' | 'manual') => ipcRenderer.invoke('setup:set-mode', mode),
  setupInstallCodex: () => ipcRenderer.invoke('setup:installCodex'),
  setupLoginCodex: (payload?: { deviceCode?: boolean }) => ipcRenderer.invoke('setup:loginCodex', payload),
  setupVerifyCodex: () => ipcRenderer.invoke('setup:verifyCodex'),
  setupOpenExternal: (url: string) => ipcRenderer.invoke('setup:openExternal', url),
  onSetupLog: (cb: (payload: { message: string }) => void) => {
    const listener = (_: unknown, payload: { message: string }) => cb(payload);
    ipcRenderer.on('setup:log', listener);
    return () => ipcRenderer.removeListener('setup:log', listener);
  },
  showFolderPicker: (options?: { defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:showFolderPicker', options),
  showAddFilesPicker: (options?: { defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:showAddFiles', options),
  showOpenFilePicker: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:showOpenFile', options),
  showSaveFilePicker: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:showSaveFile', options),
  openEnvironment: (payload: { environmentId: string; name: string; rootPath: string }) =>
    ipcRenderer.send('open-environment', payload),
  closeLauncher: () => ipcRenderer.send('close-launcher'),
  getEnvContext: () => ipcRenderer.invoke('get-env-context'),
  onAppLog: (cb: (payload: { sessionId: string | null; message: string }) => void) => {
    const listener = (_: unknown, payload: { sessionId: string | null; message: string }) => cb(payload);
    ipcRenderer.on('app:log', listener);
    return () => ipcRenderer.removeListener('app:log', listener);
  },
  onWorkspaceChange: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
  onEnvContext: (cb: (payload: { environmentId: string; envName: string; rootPath: string }) => void) => {
    ipcRenderer.on('env-context', (_, p) => cb(p));
  },
  codexExec: (payload: {
    workspaceRoot: string;
    message: string;
    conversationHistory?: { role: string; content: string }[];
    sessionId?: string;
    useResume?: boolean;
    referencedFilePaths?: string[];
    model?: string;
    modelReasoningEffort?: string;
  }) => ipcRenderer.invoke('codex:exec', payload),
  fsReadFile: (payload: { filePath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:readFile', payload),
  fsExists: (payload: { filePath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:exists', payload),
  fsStat: (payload: { filePath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:stat', payload),
  fsWriteFile: (payload: { filePath: string; content: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:writeFile', payload),
  fsWriteAbsoluteFile: (payload: { filePath: string; content: string }) =>
    ipcRenderer.invoke('fs:writeAbsoluteFile', payload),
  fsReadDir: (payload: { dirPath?: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:readDir', payload),
  fsMkdir: (payload: { dirPath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:mkdir', payload),
  fsUnlink: (payload: { filePath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:unlink', payload),
  fsRename: (payload: { oldPath: string; newPath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:rename', payload),
  fsRmdir: (payload: { dirPath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:rmdir', payload),
  fsCopyIntoWorkspace: (payload: { sourcePaths: string[]; destRelativePath?: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('fs:copyIntoWorkspace', payload),
  patchApply: (payload: { filePath: string; patchContent: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('patch:apply', payload),
  attachmentsStore: (payload: { sourcePaths: string[]; workspaceRoot: string }) =>
    ipcRenderer.invoke('attachments:store', payload),
  attachmentsDataUrl: (payload: { relativePath: string; workspaceRoot: string }) =>
    ipcRenderer.invoke('attachments:dataUrl', payload),
  skillsStudioOpenWindow: (graphJson: string) =>
    ipcRenderer.invoke('skills-studio:open-window', graphJson),
  skillsStudioGetBootstrap: (bootstrapId: string) =>
    ipcRenderer.invoke('skills-studio:get-bootstrap', bootstrapId),
  skillsStudioCloseWindow: () => ipcRenderer.invoke('skills-studio:close-window'),
});

/// <reference types="vite/client" />

interface ElectronAPI {
  getConfig: () => Promise<VisualSkillBuilderConfig>;
  getConfigPath: () => Promise<string>;
  saveConfig: (config: VisualSkillBuilderConfig) => Promise<VisualSkillBuilderConfig>;
  showFolderPicker?: (options?: { defaultPath?: string }) => Promise<string | null>;
  showAddFilesPicker?: (options?: { defaultPath?: string }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  openEnvironment: (p: { environmentId: string; name: string; rootPath: string }) => void;
  closeLauncher: () => void;
  getEnvContext: () => Promise<{ environmentId: string; envName: string; rootPath: string } | null>;
  onAppLog: (cb: (payload: { sessionId: string | null; message: string }) => void) => (() => void) | void;
  onWorkspaceChange?: (cb: () => void) => () => void;
  onEnvContext: (cb: (p: { environmentId: string; envName: string; rootPath: string }) => void) => void;
  codexExec: (p: {
    workspaceRoot: string;
    message: string;
    conversationHistory?: { role: string; content: string }[];
    sessionId?: string;
    useResume?: boolean;
    referencedFilePaths?: string[];
    model?: string;
    modelReasoningEffort?: string;
  }) => Promise<{ ok: boolean; stdout?: string; stderr?: string; error?: string }>;
  fsReadFile: (p: { filePath: string; workspaceRoot: string }) => Promise<string | { error: string }>;
  fsExists: (p: { filePath: string; workspaceRoot: string }) => Promise<{ exists: boolean }>;
  fsStat: (
    p: { filePath: string; workspaceRoot: string },
  ) => Promise<
    | { ok: true; mtimeMs: number; isFile: boolean; isDirectory: boolean }
    | { ok: false; error: string }
  >;
  fsWriteFile: (p: { filePath: string; content: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  fsReadDir: (p: { dirPath?: string; workspaceRoot: string }) => Promise<{ name: string; isFile: boolean }[]>;
  fsMkdir: (p: { dirPath: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  fsUnlink: (p: { filePath: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  fsRename: (p: { oldPath: string; newPath: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  fsRmdir: (p: { dirPath: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  fsCopyIntoWorkspace?: (p: { sourcePaths: string[]; destRelativePath?: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  patchApply: (p: { filePath: string; patchContent: string; workspaceRoot: string }) => Promise<{ ok: boolean }>;
  attachmentsStore: (p: { sourcePaths: string[]; workspaceRoot: string }) => Promise<{ id: string; path: string; name: string; mimeType: string; size: number }[]>;
  attachmentsDataUrl: (p: { relativePath: string; workspaceRoot: string }) => Promise<string>;
  getLastDroppedFiles?: () => { paths: string[]; names: string[] };
  skillsStudioOpenWindow?: (graphJson: string) => Promise<{ ok: boolean; error?: string }>;
  skillsStudioGetBootstrap?: (bootstrapId: string) => Promise<string | null>;
  skillsStudioCloseWindow?: () => Promise<{ ok: boolean }>;
}

export interface VisualSkillBuilderConfig {
  environments: { id: string; name: string; rootPath: string }[];
  defaults: {
    codexExecutable: string;
    defaultWorkspacePath: string;
    loggingLevel: string;
    defaultCodexModel?: string;
    defaultCodexReasoningEffort?: string;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

import path from 'path';
import fs from 'fs';

export interface Environment {
  id: string;
  name: string;
  rootPath: string;
}

export interface ConfigDefaults {
  codexExecutable: string;
  defaultWorkspacePath: string;
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
  defaultCodexModel?: string;
  defaultCodexReasoningEffort?: string;
}

export interface CodexInterfaceConfig {
  environments: Environment[];
  defaults: ConfigDefaults;
  setupMode?: 'automatic' | 'manual';
  setupCompletedAt?: string;
  codexInstallDir?: string;
  codexVersion?: string;
  lastSetupStatus?: unknown;
}

const CONFIG_FILENAME = 'visual-skill-builder.config.json';

function getConfigRoot(): string {
  const envRoot = process.env.VISUAL_SKILL_BUILDER_ROOT;
  if (envRoot) return path.resolve(envRoot);
  if (process.env.NODE_ENV === 'development') return process.cwd();
  return path.join(process.resourcesPath || process.cwd(), '..');
}

export function getConfigPath(): string {
  return path.join(getConfigRoot(), CONFIG_FILENAME);
}

function defaultConfig(): CodexInterfaceConfig {
  return {
    environments: [],
    defaults: {
      codexExecutable: 'codex',
      defaultWorkspacePath: '',
      loggingLevel: 'info',
      defaultCodexModel: 'gpt-5.4',
      defaultCodexReasoningEffort: 'medium',
    },
  };
}

export function loadConfig(): CodexInterfaceConfig {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as CodexInterfaceConfig;
    const fallback = defaultConfig();
    if (!Array.isArray(config.environments)) config.environments = [];
    config.defaults = {
      ...fallback.defaults,
      ...(config.defaults ?? {}),
    };
    return config;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: CodexInterfaceConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { VisualSkillBuilderConfig } from '../vite-env.d';

function envIdFromPath(rootPath: string): string {
  return `workspace-${btoa(unescape(encodeURIComponent(rootPath))).replace(/[^a-zA-Z0-9]+/g, '').slice(0, 18) || 'default'}`;
}

export default function Launcher() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<VisualSkillBuilderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const c = window.electronAPI ? await window.electronAPI.getConfig() : null;
      const setup = await window.electronAPI?.setupStatus?.();
      if (setup && !setup.setupComplete) {
        navigate('/setup', { replace: true });
        return;
      }
      setConfig(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const envList = useMemo(() => {
    const configured = config?.environments ?? [];
    const defaultPath = config?.defaults?.defaultWorkspacePath?.trim();
    if (configured.length) return configured;
    return defaultPath ? [{ id: envIdFromPath(defaultPath), name: 'Selected skill workspace', rootPath: defaultPath }] : [];
  }, [config]);

  const openWorkspace = async (rootPath: string, name = 'Skill workspace') => {
    const clean = rootPath.trim();
    if (!clean) return;
    const next: VisualSkillBuilderConfig = {
      environments: [{ id: envIdFromPath(clean), name, rootPath: clean }],
      defaults: {
        codexExecutable: config?.defaults?.codexExecutable || 'codex',
        defaultWorkspacePath: clean,
        loggingLevel: config?.defaults?.loggingLevel || 'info',
        defaultCodexModel: config?.defaults?.defaultCodexModel || 'gpt-5.4',
        defaultCodexReasoningEffort: config?.defaults?.defaultCodexReasoningEffort || 'medium',
      },
      setupMode: config?.setupMode,
      setupCompletedAt: config?.setupCompletedAt,
      codexInstallDir: config?.codexInstallDir,
      codexVersion: config?.codexVersion,
      lastSetupStatus: config?.lastSetupStatus,
    };
    await window.electronAPI?.saveConfig(next);
    window.electronAPI?.openEnvironment({ environmentId: next.environments[0].id, name, rootPath: clean });
    window.electronAPI?.closeLauncher();
  };

  const chooseFolder = async () => {
    const picked = await window.electronAPI?.showFolderPicker?.({
      defaultPath: config?.defaults?.defaultWorkspacePath,
    });
    if (picked) await openWorkspace(picked, 'Skill workspace');
  };

  if (!window.electronAPI) {
    return (
      <div className="launcher-wrap">
        <div className="info-card animate-enter" style={{ width: 'min(720px, 100%)' }}>
          <h3>Electron API not available</h3>
          <p>Run this app through Electron with <span className="font-mono">npm run dev</span>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="launcher-wrap">
      <div className="launcher-shell">
        <section className="launcher-hero surface-blur">
          <h1 className="launcher-title">Visual Skill Builder</h1>
          <p className="launcher-text">
            Select a skills workspace, import or generate a skill graph, edit it visually, then save agent-ready Markdown.
          </p>

          <div className="work-actions" style={{ marginBottom: 18 }}>
            <button type="button" className="btn-primary" disabled={loading} onClick={() => void chooseFolder()}>
              Select skill folder
            </button>
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => void load()}>
              Refresh
            </button>
          </div>

          {error ? <div className="wb-warning" style={{ marginBottom: 12 }}>{error}</div> : null}

          <div className="env-list">
            {envList.length ? envList.map((env, idx) => (
              <button
                key={env.id}
                type="button"
                className="env-card"
                style={{ animationDelay: `${idx * 40}ms` }}
                onClick={() => void openWorkspace(env.rootPath, env.name)}
                aria-label={`Open ${env.name} at ${env.rootPath}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="env-card-title">{env.name}</div>
                    <div className="env-card-path">{env.rootPath}</div>
                  </div>
                  <span className="env-card-open">Open</span>
                </div>
              </button>
            )) : (
              <div className="info-card" style={{ padding: 12 }}>
                <h3 style={{ fontSize: 13 }}>No skill folder selected</h3>
                <p>Choose a folder where the demo can read and write skill files.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="launcher-side">
          <div className="info-card animate-enter" style={{ animationDelay: '80ms' }}>
            <h3>What gets saved?</h3>
            <p>The app saves each skill as graph JSON plus `SKILL.md` so another agent can use it.</p>
          </div>
          <div className="info-card animate-enter" style={{ animationDelay: '120ms' }}>
            <h3>Codex-powered</h3>
            <p>Markdown import, node regeneration, and final skill compilation use your local Codex CLI.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

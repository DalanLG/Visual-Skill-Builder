import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SetupActionResult, SetupCheck, SetupStatus, VisualSkillBuilderConfig } from '../vite-env.d';

function envIdFromPath(rootPath: string): string {
  return `workspace-${btoa(unescape(encodeURIComponent(rootPath))).replace(/[^a-zA-Z0-9]+/g, '').slice(0, 18) || 'default'}`;
}

function statusClass(status: SetupCheck['status']): string {
  return `setup-status setup-status--${status}`;
}

function statusText(status: SetupCheck['status']): string {
  if (status === 'ok') return 'Ready';
  if (status === 'missing') return 'Needed';
  if (status === 'error') return 'Fix';
  return 'Check';
}

function RequirementRow({ check }: { check: SetupCheck }) {
  return (
    <div className="setup-check-row">
      <div>
        <div className="setup-check-title">{check.label}</div>
        <div className="setup-check-detail">{check.detail || check.path || 'Waiting for setup.'}</div>
        {check.path ? <div className="setup-check-path">{check.path}</div> : null}
      </div>
      <span className={statusClass(check.status)}>{statusText(check.status)}</span>
    </div>
  );
}

function commandForInstall(status: SetupStatus | null): string {
  const dir = status?.appManagedCodexDir || '%APPDATA%\\Visual Skill Builder\\codex-cli';
  return `cmd.exe /d /s /c npm.cmd install --prefix "${dir}" @openai/codex@latest`;
}

function commandForLogin(status: SetupStatus | null): string {
  const codex = status?.codex.path || status?.appManagedCodexPath || 'codex.cmd';
  return `cmd.exe /d /s /c "${codex}" login`;
}

function commandForDeviceLogin(status: SetupStatus | null): string {
  const codex = status?.codex.path || status?.appManagedCodexPath || 'codex.cmd';
  return `cmd.exe /d /s /c "${codex}" login --device-auth`;
}

function commandForVerify(status: SetupStatus | null, workspace: string): string {
  const codex = status?.codex.path || status?.appManagedCodexPath || 'codex.cmd';
  const cwd = workspace || '%USERPROFILE%\\Documents\\Visual Skill Builder Skills';
  return `cmd.exe /d /s /c "echo Reply with exactly: visual-skill-builder-ready | ""${codex}"" exec --full-auto --skip-git-repo-check --cd ""${cwd}"" -"`;
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [config, setConfig] = useState<VisualSkillBuilderConfig | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const workspacePath = config?.defaults.defaultWorkspacePath?.trim() || config?.environments[0]?.rootPath || '';
  const manualMode = status?.setupMode === 'manual';

  const checks = useMemo(() => {
    if (!status) return [];
    return [status.node, status.npm, status.codex, status.auth, status.workspace, status.smokeTest];
  }, [status]);

  const load = async (opts?: { keepNotice?: boolean }) => {
    if (!opts?.keepNotice) {
      setError('');
      setMessage('');
    }
    try {
      const [nextStatus, nextConfig] = await Promise.all([
        window.electronAPI?.setupStatus?.(),
        window.electronAPI?.getConfig?.(),
      ]);
      if (nextStatus) setStatus(nextStatus);
      if (nextConfig) setConfig(nextConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    const off = window.electronAPI?.onSetupLog?.((payload) => {
      if (!payload.message.trim()) return;
      setLogs((prev) => [...prev.slice(-80), payload.message]);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  const runAction = async (label: string, action: () => Promise<SetupActionResult | SetupStatus | undefined>) => {
    if (busyStep) return;
    setBusyStep(label);
    setError('');
    setMessage('');
    try {
      const result = await action();
      let notice = '';
      if (result && 'ok' in result && !result.ok) {
        notice = result.error;
        setError(result.error);
      }
      if (result && 'ok' in result && result.ok) {
        notice =
          label === 'verify'
            ? 'Verification succeeded. The builder is ready.'
            : label === 'install'
              ? 'Codex installed/repaired. Press Verify to finish setup.'
              : 'Step completed.';
        setMessage(notice);
      }
      if (result && 'ok' in result && result.status) setStatus(result.status);
      await load({ keepNotice: true });
      if (result && 'ok' in result && !result.ok) setError(notice);
      if (result && 'ok' in result && result.ok) setMessage(notice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyStep(null);
    }
  };

  const setMode = async (mode: 'automatic' | 'manual') => {
    await runAction(mode === 'manual' ? 'manual' : 'automatic', () => window.electronAPI?.setupSetMode?.(mode));
  };

  const chooseWorkspace = async () => {
    const picked = await window.electronAPI?.showFolderPicker?.({ defaultPath: workspacePath });
    if (!picked || !config) return;
    const next: VisualSkillBuilderConfig = {
      ...config,
      environments: [{ id: envIdFromPath(picked), name: 'Skill workspace', rootPath: picked }],
      defaults: {
        ...config.defaults,
        defaultWorkspacePath: picked,
      },
    };
    await window.electronAPI?.saveConfig(next);
    setConfig(next);
    await load({ keepNotice: true });
  };

  const finish = () => {
    navigate('/launcher');
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
    <div className="launcher-wrap setup-wrap">
      <div className="setup-shell">
        <section className="launcher-hero setup-hero surface-blur">
          <div className="badge" style={{ marginBottom: 12 }}>first run</div>
          <h1 className="launcher-title">Set up Visual Skill Builder</h1>
          <p className="launcher-text">
            Install the local Codex helper, sign in with your OpenAI account, then choose where skills should be saved.
          </p>

          <div className="setup-mode-tabs" role="tablist" aria-label="Setup mode">
            <button
              type="button"
              className={!manualMode ? 'setup-tab setup-tab--active' : 'setup-tab'}
              disabled={Boolean(busyStep)}
              onClick={() => void setMode('automatic')}
            >
              Automatic
            </button>
            <button
              type="button"
              className={manualMode ? 'setup-tab setup-tab--active' : 'setup-tab'}
              disabled={Boolean(busyStep)}
              onClick={() => void setMode('manual')}
            >
              Manual
            </button>
          </div>

          {error ? <div className="wb-warning setup-error">{error}</div> : null}
          {message ? <div className="wb-warning setup-success">{message}</div> : null}

          <div className="setup-checks">
            {checks.length ? checks.map((check) => <RequirementRow key={check.label} check={check} />) : (
              <div className="setup-check-row">
                <div>
                  <div className="setup-check-title">Checking setup</div>
                  <div className="setup-check-detail">Reading local requirements.</div>
                </div>
                <span className="setup-status setup-status--unknown">Check</span>
              </div>
            )}
          </div>

          {!manualMode ? (
            <div className="setup-actions">
              <button type="button" className="btn-primary" disabled={Boolean(busyStep) || status?.npm.status !== 'ok'} onClick={() => void runAction('install', () => window.electronAPI?.setupInstallCodex?.())}>
                {busyStep === 'install' ? 'Repairing...' : 'Install / Repair Codex'}
              </button>
              <button type="button" className="btn-secondary" disabled={Boolean(busyStep) || status?.codex.status !== 'ok'} onClick={() => void runAction('login', () => window.electronAPI?.setupLoginCodex?.())}>
                {busyStep === 'login' ? 'Waiting for login...' : 'Sign in'}
              </button>
              <button type="button" className="btn-secondary" disabled={Boolean(busyStep) || status?.codex.status !== 'ok'} onClick={() => void runAction('device-login', () => window.electronAPI?.setupLoginCodex?.({ deviceCode: true }))}>
                Use code login
              </button>
              <button type="button" className="btn-secondary" disabled={Boolean(busyStep)} onClick={() => void chooseWorkspace()}>
                Choose skill folder
              </button>
              <button type="button" className="btn-primary" disabled={Boolean(busyStep) || status?.codex.status !== 'ok' || status?.workspace.status !== 'ok'} onClick={() => void runAction('verify', () => window.electronAPI?.setupVerifyCodex?.())}>
                {busyStep === 'verify' ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          ) : (
            <div className="manual-list">
              <div className="manual-step">
                <div className="manual-step-title">1. Install Codex into the app-managed folder</div>
                <pre>{commandForInstall(status)}</pre>
              </div>
              <div className="manual-step">
                <div className="manual-step-title">2. Sign in with browser or Google login</div>
                <pre>{commandForLogin(status)}</pre>
              </div>
              <div className="manual-step">
                <div className="manual-step-title">3. Use code login if browser callback is blocked</div>
                <pre>{commandForDeviceLogin(status)}</pre>
              </div>
              <div className="manual-step">
                <div className="manual-step-title">4. Verify Codex in the chosen skill folder</div>
                <pre>{commandForVerify(status, workspacePath)}</pre>
              </div>
              <div className="setup-actions">
                <button type="button" className="btn-primary" disabled={Boolean(busyStep) || status?.npm.status !== 'ok'} onClick={() => void runAction('install', () => window.electronAPI?.setupInstallCodex?.())}>
                  {busyStep === 'install' ? 'Repairing...' : 'Install / Repair Codex'}
                </button>
                <button type="button" className="btn-secondary" disabled={Boolean(busyStep)} onClick={() => void chooseWorkspace()}>
                  Choose skill folder
                </button>
                <button type="button" className="btn-secondary" disabled={Boolean(busyStep)} onClick={() => void runAction('refresh', () => window.electronAPI?.setupStatus?.())}>
                  Check again
                </button>
                <button type="button" className="btn-primary" disabled={Boolean(busyStep) || status?.codex.status !== 'ok' || status?.workspace.status !== 'ok'} onClick={() => void runAction('verify', () => window.electronAPI?.setupVerifyCodex?.())}>
                  Verify
                </button>
              </div>
            </div>
          )}

          <div className="setup-footer-actions">
            <button type="button" className="btn-secondary" disabled={Boolean(busyStep)} onClick={() => void load()}>
              Refresh status
            </button>
            <button type="button" className="btn-primary" disabled={!status?.setupComplete} onClick={finish}>
              Open builder
            </button>
          </div>
        </section>

        <aside className="launcher-side">
          <div className="info-card animate-enter">
            <h3>Sign in options</h3>
            <p>Codex owns authentication. The browser sign-in page supports Google login when your OpenAI account uses it.</p>
          </div>
          <div className="info-card animate-enter" style={{ animationDelay: '80ms' }}>
            <h3>Diagnostics</h3>
            {status?.diagnostics.length ? status.diagnostics.map((d) => <p key={d}>{d}</p>) : <p>No setup issues detected yet.</p>}
          </div>
          <div className="info-card animate-enter setup-log-card" style={{ animationDelay: '120ms' }}>
            <h3>Setup log</h3>
            <pre>{logs.length ? logs.join('\n') : 'No setup commands have run yet.'}</pre>
          </div>
        </aside>
      </div>
    </div>
  );
}

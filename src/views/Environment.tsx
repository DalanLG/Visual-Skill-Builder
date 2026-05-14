import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import SkillsSetupPanel from '../components/workbench/SkillsSetupPanel';

interface EnvContext {
  environmentId: string;
  envName: string;
  rootPath: string;
}

export default function Environment() {
  const { environmentId } = useParams<{ environmentId: string }>();
  const [context, setContext] = useState<EnvContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        const ctx = await window.electronAPI?.getEnvContext?.();
        if (!cancelled && ctx) setContext(ctx);
        else if (!cancelled && !ctx) setError('Could not load the selected skill workspace. Close and reopen from the launcher.');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  if (error) {
    return (
      <div className="shell">
        <div className="shell-content">
          <div className="info-card animate-enter">
            <h3>Workspace Error</h3>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!context || context.environmentId !== environmentId) {
    return (
      <div className="shell">
        <div className="shell-content">
          <div className="info-card animate-enter">
            <h3>Loading Skill Workspace</h3>
            <p>Resolving local folder context.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="env-root">
      <div className="env-toolbar">
        <div className="env-toolbar-left">
          <div className="env-title">Visual Skill Builder</div>
          <div className="shell-subtitle env-path" title={context.rootPath}>
            {context.rootPath}
          </div>
        </div>
      </div>

      <div className="env-body animate-enter">
        <div className="builder-shell">
          <div className="shell-header">
            <div>
              <div className="shell-title">Skills</div>
              <div className="shell-subtitle">Import, generate, edit, and export Codex skills.</div>
            </div>
            <span className="badge">demo</span>
          </div>
          <div className="builder-scroll">
            <section className="work-card">
              <SkillsSetupPanel workspaceRoot={context.rootPath} projectRules="" />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

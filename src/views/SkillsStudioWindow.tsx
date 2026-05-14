import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import SkillsSetupPanel from '../components/workbench/SkillsSetupPanel';

/**
 * Dedicated BrowserWindow route: loads graph via main-process bootstrap (pop-out from Setup → Skills).
 */
export default function SkillsStudioWindow() {
  const { environmentId } = useParams<{ environmentId: string }>();
  const [searchParams] = useSearchParams();
  const bootstrap = searchParams.get('bootstrap');
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await window.electronAPI?.getEnvContext?.();
      if (cancelled || !ctx) return;
      const wanted = environmentId ? decodeURIComponent(environmentId) : '';
      if (ctx.environmentId !== wanted) return;
      setWorkspaceRoot(ctx.rootPath);
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  if (!bootstrap) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>
        Missing studio session. Use &quot;Pop out window&quot; from Setup → Skills.
      </div>
    );
  }

  if (!workspaceRoot) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>
        Loading environment…
      </div>
    );
  }

  return (
    <div className="skills-studio-route-root">
      <SkillsSetupPanel
        workspaceRoot={workspaceRoot}
        projectRules=""
        variant="standalone"
        skillsStudioBootstrapId={bootstrap}
      />
    </div>
  );
}

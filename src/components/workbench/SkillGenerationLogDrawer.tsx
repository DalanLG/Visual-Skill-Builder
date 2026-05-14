export type SkillGenerationLogLevel = 'info' | 'warn' | 'error';

export interface SkillGenerationLogEntry {
  ts: number;
  phase: string;
  level: SkillGenerationLogLevel;
  message: string;
  nodeId?: string;
  jobId?: string;
}

export interface SkillGenerationLogDrawerProps {
  entries: SkillGenerationLogEntry[];
  onClear?: () => void;
  forceOpen?: boolean;
}

export default function SkillGenerationLogDrawer({ entries, onClear, forceOpen = false }: SkillGenerationLogDrawerProps) {
  return (
    <details className="skill-gen-log" open={forceOpen || (entries.length > 0 && entries[entries.length - 1]?.level === 'error')}>
      <summary>
        Generation log ({entries.length})
        {onClear ? (
          <button
            type="button"
            className="btn-secondary btn-compact"
            style={{ marginLeft: 8, fontSize: 10 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }}
          >
            Clear
          </button>
        ) : null}
      </summary>
      <div className="skill-gen-log__body">
        {entries.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No log entries yet.</div>
        ) : (
          entries.map((e, i) => (
            <div
              key={`${e.ts}-${i}`}
              className={`skill-gen-log__line${e.level === 'error' ? ' skill-gen-log__line--error' : ''}${e.level === 'warn' ? ' skill-gen-log__line--warn' : ''}`}
            >
              [{new Date(e.ts).toLocaleTimeString()}] {e.phase}: {e.message}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

import type { SkillLayoutColorKey } from '../../lib/skillFlowLayoutPlan';

export type SkillGroupDialogSubmit = {
  label: string;
  colorKey: SkillLayoutColorKey;
};

const PALETTE: { key: SkillLayoutColorKey; label: string }[] = [
  { key: 'neutral', label: 'Neutral' },
  { key: 'goal', label: 'Goal' },
  { key: 'research', label: 'Research' },
  { key: 'decision', label: 'Decision' },
  { key: 'generation', label: 'Generation' },
  { key: 'validation', label: 'Validation' },
  { key: 'output', label: 'Output' },
  { key: 'rules', label: 'Rules' },
  { key: 'tools', label: 'Tools' },
  { key: 'guardrails', label: 'Guardrails' },
];

export default function SkillGroupDialog({
  open,
  onClose,
  onSubmit,
  initialLabel = 'New group',
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: SkillGroupDialogSubmit) => void;
  initialLabel?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="skill-group-dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 12000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="skill-group-dialog input"
        style={{
          minWidth: 280,
          maxWidth: 420,
          padding: 16,
          borderRadius: 8,
          background: 'var(--bg-elevated, #1a1a1c)',
          border: '1px solid var(--border, #444)',
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const label = String(fd.get('label') ?? '').trim() || 'Group';
          const colorKey = (String(fd.get('colorKey') ?? 'neutral') || 'neutral') as SkillLayoutColorKey;
          onSubmit({ label, colorKey });
        }}
      >
        <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>Group selected nodes</h4>
        <label htmlFor="sg-label" style={{ fontSize: 12 }}>
          Name
        </label>
        <input id="sg-label" name="label" className="input" defaultValue={initialLabel} autoFocus style={{ marginBottom: 10 }} />
        <label htmlFor="sg-color" style={{ fontSize: 12 }}>
          Color
        </label>
        <select id="sg-color" name="colorKey" className="input" defaultValue="neutral" style={{ marginBottom: 14 }}>
          {PALETTE.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary btn-compact" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary btn-compact">
            Create group
          </button>
        </div>
      </form>
    </div>
  );
}

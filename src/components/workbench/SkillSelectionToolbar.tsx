export default function SkillSelectionToolbar({
  selectedCount,
  onGroup,
  onDelete,
}: {
  selectedCount: number;
  onGroup: () => void;
  onDelete: () => void;
}) {
  if (selectedCount < 2) return null;

  return (
    <div
      className="skill-selection-toolbar"
      style={{
        position: 'absolute',
        left: '50%',
        top: 10,
        transform: 'translateX(-50%)',
        zIndex: 5,
        display: 'flex',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        background: 'rgba(20,20,24,0.92)',
        border: '1px solid var(--border, #444)',
        alignItems: 'center',
        fontSize: 12,
        pointerEvents: 'auto',
      }}
    >
      <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{selectedCount} selected</span>
      <button type="button" className="btn-secondary btn-compact" onClick={onGroup}>
        Group…
      </button>
      <button type="button" className="btn-secondary btn-compact" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

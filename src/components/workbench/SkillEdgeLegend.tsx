/** Compact legend for semantic edge colors on the Skills graph canvas (matches `skillFlowRf` / `resolveEdgeVisual`). */
export default function SkillEdgeLegend({ compact = false }: { compact?: boolean }) {
  const items: Array<{ label: string; color: string; dashed?: boolean }> = [
    { label: 'Main flow', color: 'var(--skill-edge-main, var(--accent, #6ea8fe))' },
    {
      label: 'Source group tint',
      color: 'var(--skill-edge-group-tint, rgba(110, 168, 254, 0.85))',
    },
    { label: 'Depends on', color: 'var(--skill-edge-depends, #9aa8ff)', dashed: true },
    { label: 'Branch', color: 'var(--skill-edge-branch, #c9a227)', dashed: true },
    { label: 'Parallel', color: 'var(--skill-edge-parallel, #7bdc9c)', dashed: true },
    { label: 'Variable set', color: '#1f4f78', dashed: true },
    { label: 'Variable get', color: '#8fd3e8', dashed: false },
    { label: 'Response', color: '#a78bfa', dashed: false },
  ];

  return (
    <div
      className={`skill-edge-legend${compact ? ' skill-edge-legend--compact' : ''}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? '6px 10px' : '10px 14px',
        fontSize: compact ? 10 : 11,
        alignItems: 'center',
        color: 'var(--text-muted, #aaa)',
        marginTop: compact ? 2 : 4,
      }}
      aria-label="Edge color legend"
    >
      {items.map((i) => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 18,
              height: 3,
              backgroundColor: i.color,
              opacity: 0.95,
              borderRadius: 1,
              flexShrink: 0,
              ...(i.dashed
                ? {
                    backgroundImage: `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 8px)`,
                    backgroundColor: 'transparent',
                  }
                : {}),
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

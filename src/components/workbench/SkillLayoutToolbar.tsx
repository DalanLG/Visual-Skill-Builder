import SkillEdgeLegend from './SkillEdgeLegend';

export interface SkillLayoutToolbarProps {
  busy: boolean;
  /** Immersive studio: single-line controls row; legend still wraps below */
  density?: 'default' | 'compact';
  preserveManualPositions: boolean;
  onPreserveManualChange: (value: boolean) => void;
  onCleanLayout: () => void;
  onRepairLayout: () => void;
  onResetLayout: () => void;
  showVariables: boolean;
  onShowVariablesChange: (value: boolean) => void;
  inferArtifactsOnLayout: boolean;
  onInferArtifactsChange: (value: boolean) => void;
  showMiniMap?: boolean;
  onShowMiniMapChange?: (value: boolean) => void;
  trace?: {
    isPlaying: boolean;
    isActive: boolean;
    stepIndex: number;
    stepCount: number;
    speedMs: number;
    onPlayPause: () => void;
    onStepBack: () => void;
    onStepForward: () => void;
    onReset: () => void;
    onSpeedChange: (value: number) => void;
  };
}

export default function SkillLayoutToolbar({
  busy,
  density = 'default',
  preserveManualPositions,
  onPreserveManualChange,
  onCleanLayout,
  onRepairLayout,
  onResetLayout,
  showVariables,
  onShowVariablesChange,
  inferArtifactsOnLayout,
  onInferArtifactsChange,
  showMiniMap = false,
  onShowMiniMapChange,
  trace,
}: SkillLayoutToolbarProps) {
  const compact = density === 'compact';
  return (
    <div
      className={`skill-layout-toolbar-wrap${compact ? ' skill-layout-toolbar-wrap--compact' : ''}`}
      style={{ marginBottom: compact ? 0 : 8 }}
    >
      <div
        className="work-actions skill-layout-toolbar"
        style={{
          flexWrap: compact ? 'nowrap' : 'wrap',
          gap: compact ? 6 : 8,
          marginBottom: compact ? 2 : 4,
          overflowX: compact ? 'auto' : undefined,
        }}
      >
        <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void onCleanLayout()}>
          Clean layout
        </button>
        <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void onRepairLayout()}>
          Repair layout
        </button>
        <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void onResetLayout()}>
          Reset layout
        </button>
        <label
          style={{ fontSize: compact ? 11 : 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <input
            type="checkbox"
            checked={preserveManualPositions}
            onChange={(e) => onPreserveManualChange(e.target.checked)}
          />
          Preserve manual positions
        </label>
        <label
          style={{ fontSize: compact ? 11 : 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <input
            type="checkbox"
            checked={showVariables}
            onChange={(e) => onShowVariablesChange(e.target.checked)}
          />
          Show variables
        </label>
        <label
          style={{ fontSize: compact ? 11 : 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          title="Clean layout: merge heuristic variable-bus nodes for large depends_on fan-out"
        >
          <input
            type="checkbox"
            checked={inferArtifactsOnLayout}
            onChange={(e) => onInferArtifactsChange(e.target.checked)}
          />
          Infer variable buses (clean)
        </label>
        {onShowMiniMapChange ? (
          <label
            style={{ fontSize: compact ? 11 : 12, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
            title="Overview map adds cost while panning and zooming"
          >
            <input
              type="checkbox"
              checked={showMiniMap}
              onChange={(e) => onShowMiniMapChange(e.target.checked)}
            />
            Overview map
          </label>
        ) : null}
        {trace ? (
          <div className="skill-trace-toolbar" role="group" aria-label="Trace playback">
            <button type="button" className="btn-secondary btn-compact" onClick={trace.onPlayPause} disabled={!trace.stepCount}>
              {trace.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={trace.onStepBack} disabled={!trace.stepCount}>
              Step back
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={trace.onStepForward} disabled={!trace.stepCount}>
              Step forward
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={trace.onReset} disabled={!trace.stepCount}>
              Reset
            </button>
            <span className="badge">
              {trace.stepCount ? `${Math.min(trace.stepIndex + 1, trace.stepCount)}/${trace.stepCount}` : '0/0'}
            </span>
            <select
              className="input skill-trace-toolbar__speed"
              value={trace.speedMs}
              onChange={(e) => trace.onSpeedChange(Number(e.target.value))}
              aria-label="Trace speed"
            >
              <option value={1400}>1x</option>
              <option value={850}>1.5x</option>
              <option value={450}>3x</option>
            </select>
          </div>
        ) : null}
      </div>
      <SkillEdgeLegend compact={compact} />
    </div>
  );
}

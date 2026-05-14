import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { Node } from '@xyflow/react';
import type { SkillFlowGraphV2 } from '../../lib/skillFlowGraphV2';
import type { SkillTraceSnapshot } from '../../lib/skillFlowTrace';
import type { SkillValidationIssue, SkillValidationResult } from '../../lib/skillFlowValidation';
import SkillGenerationLogDrawer, { type SkillGenerationLogEntry } from './SkillGenerationLogDrawer';
import SkillLayoutToolbar from './SkillLayoutToolbar';
import SkillsFlowBoard from './SkillsFlowBoard';
import SkillNodeInspector from './SkillNodeInspector';
import type { FlowSelectionPayload, RadialCommitPayload } from './SkillsFlowBoard';

export type SkillsStudioPresentation = 'default' | 'immersive';

export type SkillsStudioChromeProps = {
  graph: SkillFlowGraphV2;
  /** Deferred / throttled graph for React Flow projection — inspector uses `graph` */
  canvasGraph: SkillFlowGraphV2;
  graphTitle?: string;
  validation: SkillValidationResult | null;
  busy: boolean;
  preserveManualPositions: boolean;
  onPreserveManualChange: (value: boolean) => void;
  onCleanLayout: () => void;
  onRepairLayout: () => void;
  onResetLayout: () => void;
  showVariables: boolean;
  onShowVariablesChange: (value: boolean) => void;
  inferArtifactsOnLayout: boolean;
  onInferArtifactsChange: (value: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'failed';
  selectedNodeId: string | null;
  selectedSkillNodeIds: string[];
  selectedUserGroupId: string | null;
  selectedEdgeId: string | null;
  onFlowSelectionChange: (payload: FlowSelectionPayload) => void;
  fitNonce: number;
  onNodeDragStart: (e: MouseEvent, node: Node) => void;
  onNodeDragStop: (e: MouseEvent, node: Node) => void;
  validationIssues: SkillValidationIssue[];
  onChangeGraph: (next: SkillFlowGraphV2) => void;
  onAppendConnected?: () => void;
  onDeleteInspectorNode?: (nodeId: string) => void;
  onRegenerateInspectorNode?: (nodeId: string) => void;
  selectionToolbar?: { selectedCount: number; onGroup: () => void; onDelete: () => void } | null;
  genLogs: SkillGenerationLogEntry[];
  onClearGenLogs: () => void;
  /** Extra controls beside the graph title (Expand studio, Pop out, …) */
  studioActions?: ReactNode;
  /** Full-bleed map + floating toolbar/inspector (expand studio + pop-out window) */
  presentation?: SkillsStudioPresentation;
  /** Save / Exit fullscreen / Close window — rendered in immersive floating toolbar */
  immersiveActions?: ReactNode;
  /** Radial menu commit from handle drag / context menu */
  onRadialMenuCommit?: (payload: RadialCommitPayload) => void | Promise<void>;
  onConnectNodes?: (sourceNodeId: string, targetNodeId: string) => void | Promise<void>;
  showMiniMap?: boolean;
  onShowMiniMapChange?: (value: boolean) => void;
  traceSnapshot?: SkillTraceSnapshot;
  traceControls?: {
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
};

function SaveStatusLine({
  saveStatus,
  className,
  style,
}: {
  saveStatus: SkillsStudioChromeProps['saveStatus'];
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={{ fontSize: 11, color: 'var(--text-muted)', ...style }}>
      Save:{' '}
      {saveStatus === 'saving'
        ? 'Saving…'
        : saveStatus === 'failed'
          ? 'Save failed'
          : saveStatus === 'saved'
            ? 'Saved'
            : '—'}
    </div>
  );
}

export default function SkillsStudioChrome({
  graph,
  canvasGraph,
  graphTitle,
  validation,
  busy,
  preserveManualPositions,
  onPreserveManualChange,
  onCleanLayout,
  onRepairLayout,
  onResetLayout,
  showVariables,
  onShowVariablesChange,
  inferArtifactsOnLayout,
  onInferArtifactsChange,
  saveStatus,
  selectedNodeId,
  selectedSkillNodeIds,
  selectedUserGroupId,
  selectedEdgeId,
  onFlowSelectionChange,
  fitNonce,
  onNodeDragStart,
  onNodeDragStop,
  validationIssues,
  onChangeGraph,
  onAppendConnected,
  onDeleteInspectorNode,
  onRegenerateInspectorNode,
  selectionToolbar,
  genLogs,
  onClearGenLogs,
  studioActions,
  presentation = 'default',
  immersiveActions,
  onRadialMenuCommit,
  onConnectNodes,
  showMiniMap = false,
  onShowMiniMapChange,
  traceSnapshot,
  traceControls,
}: SkillsStudioChromeProps) {
  const immersive = presentation === 'immersive';

  if (immersive) {
    return (
      <div className="skills-flow-shell-inner skills-flow-shell-inner--immersive">
        <div className="skills-studio-immersive">
          <div className="skills-studio-immersive__map">
            <div style={{ position: 'absolute', inset: 0 }}>
              <SkillsFlowBoard
                graph={canvasGraph}
                validation={validation}
                showVariables={showVariables}
                selectedSkillNodeIds={selectedSkillNodeIds}
                selectedEdgeId={selectedEdgeId}
                traceActiveNodeId={traceSnapshot?.activeNodeId ?? null}
                traceActiveEdgeId={traceSnapshot?.activeEdgeId ?? null}
                tracePulseEdgeIds={traceSnapshot?.pulseEdgeIds ?? []}
                fitNonce={fitNonce}
                onFlowSelectionChange={onFlowSelectionChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onRadialMenuCommit={onRadialMenuCommit}
                onConnectNodes={onConnectNodes}
                showMiniMap={showMiniMap}
                selectionToolbar={selectionToolbar}
              />
            </div>
          </div>
          <div className="skills-studio-immersive__toolbar" role="toolbar" aria-label="Skills studio controls">
            <div className="skills-studio-immersive__toolbar-inner">
              {graphTitle ? (
                <div className="skills-studio-immersive__title" title={graphTitle}>
                  {graphTitle}
                </div>
              ) : null}
              <SkillLayoutToolbar
                busy={busy}
                density="compact"
                preserveManualPositions={preserveManualPositions}
                onPreserveManualChange={onPreserveManualChange}
                onCleanLayout={onCleanLayout}
                onRepairLayout={onRepairLayout}
                onResetLayout={onResetLayout}
                showVariables={showVariables}
                onShowVariablesChange={onShowVariablesChange}
                inferArtifactsOnLayout={inferArtifactsOnLayout}
                onInferArtifactsChange={onInferArtifactsChange}
                showMiniMap={showMiniMap}
                onShowMiniMapChange={onShowMiniMapChange}
                trace={traceControls}
              />
              <div className="skills-studio-immersive__actions-row">
                <SaveStatusLine saveStatus={saveStatus} />
                {immersiveActions ? (
                  <div className="skills-studio-immersive__actions">{immersiveActions}</div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="skills-studio-float-inspector">
            <SkillNodeInspector
              graph={graph}
              selectedNodeId={selectedNodeId}
              selectedUserGroupId={selectedUserGroupId}
              selectedEdgeId={selectedEdgeId}
              validationIssues={validationIssues}
              onChangeGraph={onChangeGraph}
              onAppendConnected={onAppendConnected}
              onDeleteNode={onDeleteInspectorNode}
              onRegenerateNode={onRegenerateInspectorNode}
              generationLogs={genLogs}
              traceSnapshot={traceSnapshot}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="skills-flow-shell-inner">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {graphTitle ? (
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {graphTitle}
          </div>
        ) : null}
        {studioActions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{studioActions}</div> : null}
      </div>
      <SkillLayoutToolbar
        busy={busy}
        density="default"
        preserveManualPositions={preserveManualPositions}
        onPreserveManualChange={onPreserveManualChange}
        onCleanLayout={onCleanLayout}
        onRepairLayout={onRepairLayout}
        onResetLayout={onResetLayout}
        showVariables={showVariables}
        onShowVariablesChange={onShowVariablesChange}
        inferArtifactsOnLayout={inferArtifactsOnLayout}
        onInferArtifactsChange={onInferArtifactsChange}
        showMiniMap={showMiniMap}
        onShowMiniMapChange={onShowMiniMapChange}
        trace={traceControls}
      />
      <SaveStatusLine saveStatus={saveStatus} style={{ marginBottom: 6 }} />
      <div className="skills-flow-main">
        <SkillsFlowBoard
          graph={canvasGraph}
          validation={validation}
          showVariables={showVariables}
          selectedSkillNodeIds={selectedSkillNodeIds}
          selectedEdgeId={selectedEdgeId}
          traceActiveNodeId={traceSnapshot?.activeNodeId ?? null}
          traceActiveEdgeId={traceSnapshot?.activeEdgeId ?? null}
          tracePulseEdgeIds={traceSnapshot?.pulseEdgeIds ?? []}
          fitNonce={fitNonce}
          onFlowSelectionChange={onFlowSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onRadialMenuCommit={onRadialMenuCommit}
          onConnectNodes={onConnectNodes}
          showMiniMap={showMiniMap}
          selectionToolbar={selectionToolbar}
        />
        <SkillNodeInspector
          graph={graph}
          selectedNodeId={selectedNodeId}
          selectedUserGroupId={selectedUserGroupId}
          selectedEdgeId={selectedEdgeId}
          validationIssues={validationIssues}
          onChangeGraph={onChangeGraph}
          onAppendConnected={onAppendConnected}
          onDeleteNode={onDeleteInspectorNode}
          onRegenerateNode={onRegenerateInspectorNode}
          generationLogs={genLogs}
          traceSnapshot={traceSnapshot}
        />
      </div>
      <SkillGenerationLogDrawer entries={genLogs} onClear={onClearGenLogs} />
    </div>
  );
}

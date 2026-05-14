import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useOnSelectionChange,
  useReactFlow,
  SelectionMode,
  ConnectionMode,
  type Edge,
  type Node,
  type IsValidConnection,
  type OnConnect,
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './skill-flow.css';
import type { SkillFlowGraphV2, SkillNodeKind } from '../../lib/skillFlowGraphV2';
import type { SkillValidationIssue, SkillValidationResult } from '../../lib/skillFlowValidation';
import {
  skillGraphToReactFlow,
  SKILL_FLOW_RF_TYPE,
  SKILL_GROUP_RF_TYPE,
  SKILL_ARTIFACT_RF_TYPE,
  SKILL_ORTHOGONAL_EDGE_RF_TYPE,
  hitTestLayoutGroupAtFlowPoint,
} from '../../lib/skillFlowRf';
import { applySkillFlowRfSelectionPresentation } from '../../lib/skillFlowRfSelectionOverlay';
import SkillArtifactNode from './SkillArtifactNode';
import SkillFlowNode from './SkillFlowNode';
import SkillOrthogonalEdge from './SkillOrthogonalEdge';
import SkillGroupNode from './SkillGroupNode';
import SkillNodeKindRadialMenu from './SkillNodeKindRadialMenu';
import SkillSelectionToolbar from './SkillSelectionToolbar';

const EMPTY_ISSUES: SkillValidationIssue[] = [];
/** Stable empty list — hide edges while dragging so only nodes move (no per-frame edge layout). */
const NO_EDGES: Edge[] = [];
const RF_PRO_OPTIONS = { hideAttribution: true } as const;

export type FlowSelectionPayload = {
  skillNodeIds: string[];
  edgeIds: string[];
  selectedNodes: Node[];
};

export type RadialCommitPayload = {
  kind: SkillNodeKind;
  action?: 'get-variable' | 'set-variable' | 'default';
  flowX: number;
  flowY: number;
  /** Screen coords for anchoring the quick-prompt popover */
  screenX?: number;
  screenY?: number;
  sourceNodeId?: string | null;
  forcedGroupPlanId?: string | null;
  sourceEdgeId?: string | null;
  insertMode?: 'split-edge';
};

export type SkillsFlowBoardProps = {
  graph: SkillFlowGraphV2;
  validation: SkillValidationResult | null;
  showVariables: boolean;
  selectedSkillNodeIds: string[];
  selectedEdgeId: string | null;
  traceActiveNodeId?: string | null;
  traceActiveEdgeId?: string | null;
  tracePulseEdgeIds?: string[];
  fitNonce: number;
  onFlowSelectionChange: (payload: FlowSelectionPayload) => void;
  onNodeDragStart: (e: ReactMouseEvent, node: Node) => void;
  onNodeDragStop: (e: ReactMouseEvent, node: Node) => void;
  /** Handle drag-from-handle release + context-menu create-node flows */
  onRadialMenuCommit?: (payload: RadialCommitPayload) => void | Promise<void>;
  onConnectNodes?: (sourceNodeId: string, targetNodeId: string) => void | Promise<void>;
  /** MiniMap is costly during pan/zoom — default off; enable from toolbar */
  showMiniMap?: boolean;
  selectionToolbar?: { selectedCount: number; onGroup: () => void; onDelete: () => void } | null;
};

type RadialMenuState = {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  sourceNodeId?: string | null;
  forcedGroupPlanId?: string | null;
  sourceEdgeId?: string | null;
  insertMode?: 'split-edge';
};

function FlowSelectionBridge({ onFlow }: { onFlow: (payload: FlowSelectionPayload) => void }) {
  const onChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      const skillNodeIds = nodes.filter((n) => n.type === SKILL_FLOW_RF_TYPE).map((n) => n.id);
      const edgeIds = edges.map((e) => e.id);
      onFlow({ skillNodeIds, edgeIds, selectedNodes: nodes });
    },
    [onFlow],
  );
  useOnSelectionChange({ onChange });
  return null;
}

/**
 * Isolated React Flow subtree so `useNodesState` / drag does not re-render the full Skills Setup
 * panel (lists, Codex UI, inspector).
 *
 * While dragging, edges are not rendered (`NO_EDGES`): orthogonal routing + SVG updates are
 * deferred until drop, when the graph sync runs and lines are traced again from layout.
 */
function SkillsFlowBoardInner({
  graph,
  validation,
  showVariables,
  selectedSkillNodeIds,
  selectedEdgeId,
  traceActiveNodeId = null,
  traceActiveEdgeId = null,
  tracePulseEdgeIds = [],
  fitNonce,
  onFlowSelectionChange,
  onNodeDragStart,
  onNodeDragStop,
  onRadialMenuCommit,
  onConnectNodes,
  showMiniMap = false,
  selectionToolbar = null,
}: SkillsFlowBoardProps) {
  const rf = useReactFlow();
  const [rfDragging, setRfDragging] = useState(false);
  const [radialMenu, setRadialMenu] = useState<RadialMenuState | null>(null);
  const connectFromRef = useRef<string | null>(null);

  const geometryRf = useMemo(() => {
    const issues = validation?.issues ?? EMPTY_ISSUES;
    return skillGraphToReactFlow(graph, null, issues, {
      fadeNeighbors: false,
      showVariables,
      livePositions: undefined,
    });
  }, [graph, validation, showVariables]);

  const presentationRf = useMemo(
    () =>
      applySkillFlowRfSelectionPresentation(
        graph,
        geometryRf.nodes,
        geometryRf.edges,
        selectedSkillNodeIds,
        selectedEdgeId,
        {
          activeNodeId: traceActiveNodeId,
          activeEdgeId: traceActiveEdgeId,
          pulseEdgeIds: tracePulseEdgeIds,
        },
      ),
    [graph, geometryRf, selectedSkillNodeIds, selectedEdgeId, traceActiveNodeId, traceActiveEdgeId, tracePulseEdgeIds],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(presentationRf.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(presentationRf.edges);

  useEffect(() => {
    if (rfDragging) {
      return;
    }
    setNodes(presentationRf.nodes);
    setEdges(presentationRf.edges);
  }, [rfDragging, presentationRf.nodes, presentationRf.edges, setNodes, setEdges]);

  useEffect(() => {
    if (fitNonce === 0) return;
    const t = window.setTimeout(() => {
      try {
        rf.fitView({ padding: 0.18 });
      } catch {
        /* ignore */
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [fitNonce, rf]);

  const nodeTypes = useMemo(
    () => ({
      [SKILL_FLOW_RF_TYPE]: SkillFlowNode,
      [SKILL_GROUP_RF_TYPE]: SkillGroupNode,
      [SKILL_ARTIFACT_RF_TYPE]: SkillArtifactNode,
    }),
    [],
  );

  const edgeTypes = useMemo(
    () => ({
      [SKILL_ORTHOGONAL_EDGE_RF_TYPE]: SkillOrthogonalEdge,
    }),
    [],
  );

  const onPaneClick = useCallback(() => {
    onFlowSelectionChange({ skillNodeIds: [], edgeIds: [], selectedNodes: [] });
  }, [onFlowSelectionChange]);

  const handleNodeDragStart = useCallback(
    (e: ReactMouseEvent, node: Node) => {
      setRfDragging(true);
      onNodeDragStart(e, node);
    },
    [onNodeDragStart],
  );

  const handleNodeDragStop = useCallback(
    (e: ReactMouseEvent, node: Node) => {
      onNodeDragStop(e, node);
      setRfDragging(false);
    },
    [onNodeDragStop],
  );

  const graphNodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const source = connection.source;
      const target = connection.target;
      if (!source || !target || source === target) return false;
      if (!graphNodeIds.has(source) || !graphNodeIds.has(target)) return false;
      return !graph.edges.some((e) => e.source === source && e.target === target);
    },
    [graph.edges, graphNodeIds],
  );

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      if (!onConnectNodes || !connection.source || !connection.target) return;
      if (!isValidConnection(connection)) return;
      void onConnectNodes(connection.source, connection.target);
    },
    [isValidConnection, onConnectNodes],
  );

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    connectFromRef.current = params.nodeId ?? null;
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const fromNodeId =
        connectionState.fromNode?.id ?? connectFromRef.current ?? undefined;
      connectFromRef.current = null;

      if (!fromNodeId) return;
      if (connectionState.toNode?.id && onConnectNodes && graphNodeIds.has(connectionState.toNode.id)) {
        void onConnectNodes(fromNodeId, connectionState.toNode.id);
        return;
      }

      if (!onRadialMenuCommit) return;

      const clientX = 'clientX' in event ? event.clientX : (event as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
      const clientY = 'clientY' in event ? event.clientY : (event as TouchEvent).changedTouches?.[0]?.clientY ?? 0;
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const hit = hitTestLayoutGroupAtFlowPoint(graph, p.x, p.y);
      setRadialMenu({
        screenX: clientX,
        screenY: clientY,
        flowX: p.x,
        flowY: p.y,
        sourceNodeId: fromNodeId,
        forcedGroupPlanId: hit,
      });
    },
    [graph, graphNodeIds, onConnectNodes, onRadialMenuCommit, rf],
  );

  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      if (!onRadialMenuCommit) return;
      e.preventDefault();
      const clientX = 'clientX' in e ? e.clientX : 0;
      const clientY = 'clientY' in e ? e.clientY : 0;
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const hit = hitTestLayoutGroupAtFlowPoint(graph, p.x, p.y);
      setRadialMenu({
        screenX: clientX,
        screenY: clientY,
        flowX: p.x,
        flowY: p.y,
        sourceNodeId: undefined,
        forcedGroupPlanId: hit,
      });
    },
    [graph, onRadialMenuCommit, rf],
  );

  const onNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: Node) => {
      if (!onRadialMenuCommit) return;
      e.preventDefault();
      const clientX = e.clientX;
      const clientY = e.clientY;
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      if (node.type === SKILL_GROUP_RF_TYPE) {
        if (node.id.startsWith('rf-user-group-')) {
          e.preventDefault();
          return;
        }
        const planId = node.id.startsWith('rf-group-') ? node.id.slice('rf-group-'.length) : null;
        setRadialMenu({
          screenX: clientX,
          screenY: clientY,
          flowX: p.x,
          flowY: p.y,
          sourceNodeId: undefined,
          forcedGroupPlanId: planId ?? undefined,
        });
        return;
      }
      if (node.type === SKILL_FLOW_RF_TYPE) {
        const hit = hitTestLayoutGroupAtFlowPoint(graph, p.x, p.y);
        setRadialMenu({
          screenX: clientX,
          screenY: clientY,
          flowX: p.x,
          flowY: p.y,
          sourceNodeId: node.id,
          forcedGroupPlanId: hit,
        });
      }
    },
    [graph, onRadialMenuCommit, rf],
  );

  const onEdgeContextMenu = useCallback(
    (e: ReactMouseEvent, edge: Edge) => {
      if (!onRadialMenuCommit) return;
      e.preventDefault();
      const clientX = e.clientX;
      const clientY = e.clientY;
      onFlowSelectionChange({ skillNodeIds: [], edgeIds: [edge.id], selectedNodes: [] });
      const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const hit = hitTestLayoutGroupAtFlowPoint(graph, p.x, p.y);
      setRadialMenu({
        screenX: clientX,
        screenY: clientY,
        flowX: p.x,
        flowY: p.y,
        sourceNodeId: edge.source,
        sourceEdgeId: edge.id,
        insertMode: 'split-edge',
        forcedGroupPlanId: hit,
      });
    },
    [graph, onFlowSelectionChange, onRadialMenuCommit, rf],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (radialMenu) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const step = e.shiftKey ? 96 : 48;
      let dx = 0;
      let dy = 0;
      if (key === 'arrowleft' || key === 'a') dx = step;
      else if (key === 'arrowright' || key === 'd') dx = -step;
      else if (key === 'arrowup' || key === 'w') dy = step;
      else if (key === 'arrowdown' || key === 's') dy = -step;
      else return;
      e.preventDefault();
      const viewport = rf.getViewport();
      void rf.setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy }, { duration: 110 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [radialMenu, rf]);

  const handleRadialPick = useCallback(
    (kind: SkillNodeKind, action?: RadialCommitPayload['action']) => {
      if (!radialMenu || !onRadialMenuCommit) return;
      const payload: RadialCommitPayload = {
        kind,
        action,
        flowX: radialMenu.flowX,
        flowY: radialMenu.flowY,
        screenX: radialMenu.screenX,
        screenY: radialMenu.screenY,
        sourceNodeId: radialMenu.sourceNodeId,
        forcedGroupPlanId: radialMenu.forcedGroupPlanId,
        sourceEdgeId: radialMenu.sourceEdgeId,
        insertMode: radialMenu.insertMode,
      };
      setRadialMenu(null);
      void onRadialMenuCommit(payload);
    },
    [radialMenu, onRadialMenuCommit],
  );

  const edgesForView = rfDragging ? NO_EDGES : edges;

  return (
    <div className={`skill-flow-canvas${rfDragging ? ' skill-flow-canvas--dragging' : ''}`} style={{ position: 'relative' }}>
      {selectionToolbar && selectionToolbar.selectedCount >= 2 ? (
        <SkillSelectionToolbar
          selectedCount={selectionToolbar.selectedCount}
          onGroup={selectionToolbar.onGroup}
          onDelete={selectionToolbar.onDelete}
        />
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edgesForView}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onRadialMenuCommit ? onPaneContextMenu : undefined}
        onNodeContextMenu={onRadialMenuCommit ? onNodeContextMenu : undefined}
        onEdgeContextMenu={onRadialMenuCommit ? onEdgeContextMenu : undefined}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={onConnectNodes ? onConnect : undefined}
        onConnectStart={onRadialMenuCommit ? onConnectStart : undefined}
        onConnectEnd={onRadialMenuCommit ? onConnectEnd : undefined}
        isValidConnection={onConnectNodes || onRadialMenuCommit ? isValidConnection : undefined}
        connectionMode={ConnectionMode.Loose}
        elevateEdgesOnSelect={false}
        disableKeyboardA11y
        colorMode="dark"
        minZoom={0.15}
        maxZoom={1.6}
        onlyRenderVisibleElements
        proOptions={RF_PRO_OPTIONS}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panActivationKeyCode="Space"
      >
        <FlowSelectionBridge onFlow={onFlowSelectionChange} />
        <Background />
        <Controls />
        {showMiniMap ? <MiniMap /> : null}
      </ReactFlow>
      {radialMenu && onRadialMenuCommit ? (
        <SkillNodeKindRadialMenu
          screenX={radialMenu.screenX}
          screenY={radialMenu.screenY}
          onPick={handleRadialPick}
          onDismiss={() => setRadialMenu(null)}
        />
      ) : null}
    </div>
  );
}

export default memo(SkillsFlowBoardInner);

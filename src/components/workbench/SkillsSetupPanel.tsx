import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import './skill-flow.css';
import { stagingImportPath } from '../../lib/mdSkillTaskImport';
import { slugifyGraphName } from '../../lib/skillFlowGraph';
import { createConnectedSkillNode } from '../../lib/skillFlowBuilder';
import {
  applySkillLayoutPlan,
  isSemanticLayoutPlan,
} from '../../lib/skillFlowApplyLayoutPlan';
import { mergeInferredArtifactsIntoPlan } from '../../lib/skillFlowArtifactInference';
import { buildFastBoardSkillLayoutPlan, CURRENT_SKILL_BOARD_LAYOUT_VERSION } from '../../lib/skillFlowBoardLayout';
import { buildLayoutObstaclesFromGraph } from '../../lib/skillFlowLayoutRouting';
import { computeSkillLayoutQuality } from '../../lib/skillFlowLayoutQuality';
import { repairSkillGraphLayoutIfNeeded } from '../../lib/skillFlowLayoutRepair';
import { applyDagreLayout } from '../../lib/skillFlowLayout';
import { graphToSkillMarkdown } from '../../lib/skillFlowMarkdown';
import { canonicalizeSkillGraph } from '../../lib/skillFlowCanonical';
import { fallbackGraphFromMarkdownIr } from '../../lib/skillFlowMarkdownFallback';
import { parseSkillMarkdownToIr, skillMarkdownIrToPromptJson } from '../../lib/skillFlowMarkdownIr';
import { skillTraceSnapshot } from '../../lib/skillFlowTrace';
import {
  buildNearbyNodesForPrompt,
  buildSkillNodeExpansionPrompt,
  buildSkillNodeExpansionRepairPrompt,
} from '../../lib/skillFlowPromptsNodeExpansion';
import {
  applyGeneratedPatchToNode,
  parseGeneratedSkillNodePatchFromStdout,
} from '../../lib/skillFlowGeneratedNode';
import {
  buildSkillFlowGraphRepairPromptV2,
  buildSkillGraphToMarkdownCompilePromptV2,
  buildSkillMarkdownToGraphPromptV2,
  buildSkillPromptToGraphPromptV2,
  validateCompiledSkillMarkdown,
} from '../../lib/skillFlowPromptsV2';
import { SKILL_FLOW_RF_TYPE, SKILL_GROUP_RF_TYPE, SKILL_ARTIFACT_RF_TYPE } from '../../lib/skillFlowRf';
import { normalizeSkillFlowGraphAny, parseSkillFlowGraphAnyFromStdout, type SkillFlowGraphV2, type SkillNodeKind } from '../../lib/skillFlowGraphV2';
import { type SkillValidationIssue, validateSkillFlowGraphV2 } from '../../lib/skillFlowValidation';
import { validateSkillLayoutPlan } from '../../lib/skillFlowLayoutValidation';
import SkillGenerationLogDrawer, { type SkillGenerationLogEntry } from './SkillGenerationLogDrawer';
import SkillsStudioChrome from './SkillsStudioChrome';
import SkillNodeQuickPrompt from './SkillNodeQuickPrompt';
import SkillGroupDialog, { type SkillGroupDialogSubmit } from './SkillGroupDialog';
import type { FlowSelectionPayload, RadialCommitPayload } from './SkillsFlowBoard';
import {
  connectExistingSkillNodes,
  connectVariableRead,
  createGeneratingPlaceholderNode,
  createSkillNodeFromRadialPick,
  createUserSkillGroupInGraph,
  deleteSkillNodesFromGraph,
  insertSkillNodeOnEdge,
  markNodeGenerationFailed,
  prepareSkillNodeRegeneration,
} from '../../lib/skillFlowGraphMutations';

type PendingVariableRead = {
  sourceNodeId: string;
  flowX: number;
  flowY: number;
  screenX?: number;
  screenY?: number;
  forcedGroupPlanId?: string | null;
};

function trunc(s: string, max = 500): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function formatMtime(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

const EMPTY_ISSUES: SkillValidationIssue[] = [];
const CODEX_GRAPH_IMPORT_TIMEOUT_MS = 10 * 60_000;
const CODEX_GRAPH_IMPORT_REPAIR_TIMEOUT_MS = 4 * 60_000;
const CODEX_PROMPT_GRAPH_TIMEOUT_MS = 4 * 60_000;
const CODEX_PROMPT_GRAPH_REPAIR_TIMEOUT_MS = 2 * 60_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
  onProgress?: (elapsedMs: number, remainingMs: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
    const progressTimer = onProgress
      ? window.setInterval(() => {
          const elapsedMs = Date.now() - startedAt;
          onProgress(elapsedMs, Math.max(0, ms - elapsedMs));
        }, 30_000)
      : null;
    const clearTimers = () => {
      window.clearTimeout(timer);
      if (progressTimer) window.clearInterval(progressTimer);
    };
    promise.then(
      (value) => {
        clearTimers();
        resolve(value);
      },
      (error) => {
        clearTimers();
        reject(error);
      },
    );
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

interface SkillsSetupPanelProps {
  workspaceRoot: string;
  projectRules: string;
  onAudit?: (action: string, details: string, ok: boolean) => void;
  /** Pop-out window: hide import + skill list; load graph from main-process bootstrap */
  variant?: 'default' | 'standalone';
  skillsStudioBootstrapId?: string | null;
}

type SkillListEntry =
  | { kind: 'flat'; fileName: string; label: string }
  | { kind: 'nested'; slug: string; label: string };

type SkillListRow = SkillListEntry & {
  key: string;
  graphRelPath: string;
  mdRelPath?: string;
  statusLabel: 'graph+md' | 'graph-only' | 'md-only';
  mtimeLabel: string;
};

function SkillsSetupInner({
  workspaceRoot,
  projectRules,
  onAudit,
  variant = 'default',
  skillsStudioBootstrapId,
}: SkillsSetupPanelProps) {
  const [graph, setGraph] = useState<SkillFlowGraphV2 | null>(null);
  const graphRef = useRef<SkillFlowGraphV2 | null>(null);
  const [selectedSkillNodeIds, setSelectedSkillNodeIds] = useState<string[]>([]);
  const [selectedUserGroupId, setSelectedUserGroupId] = useState<string | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'outline' | 'json' | 'repair' | 'done' | 'error'>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [outlinePreview, setOutlinePreview] = useState('');
  const [stagedRelPath, setStagedRelPath] = useState<string | null>(null);
  const [pasteMd, setPasteMd] = useState('');
  const [skillPrompt, setSkillPrompt] = useState('');
  const [skillEntries, setSkillEntries] = useState<SkillListRow[]>([]);
  const [skillListExpanded, setSkillListExpanded] = useState(false);
  const [loadedSourceKey, setLoadedSourceKey] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [genLogs, setGenLogs] = useState<SkillGenerationLogEntry[]>([]);
  const [fitNonce, setFitNonce] = useState(0);
  const [preserveManualPositions, setPreserveManualPositions] = useState(true);
  const [showVariables, setShowVariables] = useState(true);
  const [inferArtifactsOnLayout, setInferArtifactsOnLayout] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [tracePlaying, setTracePlaying] = useState(false);
  const [traceModeActive, setTraceModeActive] = useState(false);
  const [traceStepIndex, setTraceStepIndex] = useState(0);
  const [traceSpeedMs, setTraceSpeedMs] = useState(850);
  const cancelledJobIdsRef = useRef<Set<string>>(new Set());
  const activeNodeJobsRef = useRef<Map<string, { nodeId: string; jobId: string }>>(new Map());
  const activeImportRef = useRef(false);
  const [addFlowPrompt, setAddFlowPrompt] = useState<RadialCommitPayload | null>(null);
  const [pendingVariableRead, setPendingVariableRead] = useState<PendingVariableRead | null>(null);
  const [variableSearch, setVariableSearch] = useState('');
  const groupDragRef = useRef<{
    nodeId: string;
    origin: { x: number; y: number };
    members: Map<string, { x: number; y: number }>;
  } | null>(null);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const autosaveTimerRef = useRef<number | null>(null);
  const refreshListTimerRef = useRef<number | null>(null);

  /** Expanded canvas: single SkillsStudioChrome mount — CSS moves shell to viewport-fixed layer */
  const [skillsStudioMode, setSkillsStudioMode] = useState<'inline' | 'maximized'>('inline');

  const appendLog = useCallback(
    (
      phaseName: string,
      message: string,
      level: SkillGenerationLogEntry['level'] = 'info',
      meta?: Pick<SkillGenerationLogEntry, 'nodeId' | 'jobId'>,
    ) => {
      setGenLogs((prev) => [...prev, { ts: Date.now(), phase: phaseName, level, message, ...meta }]);
    },
    [],
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppLog) return;
    return api.onAppLog((payload: { sessionId: string | null; message: string }) => {
      if (!payload.message.startsWith('[codex:exec]')) return;
      const jobs = Array.from(activeNodeJobsRef.current.values());
      if (!jobs.length && !activeImportRef.current) return;
      if (!jobs.length && activeImportRef.current) {
        appendLog('codex', payload.message, 'info');
        return;
      }
      for (const job of jobs) {
        appendLog('codex', payload.message, 'info', job);
      }
    });
  }, [appendLog]);

  const deferredGraph = useDeferredValue(graph);
  const validation = useMemo(() => (deferredGraph ? validateSkillFlowGraphV2(deferredGraph) : null), [deferredGraph]);
  const issueList = validation?.issues ?? EMPTY_ISSUES;
  const traceSnapshot = useMemo(
    () => (graph ? skillTraceSnapshot(graph, traceStepIndex) : undefined),
    [graph, traceStepIndex],
  );

  const selectedNodeId =
    selectedSkillNodeIds.length > 0 ? selectedSkillNodeIds[selectedSkillNodeIds.length - 1]! : null;

  const variableOptions = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((n) => n.kind === 'variable')
        .map((n) => ({
          id: n.id,
          label: n.variable?.label ?? n.label,
          variableName: n.variable?.variableName ?? n.label,
          summary: n.summary ?? n.variable?.description ?? '',
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [graph?.nodes],
  );
  const filteredVariableOptions = useMemo(() => {
    const q = variableSearch.trim().toLowerCase();
    if (!q) return variableOptions;
    return variableOptions.filter((v) =>
      `${v.label} ${v.variableName} ${v.summary}`.toLowerCase().includes(q),
    );
  }, [variableOptions, variableSearch]);

  const exitTraceMode = useCallback(() => {
    setTracePlaying(false);
    setTraceModeActive(false);
  }, []);

  const enterTraceMode = useCallback(() => {
    setTraceModeActive(true);
    setSelectedSkillNodeIds([]);
    setSelectedUserGroupId(null);
    setSelectedEdgeId(null);
  }, []);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    const count = traceSnapshot?.steps.length ?? 0;
    if (!count) {
      setTracePlaying(false);
      setTraceModeActive(false);
      setTraceStepIndex(0);
      return;
    }
    if (traceStepIndex >= count) setTraceStepIndex(count - 1);
  }, [traceSnapshot?.steps.length, traceStepIndex]);

  useEffect(() => {
    if (!tracePlaying) return;
    const count = traceSnapshot?.steps.length ?? 0;
    if (!count) {
      setTracePlaying(false);
      return;
    }
    const t = window.setTimeout(() => {
      setTraceStepIndex((i) => {
        if (i + 1 >= count) {
          setTracePlaying(false);
          return 0;
        }
        return i + 1;
      });
    }, traceSpeedMs);
    return () => window.clearTimeout(t);
  }, [tracePlaying, traceSpeedMs, traceSnapshot?.steps.length, traceStepIndex]);

  const HISTORY_CAP = 50;
  const pushUndoSnapshot = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    undoStackRef.current = [...undoStackRef.current.slice(-(HISTORY_CAP - 1)), JSON.stringify(g)];
    redoStackRef.current = [];
  }, []);

  const applyUndo = useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    exitTraceMode();
    const cur = graphRef.current;
    if (cur) redoStackRef.current.push(JSON.stringify(cur));
    try {
      const parsed = JSON.parse(snap) as SkillFlowGraphV2;
      setGraph(parsed);
      setSelectedSkillNodeIds([]);
      setSelectedEdgeId(null);
      setSelectedUserGroupId(null);
    } catch {
      /* ignore */
    }
  }, [exitTraceMode]);

  const applyRedo = useCallback(() => {
    const snap = redoStackRef.current.pop();
    if (!snap) return;
    exitTraceMode();
    const cur = graphRef.current;
    if (cur) undoStackRef.current.push(JSON.stringify(cur));
    try {
      const parsed = JSON.parse(snap) as SkillFlowGraphV2;
      setGraph(parsed);
      setSelectedSkillNodeIds([]);
      setSelectedEdgeId(null);
      setSelectedUserGroupId(null);
    } catch {
      /* ignore */
    }
  }, [exitTraceMode]);

  const onFlowSelectionChange = useCallback((payload: FlowSelectionPayload) => {
    const hasSelection = payload.skillNodeIds.length > 0 || payload.edgeIds.length > 0 || payload.selectedNodes.length > 0;
    if (hasSelection) exitTraceMode();
    const { skillNodeIds, edgeIds, selectedNodes } = payload;
    const ug = selectedNodes.find(
      (n) => n.type === SKILL_GROUP_RF_TYPE && typeof n.id === 'string' && n.id.startsWith('rf-user-group-'),
    );
    if (ug && typeof ug.id === 'string') {
      setSelectedUserGroupId(ug.id.slice('rf-user-group-'.length));
      setSelectedSkillNodeIds([]);
      setSelectedEdgeId(null);
      return;
    }
    setSelectedUserGroupId(null);
    setSelectedSkillNodeIds(skillNodeIds);
    if (skillNodeIds.length) {
      setSelectedEdgeId(null);
    } else {
      setSelectedEdgeId(edgeIds[0] ?? null);
    }
  }, [exitTraceMode]);

  useEffect(() => {
    if (variant !== 'standalone' || !skillsStudioBootstrapId) return;
    const api = window.electronAPI;
    const getBootstrap = api?.skillsStudioGetBootstrap;
    if (!getBootstrap) {
      setErr('Studio bootstrap API unavailable.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const raw = await getBootstrap(skillsStudioBootstrapId);
        if (cancelled) return;
        if (!raw) {
          setErr('Studio session missing or expired.');
          return;
        }
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          setErr('Invalid studio payload.');
          return;
        }
        const parsed = normalizeSkillFlowGraphAny(parsedJson);
        if (!parsed) {
          setErr('Could not parse skill graph from studio session.');
          return;
        }
        const loaded = canonicalizeSkillGraph(parsed);
        const preserve = loaded.layout?.preserveManualPositions ?? true;
        setPreserveManualPositions(preserve);
        const repaired = repairSkillGraphLayoutIfNeeded(loaded);
        let next: SkillFlowGraphV2;
        if (repaired.changed) {
          next = repaired.graph;
        } else if (
          loaded.layout?.strategy === 'fast-board' &&
          loaded.layout.layoutAlgorithmVersion === CURRENT_SKILL_BOARD_LAYOUT_VERSION
        ) {
          next = loaded;
        } else {
          try {
            const plan = buildFastBoardSkillLayoutPlan(loaded);
            next = await applySkillLayoutPlan(loaded, plan, {
              preserveManualPositions: preserve,
              strategy: 'fast-board',
            });
          } catch {
            next = applyDagreLayout(loaded, { respectManual: preserve });
          }
        }
        setGraph(next);
        setLoadedSourceKey(null);
        setErr('');
        setPhase('done');
        setSelectedSkillNodeIds([]);
        setSelectedUserGroupId(null);
        setSelectedEdgeId(null);
        setFitNonce((n) => n + 1);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant, skillsStudioBootstrapId]);

  const runCodexSkillImport = useCallback(
    async (
      prompt: string,
      referencedFilePaths?: string[],
      options?: { model?: string; modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' },
    ) => {
      const api = window.electronAPI;
      const rulesSnippet =
        projectRules.length > 4000 ? `${projectRules.slice(0, 4000)}\n…` : projectRules;
      const finalPrompt = [rulesSnippet ? `[Project Rules]\n${rulesSnippet}` : '', prompt].filter(Boolean).join('\n\n');
      if (!api?.codexExec) return { ok: false as const, error: 'Codex API unavailable', stdout: '', stderr: '' };
      const cfg = await api.getConfig();
      const m = (options?.model ?? cfg.defaults.defaultCodexModel ?? '').trim();
      const er = (cfg.defaults.defaultCodexReasoningEffort || 'medium').trim().toLowerCase();
      const modelReasoningEffort =
        options?.modelReasoningEffort ??
        (er === 'minimal' || er === 'low' || er === 'medium' || er === 'high' || er === 'xhigh' ? er : 'medium');
      return api.codexExec({
        workspaceRoot,
        message: finalPrompt,
        ...(referencedFilePaths?.length ? { referencedFilePaths } : {}),
        ...(m ? { model: m } : {}),
        modelReasoningEffort,
      });
    },
    [workspaceRoot, projectRules],
  );

  const runCodexNodeExpansion = useCallback(
    async (prompt: string) => {
      const api = window.electronAPI;
      const rulesSnippet =
        projectRules.length > 4000 ? `${projectRules.slice(0, 4000)}\n…` : projectRules;
      const finalPrompt = [rulesSnippet ? `[Project Rules]\n${rulesSnippet}` : '', prompt].filter(Boolean).join('\n\n');
      if (!api?.codexExec) return { ok: false as const, error: 'Codex API unavailable', stdout: '', stderr: '' };
      return api.codexExec({
        workspaceRoot,
        message: finalPrompt,
        model: 'gpt-5.4-mini',
        modelReasoningEffort: 'low',
      });
    },
    [workspaceRoot, projectRules],
  );

  const refreshSkillFileList = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.fsExists || !api.fsReadDir) return;
    const exists = await api.fsExists({ filePath: '.codex/skills', workspaceRoot });
    if (!exists.exists) {
      setSkillEntries([]);
      return;
    }
    const entries = await api.fsReadDir({ dirPath: '.codex/skills', workspaceRoot });
    const list: SkillListRow[] = [];
    for (const e of entries) {
      if (e.isFile && e.name.endsWith('.json')) {
        const graphRelPath = `.codex/skills/${e.name}`;
        const base = e.name.replace(/\.json$/i, '');
        const mdRelPath = `.codex/skills/${base}.md`;
        const graphEx = await api.fsExists({ filePath: graphRelPath, workspaceRoot });
        const mdEx = await api.fsExists({ filePath: mdRelPath, workspaceRoot });
        let statusLabel: SkillListRow['statusLabel'];
        if (graphEx.exists && mdEx.exists) statusLabel = 'graph+md';
        else if (graphEx.exists) statusLabel = 'graph-only';
        else statusLabel = 'md-only';
        let mtimeLabel = '';
        if (api.fsStat && graphEx.exists) {
          const st = await api.fsStat({ filePath: graphRelPath, workspaceRoot });
          if (st.ok) mtimeLabel = formatMtime(st.mtimeMs);
        }
        list.push({
          kind: 'flat',
          fileName: e.name,
          label: e.name,
          key: `flat:${e.name}`,
          graphRelPath,
          mdRelPath: mdEx.exists ? mdRelPath : undefined,
          statusLabel,
          mtimeLabel,
        });
      } else if (!e.isFile) {
        const nestedGraph = `.codex/skills/${e.name}/skill.graph.json`;
        const nestedOfficialMd = `.codex/skills/${e.name}/SKILL.md`;
        const nestedLegacyMd = `.codex/skills/${e.name}/skill.md`;
        const ex = await api.fsExists({ filePath: nestedGraph, workspaceRoot });
        if (ex.exists) {
          const officialMdEx = await api.fsExists({ filePath: nestedOfficialMd, workspaceRoot });
          const legacyMdEx = await api.fsExists({ filePath: nestedLegacyMd, workspaceRoot });
          const mdRelPath = officialMdEx.exists ? nestedOfficialMd : legacyMdEx.exists ? nestedLegacyMd : undefined;
          let statusLabel: SkillListRow['statusLabel'];
          if (mdRelPath) statusLabel = 'graph+md';
          else statusLabel = 'graph-only';
          let mtimeLabel = '';
          if (api.fsStat) {
            const st = await api.fsStat({ filePath: nestedGraph, workspaceRoot });
            if (st.ok) mtimeLabel = formatMtime(st.mtimeMs);
          }
          list.push({
            kind: 'nested',
            slug: e.name,
            label: `${e.name}/`,
            key: `nested:${e.name}`,
            graphRelPath: nestedGraph,
            mdRelPath,
            statusLabel,
            mtimeLabel,
          });
        }
      }
    }
    list.sort((a, b) => a.label.localeCompare(b.label));
    setSkillEntries(list);
  }, [workspaceRoot]);

  useEffect(() => {
    void refreshSkillFileList();
  }, [refreshSkillFileList]);

  useEffect(() => {
    if (skillsStudioMode !== 'maximized') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [skillsStudioMode]);

  useEffect(() => {
    if (skillsStudioMode !== 'maximized') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setSkillsStudioMode('inline');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [skillsStudioMode]);

  useEffect(() => {
    const unsub = window.electronAPI?.onAppLog?.((payload) => {
      const msg = payload?.message?.trim();
      if (!msg || !/codex/i.test(msg)) return;
      appendLog('app', msg, 'info');
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [appendLog]);

  const stageMarkdownToWorkspace = useCallback(
    async (content: string): Promise<string | null> => {
      const api = window.electronAPI;
      if (!api?.fsWriteFile) return null;
      const rel = stagingImportPath('skill');
      await api.fsWriteFile({ filePath: rel, content, workspaceRoot });
      return rel;
    },
    [workspaceRoot],
  );

  const pickMdFile = useCallback(async (): Promise<string | null> => {
    const api = window.electronAPI;
    if (!api?.showAddFilesPicker || !api.fsCopyIntoWorkspace || !api.fsMkdir) return null;
    const { canceled, filePaths } = await api.showAddFilesPicker({ defaultPath: workspaceRoot });
    if (canceled || !filePaths.length) return null;
    const destDir = '.visual-skill-builder/imports';
    await api.fsMkdir({ dirPath: destDir, workspaceRoot });
    await api.fsCopyIntoWorkspace({ sourcePaths: [filePaths[0]], destRelativePath: destDir, workspaceRoot });
    const base = filePaths[0].replace(/\\/g, '/').split('/').pop() || 'import.md';
    const rel = `${destDir}/${base}`;
    const exists = await api.fsExists({ filePath: rel, workspaceRoot });
    return exists.exists ? rel : null;
  }, [workspaceRoot]);

  const finalizeImportedGraph = useCallback(async (g: SkillFlowGraphV2): Promise<SkillFlowGraphV2> => {
    const canonical = canonicalizeSkillGraph(g);
    try {
      let plan = buildFastBoardSkillLayoutPlan(canonical);
      plan = mergeInferredArtifactsIntoPlan(plan, canonical);
      const next = await applySkillLayoutPlan(canonical, plan, {
        preserveManualPositions: false,
        strategy: 'fast-board',
      });
      setGraph(next);
      setSelectedSkillNodeIds([]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(null);
      setFitNonce((n) => n + 1);
      setLoadedSourceKey(null);
      return next;
    } catch {
      const laid = applyDagreLayout(canonical, { respectManual: false });
      setGraph(laid);
      setSelectedSkillNodeIds([]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(null);
      setFitNonce((n) => n + 1);
      setLoadedSourceKey(null);
      return laid;
    }
  }, []);

  const runCleanLayout = useCallback(async () => {
    if (!graph) return;
    exitTraceMode();
    pushUndoSnapshot();
    appendLog('layout', 'Running deterministic fast-board layout…', 'info');
    try {
      let plan = buildFastBoardSkillLayoutPlan(graph);
      if (inferArtifactsOnLayout) {
        plan = mergeInferredArtifactsIntoPlan(plan, graph);
      }
      const val = validateSkillLayoutPlan(plan, graph);
      if (!val.ok) {
        appendLog(
          'layout',
          `Layout plan validation: ${val.issues.filter((i) => i.severity === 'error').length} error(s)`,
          'warn',
        );
      }
      const next = await applySkillLayoutPlan(graph, plan, {
        preserveManualPositions: preserveManualPositions,
        strategy: 'fast-board',
      });
      const qObs = buildLayoutObstaclesFromGraph(next.nodes, [], []);
      const qPlan =
        next.layout?.layoutPlan && isSemanticLayoutPlan(next.layout.layoutPlan)
          ? next.layout.layoutPlan
          : undefined;
      const q = computeSkillLayoutQuality(next, qPlan, qObs);
      setGraph(next);
      setFitNonce((n) => n + 1);
      appendLog(
        'layout',
        `Clean layout applied (quality ${q.score}${q.longStringDetected ? '; long-line band detected' : ''}).`,
        'info',
      );
    } catch (e) {
      appendLog('layout', e instanceof Error ? e.message : String(e), 'error');
    }
  }, [graph, preserveManualPositions, inferArtifactsOnLayout, appendLog, pushUndoSnapshot, exitTraceMode]);

  const runRepairLayout = useCallback(() => {
    if (!graph) return;
    exitTraceMode();
    appendLog('layout', 'Repairing layout metadata…', 'info');
    const { graph: next, changed, reasons } = repairSkillGraphLayoutIfNeeded(graph);
    if (!changed) {
      appendLog('layout', 'Repair skipped (layout already current).', 'info');
      return;
    }
    pushUndoSnapshot();
    setGraph(next);
    setFitNonce((n) => n + 1);
    appendLog('layout', `Repair applied: ${reasons.join('; ')}`, 'info');
  }, [graph, appendLog, pushUndoSnapshot, exitTraceMode]);

  const runResetLayout = useCallback(async () => {
    if (!graph) return;
    exitTraceMode();
    pushUndoSnapshot();
    appendLog('layout', 'Reset layout (clear manual positions + fast-board)…', 'info');
    try {
      const cleared: SkillFlowGraphV2 = {
        ...graph,
        nodes: graph.nodes.map((n) => ({
          ...n,
          ui: { ...n.ui, manuallyPositioned: false },
        })),
      };
      let plan = buildFastBoardSkillLayoutPlan(cleared);
      plan = mergeInferredArtifactsIntoPlan(plan, cleared);
      const next = await applySkillLayoutPlan(cleared, plan, {
        preserveManualPositions: false,
        strategy: 'fast-board',
      });
      setGraph(next);
      setFitNonce((n) => n + 1);
    } catch (e) {
      appendLog('layout', e instanceof Error ? e.message : String(e), 'error');
    }
  }, [graph, appendLog, pushUndoSnapshot, exitTraceMode]);

  const runImportFromPath = useCallback(
    async (rel: string) => {
      const api = window.electronAPI;
      setErr('');
      setBusy(true);
      setPhase('json');
      activeImportRef.current = true;
      appendLog('json', 'Starting canonical graph import (V2 prompt)...', 'info');
      try {
        if (!api?.fsReadFile) throw new Error('Filesystem read API unavailable.');
        appendLog('read', `Reading Markdown file: ${rel}`, 'info');
        const raw = await api.fsReadFile({ filePath: rel, workspaceRoot });
        if (typeof raw !== 'string' || !raw.trim()) throw new Error('Markdown file is empty or unreadable.');
        appendLog('read', `Markdown loaded (${raw.length.toLocaleString()} characters).`, 'info');
        const parsedMarkdownIr = parseSkillMarkdownToIr(raw);
        const markdownIr = skillMarkdownIrToPromptJson(parsedMarkdownIr);
        setOutlinePreview(markdownIr);
        appendLog('parse', `Markdown IR ready (${markdownIr.length.toLocaleString()} characters).`, 'info');
        appendLog('json', 'Requesting graph JSON (V2)…', 'info');
        appendLog(
          'codex',
          `Calling Codex for canonical graph JSON (model gpt-5.4, medium reasoning). Large Markdown imports can take up to ${Math.round(
            CODEX_GRAPH_IMPORT_TIMEOUT_MS / 60_000,
          )} minutes.`,
          'info',
        );
        const r2 = await withTimeout(
          runCodexSkillImport(
            buildSkillMarkdownToGraphPromptV2({ markdownIr, sourcePath: rel }),
            undefined,
            { model: 'gpt-5.4', modelReasoningEffort: 'medium' },
          ),
          CODEX_GRAPH_IMPORT_TIMEOUT_MS,
          'Codex graph import timed out before returning JSON.',
          (elapsedMs, remainingMs) => {
            appendLog(
              'codex',
              `Still waiting for Codex graph JSON (${formatDuration(elapsedMs)} elapsed, ${formatDuration(remainingMs)} before fallback).`,
              'info',
            );
          },
        );
        if (!r2.ok) throw new Error(r2.error || 'JSON step failed');
        appendLog('codex', `Codex graph response received (${(r2.stdout || '').length.toLocaleString()} stdout chars).`, 'info');
        if (r2.stderr?.trim()) appendLog('json', `stderr: ${trunc(r2.stderr)}`, 'warn');

        appendLog('parse', 'Parsing graph JSON from Codex response.', 'info');
        let parsed = parseSkillFlowGraphAnyFromStdout(r2.stdout || r2.stderr || '');
        if ('error' in parsed) {
          setPhase('repair');
          appendLog('repair', `Parse failed (${parsed.error}). Running repair pass…`, 'warn');
          const r3 = await withTimeout(
            runCodexSkillImport(
              buildSkillFlowGraphRepairPromptV2(r2.stdout || r2.stderr || '', [parsed.error]),
              undefined,
              { model: 'gpt-5.4', modelReasoningEffort: 'medium' },
            ),
            CODEX_GRAPH_IMPORT_REPAIR_TIMEOUT_MS,
            'Codex graph repair timed out before returning JSON.',
            (elapsedMs, remainingMs) => {
              appendLog(
                'repair',
                `Still waiting for Codex repair JSON (${formatDuration(elapsedMs)} elapsed, ${formatDuration(remainingMs)} before fallback).`,
                'info',
              );
            },
          );
          if (!r3.ok) throw new Error(r3.error || 'Repair step failed');
          appendLog('repair', `Repair response received (${(r3.stdout || '').length.toLocaleString()} stdout chars).`, 'info');
          if (r3.stderr?.trim()) appendLog('repair', `stderr: ${trunc(r3.stderr)}`, 'warn');
          parsed = parseSkillFlowGraphAnyFromStdout(r3.stdout || r3.stderr || '');
        }

        if ('error' in parsed) throw new Error(parsed.error);
        appendLog(
          'graph',
          `Graph parsed: ${parsed.graph.nodes.length} nodes, ${parsed.graph.edges.length} edges. Applying canonical layout.`,
          'info',
        );

        const importedGraph = await finalizeImportedGraph({
          ...parsed.graph,
          sourceType: 'markdown',
          markdown: {
            ...(parsed.graph.markdown ?? {}),
            original: raw,
            lastRoundTripAt: new Date().toISOString(),
          },
        });
        appendLog('save', 'Saving imported graph so it appears in Saved skills.', 'info');
        await writeGraphToDisk(importedGraph, { compileMarkdown: false });
        await refreshSkillFileList();
        appendLog('done', `Import finished: ${parsed.graph.name}`, 'info');
        setPhase('done');
        onAudit?.('skills:graph-import', parsed.graph.name, true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        appendLog('fallback', `${msg} Building a local graph from the Markdown instead.`, 'warn');
        try {
          const raw = api?.fsReadFile ? await api.fsReadFile({ filePath: rel, workspaceRoot }) : null;
          if (typeof raw !== 'string' || !raw.trim()) throw new Error(msg);
          const parsedMarkdownIr = parseSkillMarkdownToIr(raw);
          const fallback = fallbackGraphFromMarkdownIr(parsedMarkdownIr);
          appendLog(
            'fallback',
            `Local graph built: ${fallback.nodes.length} nodes, ${fallback.edges.length} edges. Saving now.`,
            'warn',
          );
          const importedGraph = await finalizeImportedGraph({
            ...fallback,
            markdown: {
              ...(fallback.markdown ?? {}),
              original: raw,
              lastRoundTripAt: new Date().toISOString(),
            },
          });
          await writeGraphToDisk(importedGraph, { compileMarkdown: false });
          await refreshSkillFileList();
          appendLog('done', `Import finished with local fallback: ${fallback.name}`, 'warn');
          setPhase('done');
          onAudit?.('skills:graph-import', `${fallback.name} (fallback)`, true);
        } catch (fallbackError) {
          const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          setErr(fallbackMsg);
          setPhase('error');
          appendLog('error', fallbackMsg, 'error');
          onAudit?.('skills:graph-import', fallbackMsg, false);
        }
      } finally {
        activeImportRef.current = false;
        setBusy(false);
      }
    },
    [appendLog, finalizeImportedGraph, runCodexSkillImport, onAudit, workspaceRoot, refreshSkillFileList],
  );

  const runImportPipeline = useCallback(async () => {
    let rel = stagedRelPath;
    if (!rel && pasteMd.trim()) {
      const staged = await stageMarkdownToWorkspace(pasteMd.trim());
      if (!staged) {
        setErr('Could not write markdown to workspace.');
        setPhase('error');
        return;
      }
      rel = staged;
      setStagedRelPath(staged);
    }
    if (!rel) {
      setErr('Pick a Markdown file or paste content.');
      setPhase('error');
      return;
    }
    await runImportFromPath(rel);
  }, [pasteMd, stagedRelPath, stageMarkdownToWorkspace, runImportFromPath]);

  const runPromptGraphPipeline = useCallback(async () => {
    const prompt = skillPrompt.trim();
    if (!prompt) {
      setErr('Type a skill prompt first.');
      setPhase('error');
      return;
    }
    setErr('');
    setBusy(true);
    setPhase('json');
    activeImportRef.current = true;
    appendLog('json', 'Creating canonical graph from prompt...', 'info');
    try {
      appendLog(
        'codex',
        `Calling Codex for prompt-to-graph (model gpt-5.4-mini, medium reasoning). Waiting up to ${Math.round(
          CODEX_PROMPT_GRAPH_TIMEOUT_MS / 60_000,
        )} minutes.`,
        'info',
      );
      const r = await withTimeout(
        runCodexSkillImport(
          buildSkillPromptToGraphPromptV2(prompt),
          undefined,
          { model: 'gpt-5.4-mini', modelReasoningEffort: 'medium' },
        ),
        CODEX_PROMPT_GRAPH_TIMEOUT_MS,
        'Codex prompt-to-graph timed out before returning JSON.',
        (elapsedMs, remainingMs) => {
          appendLog(
            'codex',
            `Still waiting for prompt graph JSON (${formatDuration(elapsedMs)} elapsed, ${formatDuration(remainingMs)} before timeout).`,
            'info',
          );
        },
      );
      if (!r.ok) throw new Error(r.error || 'Prompt-to-graph failed');
      appendLog('codex', `Codex prompt graph response received (${(r.stdout || '').length.toLocaleString()} stdout chars).`, 'info');
      let parsed = parseSkillFlowGraphAnyFromStdout(r.stdout || r.stderr || '');
      if ('error' in parsed) {
        setPhase('repair');
        appendLog('repair', `Parse failed (${parsed.error}). Running repair pass...`, 'warn');
        const repaired = await withTimeout(
          runCodexSkillImport(
            buildSkillFlowGraphRepairPromptV2(r.stdout || r.stderr || '', [parsed.error]),
            undefined,
            { model: 'gpt-5.4-mini', modelReasoningEffort: 'medium' },
          ),
          CODEX_PROMPT_GRAPH_REPAIR_TIMEOUT_MS,
          'Codex prompt graph repair timed out before returning JSON.',
          (elapsedMs, remainingMs) => {
            appendLog(
              'repair',
              `Still waiting for prompt graph repair (${formatDuration(elapsedMs)} elapsed, ${formatDuration(remainingMs)} before timeout).`,
              'info',
            );
          },
        );
        if (!repaired.ok) throw new Error(repaired.error || 'Repair step failed');
        parsed = parseSkillFlowGraphAnyFromStdout(repaired.stdout || repaired.stderr || '');
      }
      if ('error' in parsed) throw new Error(parsed.error);
      appendLog('graph', `Graph parsed: ${parsed.graph.nodes.length} nodes, ${parsed.graph.edges.length} edges. Applying canonical layout.`, 'info');
      const promptGraph = await finalizeImportedGraph({ ...parsed.graph, sourceType: 'visual' });
      appendLog('save', 'Saving generated graph so it appears in Saved skills.', 'info');
      await writeGraphToDisk(promptGraph, { compileMarkdown: false });
      await refreshSkillFileList();
      appendLog('done', `Prompt graph finished: ${parsed.graph.name}`, 'info');
      setPhase('done');
      onAudit?.('skills:prompt-graph', parsed.graph.name, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      setPhase('error');
      appendLog('error', msg, 'error');
      onAudit?.('skills:prompt-graph', msg, false);
    } finally {
      activeImportRef.current = false;
      setBusy(false);
    }
  }, [appendLog, finalizeImportedGraph, onAudit, runCodexSkillImport, skillPrompt, refreshSkillFileList]);

  const onDropMd = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = Array.from(e.dataTransfer.files).find((f) => /\.md$/i.test(f.name));
      if (!file) {
        setErr('Drop a .md file.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        void (async () => {
          const staged = await stageMarkdownToWorkspace(text);
          if (staged) {
            setStagedRelPath(staged);
            setErr('');
          }
        })();
      };
      reader.readAsText(file);
    },
    [stageMarkdownToWorkspace],
  );

  const writeGraphToDisk = useCallback(
    async (g: SkillFlowGraphV2, opts?: { compileMarkdown?: boolean }) => {
      const api = window.electronAPI;
      if (!api?.fsWriteFile || !api.fsMkdir) return;
      const canonical = canonicalizeSkillGraph(g);
      const val = validateSkillFlowGraphV2(canonical);
      if (!val.ok) {
        setErr('Fix validation errors before saving exported Markdown (graph JSON can still be saved).');
      }
      const ts = new Date().toISOString();
      const payload: SkillFlowGraphV2 = {
        ...canonical,
        layout: {
          ...(canonical.layout ?? { strategy: 'fast-board', orientation: 'left-to-right' }),
          strategy: canonical.layout?.strategy ?? 'fast-board',
          orientation: canonical.layout?.orientation ?? 'left-to-right',
          lastSavedAt: ts,
        },
      };
      const slug = slugifyGraphName(payload.name);
      const dir = `.codex/skills/${slug}`;
      await api.fsMkdir({ dirPath: dir, workspaceRoot });
      const graphJson = `${JSON.stringify(payload, null, 2)}\n`;
      await api.fsWriteFile({
        filePath: `${dir}/skill.graph.json`,
        content: graphJson,
        workspaceRoot,
      });
      if (val.ok) {
        let md = graphToSkillMarkdown(payload);
        if (opts?.compileMarkdown) {
          const compilePrompt = buildSkillGraphToMarkdownCompilePromptV2(JSON.stringify(payload, null, 2));
          const medium = await runCodexSkillImport(compilePrompt, undefined, {
            model: 'gpt-5.4',
            modelReasoningEffort: 'medium',
          });
          if (medium.ok && medium.stdout?.trim()) {
            const candidate = medium.stdout.trim();
            const check = validateCompiledSkillMarkdown(candidate);
            if (check.ok) {
              md = `${candidate.replace(/\n+$/, '')}\n`;
            } else {
              appendLog('save', `SKILL.md compile validation retry: ${check.issues.join('; ')}`, 'warn');
              const high = await runCodexSkillImport(compilePrompt, undefined, {
                model: 'gpt-5.4',
                modelReasoningEffort: 'high',
              });
              if (high.ok && high.stdout?.trim()) {
                const highCandidate = high.stdout.trim();
                if (validateCompiledSkillMarkdown(highCandidate).ok) {
                  md = `${highCandidate.replace(/\n+$/, '')}\n`;
                }
              }
            }
          } else if (medium.error) {
            appendLog('save', `SKILL.md compile fell back to local export: ${medium.error}`, 'warn');
          }
        }
        await api.fsWriteFile({
          filePath: `${dir}/SKILL.md`,
          content: md,
          workspaceRoot,
        });
        await api.fsWriteFile({
          filePath: `${dir}/skill.md`,
          content: md,
          workspaceRoot,
        });
      }
      if (refreshListTimerRef.current) clearTimeout(refreshListTimerRef.current);
      refreshListTimerRef.current = window.setTimeout(() => {
        refreshListTimerRef.current = null;
        void refreshSkillFileList();
      }, 850);
      onAudit?.('skills:graph-save', `${dir}/skill.graph.json`, true);
    },
    [workspaceRoot, refreshSkillFileList, onAudit, runCodexSkillImport, appendLog],
  );

  const saveGraph = useCallback(async () => {
    if (!graph) return;
    setSaveStatus('saving');
    try {
      await writeGraphToDisk(graph, { compileMarkdown: true });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('failed');
    }
  }, [graph, writeGraphToDisk]);

  const popOutSkillsStudio = useCallback(async () => {
    if (!graph) return;
    const api = window.electronAPI;
    if (!api?.skillsStudioOpenWindow) {
      setErr('Pop-out is only available in the desktop app.');
      return;
    }
    try {
      const json = JSON.stringify(graph);
      if (json.length > 26_214_400) {
        setErr('Graph is too large to open in a separate window.');
        return;
      }
      const res = await api.skillsStudioOpenWindow(json);
      if (!res?.ok) setErr(typeof res?.error === 'string' ? res.error : 'Could not open studio window.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [graph]);

  const closeStandaloneStudio = useCallback(() => {
    void window.electronAPI?.skillsStudioCloseWindow?.();
  }, []);

  useEffect(() => {
    if (!graph) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void (async () => {
        const g = graphRef.current;
        if (!g) return;
        setSaveStatus('saving');
        try {
          await writeGraphToDisk(g);
          setSaveStatus('saved');
        } catch {
          setSaveStatus('failed');
        }
      })();
    }, 550);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [graph, writeGraphToDisk]);

  useEffect(() => {
    const unsub = window.electronAPI?.onWorkspaceChange?.(() => {
      void refreshSkillFileList();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [refreshSkillFileList]);

  const loadSkillEntry = useCallback(
    async (entry: SkillListRow) => {
      const api = window.electronAPI;
      if (!api?.fsReadFile) return;
      const raw = await api.fsReadFile({ filePath: entry.graphRelPath, workspaceRoot });
      if (typeof raw !== 'string') return;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        setErr('Invalid JSON file.');
        return;
      }
      const parsed = normalizeSkillFlowGraphAny(parsedJson);
      if (!parsed) {
        setErr('Could not parse skill graph JSON.');
        return;
      }
      const loaded = canonicalizeSkillGraph(parsed);
      const preserve = loaded.layout?.preserveManualPositions ?? true;
      setPreserveManualPositions(preserve);
      const repaired = repairSkillGraphLayoutIfNeeded(loaded);
      let next: SkillFlowGraphV2;
      if (repaired.changed) {
        next = repaired.graph;
      } else if (
        loaded.layout?.strategy === 'fast-board' &&
        loaded.layout.layoutAlgorithmVersion === CURRENT_SKILL_BOARD_LAYOUT_VERSION
      ) {
        next = loaded;
      } else {
        try {
          const plan = buildFastBoardSkillLayoutPlan(loaded);
          next = await applySkillLayoutPlan(loaded, plan, {
            preserveManualPositions: preserve,
            strategy: 'fast-board',
          });
        } catch {
          next = applyDagreLayout(loaded, { respectManual: preserve });
        }
      }
      setGraph(next);
      setLoadedSourceKey(entry.key);
      setErr('');
      setPhase('done');
      setSelectedSkillNodeIds([]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(null);
      setFitNonce((n) => n + 1);
      onAudit?.('skills:graph-load', entry.graphRelPath, true);
    },
    [workspaceRoot, onAudit],
  );

  const regenerateSkillRow = useCallback(
    async (row: SkillListRow) => {
      if (!row.mdRelPath) {
        setErr('No skill.md next to this graph — cannot regenerate.');
        return;
      }
      await runImportFromPath(row.mdRelPath);
    },
    [runImportFromPath],
  );

  const deleteSkillRow = useCallback(
    async (row: SkillListRow) => {
      if (!window.confirm(`Delete saved skill “${row.label}”? This removes files on disk.`)) return;
      const api = window.electronAPI;
      if (!api?.fsUnlink) return;
      try {
        await api.fsUnlink({ filePath: row.graphRelPath, workspaceRoot });
        if (row.mdRelPath) {
          const mdEx = await api.fsExists?.({ filePath: row.mdRelPath, workspaceRoot });
          if (mdEx?.exists) await api.fsUnlink({ filePath: row.mdRelPath, workspaceRoot });
        }
        if (row.kind === 'nested') {
          for (const rel of [`.codex/skills/${row.slug}/SKILL.md`, `.codex/skills/${row.slug}/skill.md`]) {
            if (rel === row.mdRelPath) continue;
            const ex = await api.fsExists?.({ filePath: rel, workspaceRoot });
            if (ex?.exists) await api.fsUnlink({ filePath: rel, workspaceRoot });
          }
        }
        if (row.kind === 'nested' && api.fsRmdir) {
          await api.fsRmdir({ dirPath: `.codex/skills/${row.slug}`, workspaceRoot });
        }
        if (loadedSourceKey === row.key) {
          setGraph(null);
          setLoadedSourceKey(null);
        }
        await refreshSkillFileList();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [workspaceRoot, refreshSkillFileList, loadedSourceKey],
  );

  const onChangeGraph = useCallback((next: SkillFlowGraphV2) => {
    exitTraceMode();
    setGraph(canonicalizeSkillGraph(next));
  }, [exitTraceMode]);

  const onPreserveManualChange = useCallback((value: boolean) => {
    exitTraceMode();
    setPreserveManualPositions(value);
    setGraph((prev) => {
      if (!prev) return prev;
      const baseLayout = prev.layout ?? {
        strategy: 'manual' as const,
        orientation: 'left-to-right' as const,
      };
      return {
        ...prev,
        layout: {
          ...baseLayout,
          preserveManualPositions: value,
        },
      };
    });
  }, [exitTraceMode]);

  const onShowVariablesChange = useCallback((value: boolean) => {
    exitTraceMode();
    setShowVariables(value);
  }, [exitTraceMode]);

  const onInferArtifactsChange = useCallback((value: boolean) => {
    exitTraceMode();
    setInferArtifactsOnLayout(value);
  }, [exitTraceMode]);

  const onShowMiniMapChange = useCallback((value: boolean) => {
    exitTraceMode();
    setShowMiniMap(value);
  }, [exitTraceMode]);

  const onAppendConnected = useCallback(() => {
    if (!graph || !selectedNodeId) return;
    exitTraceMode();
    const next = createConnectedSkillNode(graph, selectedNodeId, { label: 'New step', kind: 'step' });
    setGraph(canonicalizeSkillGraph(next));
    setFitNonce((n) => n + 1);
  }, [graph, selectedNodeId, exitTraceMode]);

  const applyFastBoardLayout = useCallback(
    async (g: SkillFlowGraphV2): Promise<SkillFlowGraphV2> => {
      const canonical = canonicalizeSkillGraph(g);
      let plan = buildFastBoardSkillLayoutPlan(canonical);
      if (inferArtifactsOnLayout) {
        plan = mergeInferredArtifactsIntoPlan(plan, canonical);
      }
      const val = validateSkillLayoutPlan(plan, canonical);
      if (!val.ok) {
        appendLog(
          'layout',
          `Layout plan validation: ${val.issues.filter((i) => i.severity === 'error').length} error(s)`,
          'warn',
        );
      }
      return applySkillLayoutPlan(canonical, plan, {
        preserveManualPositions,
        strategy: 'fast-board',
      });
    },
    [inferArtifactsOnLayout, preserveManualPositions, appendLog],
  );

  const executeCodexNodeExpansion = useCallback(
    (
      laid: SkillFlowGraphV2,
      targetNodeId: string,
      jobId: string,
      jobStartedAtMs: number,
      meta: { kind: SkillNodeKind; userPrompt: string; sourceNodeId?: string | null },
    ) => {
      const logMeta = { nodeId: targetNodeId, jobId };
      const src = meta.sourceNodeId ? laid.nodes.find((n) => n.id === meta.sourceNodeId) : undefined;
      appendLog('node-gen', 'Preparing expansion prompt', 'info', logMeta);
      const prompt = buildSkillNodeExpansionPrompt({
        skillName: laid.name,
        skillDescription: laid.description,
        requestedKind: meta.kind,
        userPrompt: meta.userPrompt,
        sourceNode: src ?? null,
        nearbyNodesSummary: buildNearbyNodesForPrompt(laid, meta.sourceNodeId ?? undefined),
        existingVariablesSummary:
          laid.nodes
            .filter((n) => n.kind === 'variable')
            .map((n) => n.variable?.variableName ?? n.label)
            .join('; ') || '(none)',
        existingOutputsSummary:
          laid.nodes
            .filter((n) => n.kind === 'output' || n.kind === 'response')
            .map((n) => `${n.kind}: ${n.label}`)
            .join('; ') || '(none)',
      });

      void (async () => {
        activeNodeJobsRef.current.set(jobId, logMeta);
        try {
          if (cancelledJobIdsRef.current.has(jobId)) return;
          appendLog('node-gen', 'Calling Codex', 'info', logMeta);
          const r1 = await runCodexNodeExpansion(prompt);
          if (cancelledJobIdsRef.current.has(jobId)) return;
          if (!r1.ok) {
            const message = r1.error || 'Codex failed';
            setGraph((prev) => (prev ? markNodeGenerationFailed(prev, targetNodeId, message) : prev));
            appendLog('node-gen', message, 'error', logMeta);
            return;
          }
          appendLog('node-gen', 'Parsing Codex response', 'info', logMeta);
          let parsed = parseGeneratedSkillNodePatchFromStdout(r1.stdout || r1.stderr || '');
          if ('error' in parsed) {
            appendLog('node-gen', `Response parse failed: ${parsed.error}`, 'warn', logMeta);
            appendLog('node-gen', 'Calling Codex repair pass', 'info', logMeta);
            const r2 = await runCodexNodeExpansion(
              buildSkillNodeExpansionRepairPrompt(r1.stdout || r1.stderr || '', [parsed.error]),
            );
            if (cancelledJobIdsRef.current.has(jobId)) return;
            if (!r2.ok) {
              const message = r2.error || 'Repair failed';
              setGraph((prev) => (prev ? markNodeGenerationFailed(prev, targetNodeId, message) : prev));
              appendLog('node-gen', message, 'error', logMeta);
              return;
            }
            appendLog('node-gen', 'Parsing repaired response', 'info', logMeta);
            parsed = parseGeneratedSkillNodePatchFromStdout(r2.stdout || r2.stderr || '');
          }
          if ('error' in parsed) {
            setGraph((prev) => (prev ? markNodeGenerationFailed(prev, targetNodeId, parsed.error) : prev));
            appendLog('node-gen', parsed.error, 'error', logMeta);
            return;
          }
          appendLog('node-gen', 'Applying generated node patch', 'info', logMeta);
          let patchOutcome: 'applied' | 'skipped' | 'ignored' = 'ignored';
          setGraph((prev) => {
            if (!prev) return prev;
            const node = prev.nodes.find((n) => n.id === targetNodeId);
            if (!node || node.generation?.jobId !== jobId) return prev;
            if (cancelledJobIdsRef.current.has(jobId)) return prev;
            const patched = applyGeneratedPatchToNode(prev, targetNodeId, parsed, { jobStartedAtMs });
            if (patched === prev) {
              patchOutcome = 'skipped';
              return markNodeGenerationFailed(
                prev,
                targetNodeId,
                'Skipped AI result because the node changed after generation started.',
              );
            }
            patchOutcome = 'applied';
            return patched;
          });
          window.setTimeout(() => {
            if (patchOutcome === 'applied') {
              appendLog('node-gen', 'Generation finished, awaiting review', 'info', logMeta);
            } else if (patchOutcome === 'skipped') {
              appendLog('node-gen', 'Skipped AI result because the node changed after generation started.', 'warn', logMeta);
            }
          }, 0);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setGraph((prev) => (prev ? markNodeGenerationFailed(prev, targetNodeId, message) : prev));
          appendLog('node-gen', message, 'error', logMeta);
        } finally {
          activeNodeJobsRef.current.delete(jobId);
        }
      })();
    },
    [appendLog, runCodexNodeExpansion],
  );

  const onConnectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (!graph) return;
      exitTraceMode();
      const result = connectExistingSkillNodes(graph, sourceNodeId, targetNodeId);
      if (result.changed) {
        pushUndoSnapshot();
        setGraph(result.graph);
      }
      setSelectedSkillNodeIds([]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(result.edgeId);
      appendLog(
        'graph',
        result.changed
          ? `Connected ${sourceNodeId} -> ${targetNodeId}`
          : result.reason === 'duplicate'
            ? 'Connection already exists'
            : 'Connection was not created',
        result.changed ? 'info' : 'warn',
      );
    },
    [graph, appendLog, pushUndoSnapshot, exitTraceMode],
  );

  const selectVariableForRead = useCallback(
    (variableNodeId: string) => {
      if (!graph || !pendingVariableRead) return;
      exitTraceMode();
      const result = connectVariableRead(graph, variableNodeId, pendingVariableRead.sourceNodeId);
      if (result.changed) {
        pushUndoSnapshot();
        setGraph(result.graph);
      }
      setPendingVariableRead(null);
      setSelectedSkillNodeIds([]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(result.edgeId);
      appendLog(
        'graph',
        result.changed
          ? 'Connected variable read'
          : result.reason === 'duplicate'
            ? 'Variable read already exists'
            : 'Variable read was not created',
        result.changed ? 'info' : 'warn',
      );
    },
    [graph, pendingVariableRead, appendLog, pushUndoSnapshot, exitTraceMode],
  );

  const createSetVariableFromPicker = useCallback(() => {
    if (!pendingVariableRead) return;
    setAddFlowPrompt({
      kind: 'variable',
      action: 'set-variable',
      flowX: pendingVariableRead.flowX,
      flowY: pendingVariableRead.flowY,
      screenX: pendingVariableRead.screenX,
      screenY: pendingVariableRead.screenY,
      sourceNodeId: pendingVariableRead.sourceNodeId,
      forcedGroupPlanId: pendingVariableRead.forcedGroupPlanId,
    });
    setPendingVariableRead(null);
  }, [pendingVariableRead]);

  const handleRadialMenuCommit = useCallback((payload: RadialCommitPayload) => {
    exitTraceMode();
    const variableReadSourceNodeId = payload.sourceNodeId ?? selectedNodeId;
    if (payload.action === 'get-variable' && variableReadSourceNodeId) {
      setPendingVariableRead({
        sourceNodeId: variableReadSourceNodeId,
        flowX: payload.flowX,
        flowY: payload.flowY,
        screenX: payload.screenX,
        screenY: payload.screenY,
        forcedGroupPlanId: payload.forcedGroupPlanId,
      });
      setVariableSearch('');
      return;
    }
    if (payload.action === 'get-variable') {
      appendLog('graph', 'Get variable needs a selected source node. Select or right-click the node that should read the variable first.', 'warn');
      return;
    }
    setAddFlowPrompt(payload);
  }, [appendLog, exitTraceMode, selectedNodeId]);

  const handleAddFlowCancel = useCallback(() => {
    exitTraceMode();
    setAddFlowPrompt(null);
  }, [exitTraceMode]);

  const handleAddFlowBlank = useCallback(async () => {
    if (!graph || !addFlowPrompt) return;
    const p = addFlowPrompt;
    exitTraceMode();
    setAddFlowPrompt(null);
    pushUndoSnapshot();
    const created =
      p.insertMode === 'split-edge' && p.sourceEdgeId
        ? insertSkillNodeOnEdge(graph, {
            edgeId: p.sourceEdgeId,
            flowX: p.flowX,
            flowY: p.flowY,
            kind: p.kind,
            variableMode: p.action === 'set-variable' ? 'write' : 'default',
            layoutGroupPlanId: p.forcedGroupPlanId ?? undefined,
            initialStatus: 'draft',
          })
        : createSkillNodeFromRadialPick(graph, {
            flowX: p.flowX,
            flowY: p.flowY,
            kind: p.kind,
            variableMode: p.action === 'get-variable' ? 'read' : p.action === 'set-variable' ? 'write' : 'default',
            sourceNodeId: p.sourceNodeId ?? undefined,
            layoutGroupPlanId: p.forcedGroupPlanId ?? undefined,
            initialStatus: 'draft',
          });
    const next = created.graph;
    const newNodeId = 'newNodeId' in created ? created.newNodeId : null;
    if (!newNodeId) return;
    appendLog('node-gen', `Created blank ${p.kind} node`, 'info', { nodeId: newNodeId });
    setGraph(next);
    setSelectedSkillNodeIds([newNodeId]);
    setSelectedUserGroupId(null);
    setSelectedEdgeId(null);
    setFitNonce((n) => n + 1);
  }, [graph, addFlowPrompt, appendLog, pushUndoSnapshot, exitTraceMode]);

  const handleAddFlowGenerate = useCallback(
    async (idea: string) => {
      if (!graph || !addFlowPrompt) return;
      const p = addFlowPrompt;
      exitTraceMode();
      setAddFlowPrompt(null);
      const jobId = uuidv4();
      const jobStartedAtMs = Date.now();
      pushUndoSnapshot();
      const splitEdge = p.insertMode === 'split-edge' && p.sourceEdgeId ? graph.edges.find((e) => e.id === p.sourceEdgeId) : null;
      const baseGraph = splitEdge ? { ...graph, edges: graph.edges.filter((e) => e.id !== splitEdge.id) } : graph;
      const placeholder = createGeneratingPlaceholderNode(baseGraph, {
        flowX: p.flowX,
        flowY: p.flowY,
        kind: p.kind,
        variableMode: p.action === 'get-variable' ? 'read' : p.action === 'set-variable' ? 'write' : 'default',
        userPrompt: idea,
        jobId,
        sourceNodeId: splitEdge ? undefined : p.sourceNodeId ?? undefined,
        layoutGroupPlanId: p.forcedGroupPlanId ?? undefined,
      });
      let next = placeholder.graph;
      const newNodeId = placeholder.newNodeId;
      if (splitEdge) {
        next = connectExistingSkillNodes(next, splitEdge.source, newNodeId).graph;
        next = connectExistingSkillNodes(next, newNodeId, splitEdge.target).graph;
      }
      appendLog('node-gen', `Queued ${p.kind} generation: ${trunc(idea, 120) || '(blank idea)'}`, 'info', {
        nodeId: newNodeId,
        jobId,
      });
      setGraph(next);
      setSelectedSkillNodeIds([newNodeId]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(null);
      setFitNonce((n) => n + 1);

      executeCodexNodeExpansion(next, newNodeId, jobId, jobStartedAtMs, {
        kind: p.kind,
        userPrompt: idea,
        sourceNodeId: p.sourceNodeId ?? null,
      });
    },
    [graph, addFlowPrompt, appendLog, executeCodexNodeExpansion, pushUndoSnapshot, exitTraceMode],
  );

  const deleteNodesByIds = useCallback(
    async (idsIn: string[]) => {
      if (!graph) return;
      const ids = [...new Set(idsIn.filter((id) => graph.nodes.some((n) => n.id === id)))];
      if (!ids.length) return;
      exitTraceMode();
      pushUndoSnapshot();
      for (const id of ids) {
        const victim = graph.nodes.find((n) => n.id === id);
        if (victim?.generation?.jobId) cancelledJobIdsRef.current.add(victim.generation.jobId);
      }
      appendLog('layout', `Delete ${ids.length} node(s)…`, 'info');
      let next = deleteSkillNodesFromGraph(graph, ids);
      try {
        next = await applyFastBoardLayout(next);
        setGraph(next);
        setSelectedSkillNodeIds([]);
        setSelectedUserGroupId(null);
        setSelectedEdgeId(null);
        setFitNonce((n) => n + 1);
      } catch (e) {
        appendLog('layout', e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [graph, appendLog, applyFastBoardLayout, pushUndoSnapshot, exitTraceMode],
  );

  const deleteSelectedSkillNodes = useCallback(async () => {
    const ids =
      selectedSkillNodeIds.length > 0 ? selectedSkillNodeIds : selectedNodeId ? [selectedNodeId] : [];
    await deleteNodesByIds(ids);
  }, [selectedSkillNodeIds, selectedNodeId, deleteNodesByIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        applyUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        applyRedo();
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!graph) return;
      const delIds =
        selectedSkillNodeIds.length > 0 ? selectedSkillNodeIds : selectedNodeId ? [selectedNodeId] : [];
      if (!delIds.length) return;
      if (!delIds.some((id) => graph.nodes.some((n) => n.id === id))) return;
      e.preventDefault();
      void deleteNodesByIds(delIds);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [graph, selectedSkillNodeIds, selectedNodeId, deleteNodesByIds, applyUndo, applyRedo]);

  const onRegenerateInspectorNode = useCallback(
    async (nodeId: string) => {
      const g = graphRef.current;
      if (!g) return;
      const node = g.nodes.find((n) => n.id === nodeId);
      if (!node?.generation?.userPrompt) return;
      exitTraceMode();
      const newJobId = uuidv4();
      const jobStartedAtMs = Date.now();
      pushUndoSnapshot();
      if (node.generation.jobId) cancelledJobIdsRef.current.add(node.generation.jobId);
      const prepped = prepareSkillNodeRegeneration(g, nodeId, newJobId);
      if (!prepped) return;
      appendLog('node-gen', `Restarted ${node.kind} generation`, 'info', { nodeId, jobId: newJobId });
      setGraph(prepped);
      setSelectedSkillNodeIds([nodeId]);
      setSelectedUserGroupId(null);
      setSelectedEdgeId(null);
      executeCodexNodeExpansion(prepped, nodeId, newJobId, jobStartedAtMs, {
        kind: node.generation.requestedKind,
        userPrompt: node.generation.userPrompt,
        sourceNodeId: node.generation.sourceNodeId ?? null,
      });
    },
    [appendLog, executeCodexNodeExpansion, pushUndoSnapshot, exitTraceMode],
  );

  const onDeleteInspectorNode = useCallback(
    (nodeId: string) => {
      void deleteNodesByIds([nodeId]);
    },
    [deleteNodesByIds],
  );

  const onNodeDragStart = useCallback(
    (_: MouseEvent, node: Node) => {
      if (node.type === SKILL_GROUP_RF_TYPE && node.id.startsWith('rf-user-group-')) {
        const ugid = node.id.slice('rf-user-group-'.length);
        const grec = graph?.groups?.find((g) => g.id === ugid);
        const memberIds = grec?.nodeIds ?? [];
        const members = new Map<string, { x: number; y: number }>();
        for (const id of memberIds) {
          const n = graph?.nodes.find((nn) => nn.id === id);
          if (n) members.set(id, { x: n.ui?.x ?? 0, y: n.ui?.y ?? 0 });
        }
        groupDragRef.current = {
          nodeId: node.id,
          origin: { ...node.position },
          members,
        };
        return;
      }
      if (node.type === SKILL_GROUP_RF_TYPE && node.id.startsWith('rf-group-')) {
        const gid = node.id.slice('rf-group-'.length);
        const plan = graph?.layout?.layoutPlan;
        const memberIds =
          plan && isSemanticLayoutPlan(plan)
            ? plan.groups.find((g) => g.id === gid)?.nodeIds ?? []
            : [];
        const members = new Map<string, { x: number; y: number }>();
        for (const id of memberIds) {
          const n = graph?.nodes.find((nn) => nn.id === id);
          if (n) members.set(id, { x: n.ui?.x ?? 0, y: n.ui?.y ?? 0 });
        }
        groupDragRef.current = {
          nodeId: node.id,
          origin: { ...node.position },
          members,
        };
      }
    },
    [graph],
  );

  const onNodeDragStop = useCallback((_: MouseEvent, node: Node) => {
    const session = groupDragRef.current;
    groupDragRef.current = null;

    if (node.type === SKILL_GROUP_RF_TYPE && session?.nodeId === node.id) {
      const dx = node.position.x - session.origin.x;
      const dy = node.position.y - session.origin.y;
      if (dx !== 0 || dy !== 0) {
        exitTraceMode();
        setGraph((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: prev.nodes.map((n) => {
              const init = session.members.get(n.id);
              if (!init) return n;
              return {
                ...n,
                ui: {
                  ...n.ui,
                  x: init.x + dx,
                  y: init.y + dy,
                  width: n.ui?.width ?? 220,
                  height: n.ui?.height ?? 96,
                  manuallyPositioned: true,
                },
              };
            }),
          };
        });
      }
      return;
    }

    if (node.type === SKILL_ARTIFACT_RF_TYPE) {
      exitTraceMode();
      setGraph((prev) => {
        if (!prev?.layout?.layoutPlan) return prev;
        const lp = prev.layout.layoutPlan;
        if (!isSemanticLayoutPlan(lp)) return prev;
        const arts = lp.dataArtifacts;
        if (!arts?.length) return prev;
        const nextArts = arts.map((a) =>
          a.id === node.id
            ? {
                ...a,
                ui: {
                  ...a.ui,
                  x: node.position.x,
                  y: node.position.y,
                  manuallyPositioned: true,
                },
              }
            : a,
        );
        return {
          ...prev,
          layout: {
            ...prev.layout!,
            layoutPlan: {
              ...lp,
              dataArtifacts: nextArts,
            },
          },
        };
      });
      return;
    }

    if (node.type !== SKILL_FLOW_RF_TYPE) return;

    exitTraceMode();
    setGraph((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === node.id
            ? {
                ...n,
                ui: {
                  ...n.ui,
                  x: node.position.x,
                  y: node.position.y,
                  width: n.ui?.width ?? 220,
                  height: n.ui?.height ?? 96,
                  manuallyPositioned: true,
                },
              }
            : n,
        ),
      };
    });
  }, [exitTraceMode]);

  const graphTitle = graph?.name;

  const handleSubmitUserGroup = useCallback(
    (v: SkillGroupDialogSubmit) => {
      setGroupDialogOpen(false);
      if (!graph || selectedSkillNodeIds.length < 2) return;
      exitTraceMode();
      pushUndoSnapshot();
      const next = createUserSkillGroupInGraph(graph, {
        label: v.label,
        colorKey: v.colorKey,
        nodeIds: selectedSkillNodeIds,
      });
      const newG = next.groups;
      const newId = newG?.[newG.length - 1]?.id ?? null;
      setGraph(next);
      setSelectedSkillNodeIds([]);
      setSelectedEdgeId(null);
      if (newId) setSelectedUserGroupId(newId);
    },
    [graph, selectedSkillNodeIds, pushUndoSnapshot, exitTraceMode],
  );

  const selectionToolbar =
    selectedSkillNodeIds.length >= 2
      ? {
          selectedCount: selectedSkillNodeIds.length,
          onGroup: () => {
            exitTraceMode();
            setGroupDialogOpen(true);
          },
          onDelete: () => void deleteSelectedSkillNodes(),
        }
      : null;

  const traceControls = {
    isPlaying: tracePlaying,
    isActive: traceModeActive,
    stepIndex: traceStepIndex,
    stepCount: traceSnapshot?.steps.length ?? 0,
    speedMs: traceSpeedMs,
    onPlayPause: () => {
      const count = traceSnapshot?.steps.length ?? 0;
      if (!count) return;
      enterTraceMode();
      setTracePlaying((v) => !v);
    },
    onStepBack: () => {
      const count = traceSnapshot?.steps.length ?? 0;
      if (!count) return;
      enterTraceMode();
      setTracePlaying(false);
      setTraceStepIndex((i) => (i - 1 + count) % count);
    },
    onStepForward: () => {
      const count = traceSnapshot?.steps.length ?? 0;
      if (!count) return;
      enterTraceMode();
      setTracePlaying(false);
      setTraceStepIndex((i) => (i + 1) % count);
    },
    onReset: () => {
      const count = traceSnapshot?.steps.length ?? 0;
      if (!count) return;
      enterTraceMode();
      setTracePlaying(false);
      setTraceStepIndex(0);
    },
    onSpeedChange: (value: number) => setTraceSpeedMs(value),
  };

  const showImportChrome = variant === 'default';

  /** Fixed positioning is relative to the nearest transformed ancestor; `.work-card` keeps `transform` after `fade-in-up`, so maximize must portal to `document.body` to match the pop-out window. */
  const immersivePresentation = skillsStudioMode === 'maximized' || variant === 'standalone';
  const portalMaximizedStudioToBody = variant === 'default' && skillsStudioMode === 'maximized';

  const skillsFlowShellClassName = [
    'skills-flow-shell',
    variant === 'default' && skillsStudioMode === 'maximized' ? 'skills-flow-shell--fullscreen skills-studio-maximized' : '',
    immersivePresentation ? 'skills-flow-shell--immersive-fill' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const skillsStudioSubtree = graph ? (
    <div className={[skillsFlowShellClassName, 'skills-studio-expanded-root'].filter(Boolean).join(' ')}>
      <SkillsStudioChrome
        graph={graph}
        canvasGraph={deferredGraph ?? graph}
        graphTitle={graphTitle}
        validation={validation}
        busy={busy}
        preserveManualPositions={preserveManualPositions}
        onPreserveManualChange={onPreserveManualChange}
        onCleanLayout={() => void runCleanLayout()}
        onRepairLayout={runRepairLayout}
        onResetLayout={() => void runResetLayout()}
        showVariables={showVariables}
        onShowVariablesChange={onShowVariablesChange}
        inferArtifactsOnLayout={inferArtifactsOnLayout}
        onInferArtifactsChange={onInferArtifactsChange}
        saveStatus={saveStatus}
        selectedNodeId={selectedNodeId}
        selectedSkillNodeIds={selectedSkillNodeIds}
        selectedUserGroupId={selectedUserGroupId}
        selectedEdgeId={selectedEdgeId}
        onFlowSelectionChange={onFlowSelectionChange}
        fitNonce={fitNonce}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        validationIssues={issueList}
        onChangeGraph={onChangeGraph}
        onAppendConnected={selectedNodeId ? onAppendConnected : undefined}
        onDeleteInspectorNode={onDeleteInspectorNode}
        onRegenerateInspectorNode={onRegenerateInspectorNode}
        selectionToolbar={selectionToolbar}
        genLogs={genLogs}
        onClearGenLogs={() => setGenLogs([])}
        presentation={immersivePresentation ? 'immersive' : 'default'}
        immersiveActions={
          immersivePresentation ? (
            <>
              <button type="button" className="btn-secondary btn-compact" onClick={() => void saveGraph()}>
                Save graph + MD
              </button>
              {variant === 'standalone' ? (
                <button type="button" className="btn-secondary btn-compact" onClick={closeStandaloneStudio}>
                  Close window
                </button>
              ) : (
                <button type="button" className="btn-secondary btn-compact" onClick={() => {
                  exitTraceMode();
                  setSkillsStudioMode('inline');
                }}>
                  Exit fullscreen
                </button>
              )}
            </>
          ) : undefined
        }
        studioActions={
          skillsStudioMode === 'inline' ? (
            <>
              <button type="button" className="btn-secondary btn-compact" onClick={() => {
                exitTraceMode();
                setSkillsStudioMode('maximized');
              }}>
                Expand studio
              </button>
              {variant === 'default' ? (
                <button type="button" className="btn-secondary btn-compact" onClick={() => {
                  exitTraceMode();
                  void popOutSkillsStudio();
                }}>
                  Pop out window
                </button>
              ) : null}
            </>
          ) : undefined
        }
        onRadialMenuCommit={handleRadialMenuCommit}
        onConnectNodes={onConnectNodes}
        showMiniMap={showMiniMap}
        onShowMiniMapChange={onShowMiniMapChange}
        traceSnapshot={traceModeActive ? traceSnapshot : undefined}
        traceControls={traceControls}
      />
    </div>
  ) : null;

  const variablePicker =
    pendingVariableRead ? (
      <div className="skill-variable-picker-backdrop" role="presentation" onMouseDown={() => setPendingVariableRead(null)}>
        <div
          className="skill-variable-picker"
          role="dialog"
          aria-label="Select variable"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="skill-variable-picker__header">
            <div>
              <div className="skill-variable-picker__title">Get variable</div>
              <div className="skill-variable-picker__hint">Choose an existing variable to read from this node.</div>
            </div>
            <button type="button" className="btn-secondary btn-compact" onClick={() => setPendingVariableRead(null)}>
              Close
            </button>
          </div>
          <input
            className="input skill-variable-picker__search"
            value={variableSearch}
            onChange={(e) => setVariableSearch(e.target.value)}
            placeholder="Search variables..."
            autoFocus
          />
          <div className="skill-variable-picker__list">
            {filteredVariableOptions.length ? (
              filteredVariableOptions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="skill-variable-picker__item"
                  onClick={() => selectVariableForRead(v.id)}
                >
                  <span className="skill-variable-picker__item-title">{v.label}</span>
                  <span className="skill-variable-picker__item-name">{v.variableName}</span>
                  {v.summary ? <span className="skill-variable-picker__item-summary">{v.summary}</span> : null}
                </button>
              ))
            ) : (
              <div className="skill-variable-picker__empty">
                <div>No variables found.</div>
                <button type="button" className="btn-secondary btn-compact" onClick={createSetVariableFromPicker}>
                  Create Set variable
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className={`skills-setup-panel ${variant === 'standalone' ? 'skills-setup-panel--standalone' : ''}`}>
      {variablePicker ? createPortal(variablePicker, document.body) : null}
      {addFlowPrompt && graph ? (
        <SkillNodeQuickPrompt
          kind={addFlowPrompt.kind}
          screenX={addFlowPrompt.screenX ?? 160}
          screenY={addFlowPrompt.screenY ?? 120}
          onCancel={handleAddFlowCancel}
          onCreateBlank={() => void handleAddFlowBlank()}
          onGenerate={(idea) => void handleAddFlowGenerate(idea)}
        />
      ) : null}
      {graph ? (
        <SkillGroupDialog
          open={groupDialogOpen}
          onClose={() => setGroupDialogOpen(false)}
          onSubmit={handleSubmitUserGroup}
          initialLabel="New group"
        />
      ) : null}
      {showImportChrome ? (
        <>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Drop or select a Markdown file describing the skill. Codex converts it into the canonical visual graph with variables. Save writes{' '}
            <span className="font-mono">.codex/skills/&lt;slug&gt;/skill.graph.json</span>, <span className="font-mono">SKILL.md</span>, and legacy <span className="font-mono">skill.md</span>{' '}
            (Markdown export requires passing validation).
          </p>

          <div className="work-actions" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => void pickMdFile().then((p) => p && setStagedRelPath(p))}>
              Select MD file
            </button>
            <button type="button" className="btn-primary btn-compact" disabled={busy} onClick={() => void runImportPipeline()}>
              Run import (V2 pipeline)
            </button>
            <span className="badge">{busy ? 'Busy…' : phase}</span>
            {stagedRelPath ? (
              <span className="badge font-mono" style={{ fontSize: 10 }}>
                {stagedRelPath}
              </span>
            ) : null}
          </div>

          <div
            className="input"
            style={{ padding: 24, marginBottom: 10, borderStyle: 'dashed', cursor: 'copy' }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={onDropMd}
          >
            Or drag and drop a .md file here
          </div>

          <textarea
            className="input font-mono"
            placeholder="Or paste Markdown (staged on Run import)"
            value={pasteMd}
            onChange={(e) => setPasteMd(e.target.value)}
            style={{ minHeight: 72, marginBottom: 10 }}
          />

          <div className="skill-prompt-create">
            <textarea
              className="input"
              placeholder="Or describe the skill you want to build..."
              value={skillPrompt}
              onChange={(e) => setSkillPrompt(e.target.value)}
              style={{ minHeight: 62 }}
            />
            <button
              type="button"
              className="btn-secondary btn-compact"
              disabled={busy || !skillPrompt.trim()}
              onClick={() => void runPromptGraphPipeline()}
            >
              Create graph from prompt
            </button>
          </div>
        </>
      ) : null}

      {err ? <div className="wb-warning" style={{ marginBottom: 10 }}>{err}</div> : null}

      {showImportChrome && (busy || genLogs.length > 0) ? (
        <div style={{ marginBottom: 10 }}>
          <SkillGenerationLogDrawer
            entries={genLogs}
            onClear={() => setGenLogs([])}
            forceOpen={busy || phase === 'error'}
          />
        </div>
      ) : null}

      {showImportChrome && outlinePreview ? (
        <details style={{ marginBottom: 10 }}>
          <summary>Markdown IR</summary>
          <pre className="wb-pipeline-step-output" style={{ maxHeight: 120, overflow: 'auto', fontSize: 11 }}>
            {outlinePreview}
          </pre>
        </details>
      ) : null}

      {showImportChrome ? (
        <div className="work-actions" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px', minWidth: 260 }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Saved skills</div>
            <ul className="skill-saved-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(skillListExpanded ? skillEntries : skillEntries.slice(0, 5)).map((e) => (
                <li
                  key={e.key}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    marginBottom: 4,
                    border: '1px solid var(--border, #444)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600, flex: '1 1 140px' }}>{e.label}</span>
                  <span className="badge" style={{ fontSize: 10 }}>
                    {e.statusLabel}
                  </span>
                  {e.mtimeLabel ? (
                    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{e.mtimeLabel}</span>
                  ) : null}
                  <button type="button" className="btn-secondary btn-compact" onClick={() => void loadSkillEntry(e)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    disabled={!e.mdRelPath || busy}
                    title={e.mdRelPath ? 'Re-run Codex import from skill.md' : 'No skill.md'}
                    onClick={() => void regenerateSkillRow(e)}
                  >
                    Regenerate
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => void deleteSkillRow(e)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            {skillEntries.length > 5 ? (
              <button
                type="button"
                className="btn-secondary btn-compact"
                style={{ marginTop: 6 }}
                onClick={() => setSkillListExpanded((x) => !x)}
              >
                {skillListExpanded ? 'Show fewer' : `Show more (${skillEntries.length - 5} hidden)`}
              </button>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn-secondary btn-compact" onClick={() => void refreshSkillFileList()}>
              Refresh list
            </button>
            {graph ? (
              <button type="button" className="btn-secondary btn-compact" onClick={() => void saveGraph()}>
                Save graph + MD
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {validation && !validation.ok ? (
        <div className="wb-warning" style={{ marginBottom: 8, fontSize: 12 }}>
          Validation: {validation.issues.filter((i) => i.severity === 'error').length} error(s),{' '}
          {validation.issues.filter((i) => i.severity === 'warn').length} warning(s).
        </div>
      ) : null}

      {graph ? (
        portalMaximizedStudioToBody ? createPortal(skillsStudioSubtree!, document.body) : skillsStudioSubtree
      ) : variant === 'standalone' && skillsStudioBootstrapId ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading studio…</p>
      ) : showImportChrome ? (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No graph yet. Run import or load a saved skill.</p>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No graph loaded.</p>
      )}
    </div>
  );
}

export default function SkillsSetupPanel(props: SkillsSetupPanelProps) {
  return (
    <ReactFlowProvider>
      <SkillsSetupInner {...props} />
    </ReactFlowProvider>
  );
}

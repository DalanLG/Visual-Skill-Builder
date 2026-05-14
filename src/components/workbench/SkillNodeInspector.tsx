import { useEffect, useState } from 'react';
import type {
  SkillEdgeKind,
  SkillEdgeSemanticKind,
  SkillEdgeV2,
  SkillFlowGraphV2,
  SkillGroupV2,
  SkillNodeKind,
  SkillNodeV2,
  SkillVariableArtifactKind,
  SkillVariableDataType,
  SkillVariableExportBehavior,
  SkillVariableStorage,
} from '../../lib/skillFlowGraphV2';
import type { SkillTraceSnapshot } from '../../lib/skillFlowTrace';
import type { SkillValidationIssue } from '../../lib/skillFlowValidation';
import { removeUserSkillGroupFromGraph } from '../../lib/skillFlowGraphMutations';
import type { SkillGenerationLogEntry } from './SkillGenerationLogDrawer';

const NODE_KINDS: SkillNodeKind[] = [
  'goal',
  'role',
  'input',
  'output',
  'response',
  'step',
  'rule',
  'note',
  'decision',
  'group',
  'tool',
  'validation',
  'guardrail',
  'example',
  'variable',
];

const EDGE_KINDS: SkillEdgeKind[] = ['sequence', 'depends_on', 'branch', 'parallel'];

const SEMANTIC_KINDS: SkillEdgeSemanticKind[] = [
  'main_flow',
  'dependency',
  'branch',
  'parallel',
  'support',
  'constraint',
  'data_read',
  'data_write',
];

const VARIABLE_DATA_TYPES: SkillVariableDataType[] = ['markdown', 'json', 'text', 'object', 'list', 'unknown'];
const VARIABLE_ARTIFACT_KINDS: SkillVariableArtifactKind[] = [
  'research-report',
  'notes',
  'decision-state',
  'extracted-data',
  'output-draft',
  'custom',
];
const VARIABLE_STORAGE: SkillVariableStorage[] = ['workspace-file', 'in-memory'];

function issuesFor(id: string | null, issues: SkillValidationIssue[]): SkillValidationIssue[] {
  if (!id) return [];
  return issues.filter((i) => i.nodeId === id);
}

function formatGenerationTime(value: string | undefined): string {
  if (!value) return '';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Date(t).toLocaleTimeString();
}

function isPlaceholderResponseExample(value: string): boolean {
  const hay = value.toLowerCase();
  return (
    hay.includes('answer with a concise summary') ||
    hay.includes('start with the direct result') ||
    hay.includes('example response shape') ||
    hay.includes('final recommendation, deliverable')
  );
}

function exampleResponseFallback(graph: SkillFlowGraphV2, contributors: SkillNodeV2[]): string {
  const skillName = graph.name || 'this skill';
  const contributorText = contributors
    .slice(0, 3)
    .map((n) => n.label)
    .join(', ');
  const source = contributorText || 'the completed workflow outputs';
  return `Example: "Summary: ${skillName} finished its workflow and combined ${source}. Result: here is the final recommendation or deliverable, written for the user instead of exposing internal steps. Next action: use this output directly, or review the highlighted source artifacts if you want to adjust it."`;
}

export interface SkillNodeInspectorProps {
  graph: SkillFlowGraphV2 | null;
  selectedNodeId: string | null;
  selectedUserGroupId: string | null;
  selectedEdgeId: string | null;
  validationIssues: SkillValidationIssue[];
  onChangeGraph: (next: SkillFlowGraphV2) => void;
  /** Adds a new step node and edge from the current selection */
  onAppendConnected?: () => void;
  onDeleteNode?: (nodeId: string) => void;
  onRegenerateNode?: (nodeId: string) => void;
  generationLogs?: SkillGenerationLogEntry[];
  traceSnapshot?: SkillTraceSnapshot;
}

export default function SkillNodeInspector({
  graph,
  selectedNodeId,
  selectedUserGroupId,
  selectedEdgeId,
  validationIssues,
  onChangeGraph,
  onAppendConnected,
  onDeleteNode,
  onRegenerateNode,
  generationLogs = [],
  traceSnapshot,
}: SkillNodeInspectorProps) {
  const [draftLabel, setDraftLabel] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftEdgeLabel, setDraftEdgeLabel] = useState('');
  const [draftVarName, setDraftVarName] = useState('');
  const [draftVarLabel, setDraftVarLabel] = useState('');
  const [draftVarDataType, setDraftVarDataType] = useState<SkillVariableDataType>('markdown');
  const [draftVarArtifactKind, setDraftVarArtifactKind] = useState<SkillVariableArtifactKind>('custom');
  const [draftVarStorage, setDraftVarStorage] = useState<SkillVariableStorage>('workspace-file');
  const [draftVarPathTemplate, setDraftVarPathTemplate] = useState('');
  const [draftVarDesc, setDraftVarDesc] = useState('');
  const [draftGroupLabel, setDraftGroupLabel] = useState('');

  const node = selectedNodeId ? graph?.nodes.find((n) => n.id === selectedNodeId) : null;
  const edge = selectedEdgeId ? graph?.edges.find((e) => e.id === selectedEdgeId) : null;
  const userGroup: SkillGroupV2 | null =
    selectedUserGroupId && graph?.groups ? (graph.groups.find((g) => g.id === selectedUserGroupId) ?? null) : null;
  const nodeGenerationLogs = node
    ? generationLogs.filter(
        (entry) =>
          entry.nodeId === node.id ||
          (Boolean(node.generation?.jobId) && entry.jobId === node.generation?.jobId),
      )
    : [];

  useEffect(() => {
    if (!node) return;
    setDraftLabel(node.label);
    setDraftSummary(node.summary ?? '');
    setDraftBody(node.body ?? '');
    setDraftTags((node.tags ?? []).join(', '));
    setDraftVarName(node.variable?.variableName ?? '');
    setDraftVarLabel(node.variable?.label ?? '');
    setDraftVarDataType(node.variable?.dataType ?? 'markdown');
    setDraftVarArtifactKind(node.variable?.artifactKind ?? 'custom');
    setDraftVarStorage(node.variable?.storage ?? 'workspace-file');
    setDraftVarPathTemplate(node.variable?.pathTemplate ?? '');
    setDraftVarDesc(node.variable?.description ?? '');
  }, [selectedNodeId, node?.id]);

  useEffect(() => {
    if (!edge) return;
    setDraftEdgeLabel(edge.label ?? '');
  }, [selectedEdgeId, edge?.id]);

  useEffect(() => {
    if (!userGroup) return;
    setDraftGroupLabel(userGroup.label);
  }, [selectedUserGroupId, userGroup?.id]);

  const updateNode = (id: string, patch: Partial<SkillNodeV2>) => {
    if (!graph) return;
    onChangeGraph({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch, userEditEpoch: Date.now() } : n)),
    });
  };

  const updateEdge = (id: string, patch: Partial<SkillEdgeV2>) => {
    if (!graph) return;
    onChangeGraph({
      ...graph,
      edges: graph.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const flushNodeText = (field: 'label' | 'summary' | 'body' | 'tags') => {
    if (!graph || !node) return;
    if (field === 'label' && draftLabel !== node.label) {
      updateNode(node.id, { label: draftLabel });
      return;
    }
    if (field === 'summary' && draftSummary !== (node.summary ?? '')) {
      updateNode(node.id, { summary: draftSummary || undefined });
      return;
    }
    if (field === 'body' && draftBody !== (node.body ?? '')) {
      updateNode(node.id, { body: draftBody || undefined });
      return;
    }
    if (field === 'tags') {
      const tags = draftTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const prev = node.tags ?? [];
      const same =
        tags.length === prev.length && tags.every((t, i) => t === prev[i]);
      if (!same) {
        updateNode(node.id, { tags: tags.length ? tags : undefined });
      }
    }
  };

  const flushVariableMeta = () => {
    if (!graph || !node || node.kind !== 'variable') return;
    const vn = draftVarName.trim();
    if (!vn) return;
    const nextVar = {
      ...(node.variable ?? { variableName: vn, exportBehavior: 'include-in-markdown' as const }),
      variableName: vn,
      label: draftVarLabel.trim() || undefined,
      dataType: draftVarDataType,
      artifactKind: draftVarArtifactKind,
      storage: draftVarStorage,
      pathTemplate: draftVarPathTemplate.trim() || undefined,
      ...(draftVarDesc.trim() ? { description: draftVarDesc.trim() } : { description: undefined }),
    };
    if (JSON.stringify(nextVar) !== JSON.stringify(node.variable)) {
      updateNode(node.id, { variable: nextVar });
    }
  };

  const flushEdgeLabel = () => {
    if (!graph || !edge) return;
    const next = draftEdgeLabel.trim() || undefined;
    if (next !== (edge.label ?? undefined)) {
      updateEdge(edge.id, { label: next });
    }
  };

  const dataWriteSources =
    graph && node
      ? graph.edges
          .filter((e) => e.target === node.id && e.ui?.semanticKind === 'data_write')
          .map((e) => e.source)
      : [];
  const dataReadTargets =
    graph && node
      ? graph.edges
          .filter((e) => e.source === node.id && e.ui?.semanticKind === 'data_read')
          .map((e) => e.target)
      : [];
  const labelForNodeId = (id: string) => graph?.nodes.find((n) => n.id === id)?.label ?? id;
  const responseContributors =
    graph && node?.kind === 'response'
      ? graph.edges
          .filter((e) => e.target === node.id)
          .map((e) => graph.nodes.find((n) => n.id === e.source))
          .filter((n): n is SkillNodeV2 => Boolean(n))
      : [];
  const responseExamples =
    node?.kind === 'response'
      ? (node.contract?.examples ?? []).filter((x) => !isPlaceholderResponseExample(x))
      : [];
  const responseWorkflowSteps =
    graph && node?.kind === 'response'
      ? graph.nodes
          .filter((n) => !['variable', 'group', 'note', 'response', 'rule', 'guardrail', 'example'].includes(n.kind))
          .sort((a, b) => {
            const la = typeof a.layer === 'number' ? a.layer : 999;
            const lb = typeof b.layer === 'number' ? b.layer : 999;
            if (la !== lb) return la - lb;
            return a.label.localeCompare(b.label);
          })
      : [];
  const responseVariables =
    graph && node?.kind === 'response'
      ? responseContributors.filter((n) => n.kind === 'variable')
      : [];

  if (!graph) {
    return (
      <aside className="skills-flow-inspector">
        <h3>Inspector</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Load or generate a graph to edit nodes.</p>
      </aside>
    );
  }

  if (userGroup && !node) {
    return (
      <aside className="skills-flow-inspector">
        <h3>User group</h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          Visual cluster only — does not change fast-board panels.
        </p>
        <label htmlFor="ug-label">Label</label>
        <input
          id="ug-label"
          className="input"
          value={draftGroupLabel}
          onChange={(e) => setDraftGroupLabel(e.target.value)}
          onBlur={() => {
            if (!graph) return;
            const t = draftGroupLabel.trim();
            if (!t || t === userGroup.label) return;
            onChangeGraph({
              ...graph,
              groups: graph.groups?.map((g) => (g.id === userGroup.id ? { ...g, label: t } : g)),
            });
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {(userGroup.nodeIds ?? []).length} member(s)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => {
              onChangeGraph(removeUserSkillGroupFromGraph(graph, userGroup.id));
            }}
          >
            Ungroup
          </button>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => {
              if (!window.confirm('Remove this group frame only? Nodes stay on the canvas.')) return;
              onChangeGraph(removeUserSkillGroupFromGraph(graph, userGroup.id));
            }}
          >
            Delete group
          </button>
        </div>
      </aside>
    );
  }

  if (node?.kind === 'response') {
    const responseIssues = issuesFor(node.id, validationIssues);
    return (
      <aside className="skills-flow-inspector skills-flow-inspector--response">
        <div className="skill-response-inspector-card skill-response-inspector-card--plain">
          <div className="skill-response-inspector-card__eyebrow">Final AI response</div>
          <div className="skill-response-inspector-card__summary">
            {node.contract?.purpose ?? node.summary ?? 'This is the final answer the AI returns after the skill finishes.'}
          </div>

          <div className="skill-response-inspector-card__section">
            <strong>What the skill does</strong>
            {responseWorkflowSteps.length ? (
              <ol className="skill-response-inspector-card__steps">
                {responseWorkflowSteps.slice(0, 8).map((n) => (
                  <li key={n.id}>
                    <span>{n.label}</span>
                    {n.summary || n.contract?.purpose ? <small>{n.summary ?? n.contract?.purpose}</small> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="skill-response-inspector-card__empty">No workflow steps are connected yet.</div>
            )}
          </div>

          <div className="skill-response-inspector-card__section">
            <strong>What flows into the response</strong>
            {responseContributors.length ? (
              responseContributors.map((n) => (
                <div key={n.id} className="skill-response-inspector-card__item">
                  <span>{n.kind}</span>
                  <div>
                    <b>{n.label}</b>
                    {n.summary || n.variable?.variableName ? (
                      <small>{n.variable?.variableName ?? n.summary}</small>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="skill-response-inspector-card__empty">No incoming contributors yet.</div>
            )}
          </div>

          {responseVariables.length ? (
            <div className="skill-response-inspector-card__section">
              <strong>Variables used in the final answer</strong>
              {responseVariables.map((n) => (
                <div key={n.id} className="skill-response-inspector-card__item">
                  <span>variable</span>
                  <div>
                    <b>{n.variable?.label ?? n.label}</b>
                    <small>{n.variable?.variableName}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="skill-response-inspector-card__section">
            <strong>How the answer should be written</strong>
            {(node.contract?.instructions ?? []).length ? (
              (node.contract?.instructions ?? []).map((x) => <div key={x}>{x}</div>)
            ) : (
              <div>The AI should combine the completed workflow outputs into one clear user-facing answer.</div>
            )}
          </div>

          <div className="skill-response-inspector-card__section">
            <strong>Example response</strong>
            {responseExamples.length ? (
              responseExamples.slice(0, 3).map((x) => <div key={x}>{x}</div>)
            ) : (
              <div>{exampleResponseFallback(graph, responseContributors)}</div>
            )}
          </div>

          {responseIssues.length ? (
            <div className="skill-response-inspector-card__section skill-response-inspector-card__issues">
              <strong>Needs attention</strong>
              {responseIssues.map((i) => (
                <div key={`${i.code}-${i.message}`}>{i.message}</div>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  return (
    <aside className="skills-flow-inspector">
      <h3>Inspector</h3>
      {graph.description !== undefined ? (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{graph.description}</p>
      ) : null}
      {traceSnapshot?.step ? (
        <div className="skill-trace-panel">
          <div className="skill-trace-panel__head">
            <span>Trace</span>
            <span>
              {traceSnapshot.step.index + 1}/{traceSnapshot.steps.length}
            </span>
          </div>
          <div className="skill-trace-panel__title">{traceSnapshot.step.nodeLabel}</div>
          {traceSnapshot.step.inputs.length ? (
            <div>
              <strong>Inputs</strong>
              {traceSnapshot.step.inputs.slice(0, 3).map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          ) : null}
          {traceSnapshot.step.readVariables.length ? (
            <div>
              <strong>Reads</strong> {traceSnapshot.step.readVariables.join(', ')}
            </div>
          ) : null}
          {traceSnapshot.step.outputs.length ? (
            <div>
              <strong>Outputs</strong>
              {traceSnapshot.step.outputs.slice(0, 3).map((x) => (
                <div key={x}>{x}</div>
              ))}
            </div>
          ) : null}
          {traceSnapshot.step.writeVariables.length ? (
            <div>
              <strong>Writes</strong> {traceSnapshot.step.writeVariables.join(', ')}
            </div>
          ) : null}
        </div>
      ) : null}

      {node ? (
        <>
          {node.generation ? (
            <div className={`skill-node-generation-card skill-node-generation-card--${node.generation.status}`}>
              <div className="skill-node-generation-card__header">
                <span>Generation</span>
                <span className="skill-node-generation-card__status">{node.generation.status}</span>
              </div>
              <div className="skill-node-generation-card__meta">
                Started {formatGenerationTime(node.generation.startedAt) || 'unknown'}
                {node.generation.finishedAt ? `, finished ${formatGenerationTime(node.generation.finishedAt)}` : ''}
              </div>
              {node.generation.userPrompt ? (
                <div className="skill-node-generation-card__prompt">{node.generation.userPrompt}</div>
              ) : null}
              {node.generation.error ? (
                <div className="skill-node-generation-card__error">{node.generation.error}</div>
              ) : null}
              <details
                className="skill-node-generation-card__logs"
                open={node.generation.status === 'running' || node.generation.status === 'failed'}
              >
                <summary>Node log ({nodeGenerationLogs.length})</summary>
                <div className="skill-node-generation-card__log-body">
                  {nodeGenerationLogs.length ? (
                    nodeGenerationLogs.map((entry, i) => (
                      <div
                        key={`${entry.ts}-${entry.phase}-${i}`}
                        className={`skill-node-generation-card__log-line skill-node-generation-card__log-line--${entry.level}`}
                      >
                        [{new Date(entry.ts).toLocaleTimeString()}] {entry.phase}: {entry.message}
                      </div>
                    ))
                  ) : (
                    <div className="skill-node-generation-card__empty">No node log entries yet.</div>
                  )}
                </div>
              </details>
              <div className="skill-node-generation-card__actions">
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={!onRegenerateNode}
                  onClick={() => onRegenerateNode?.(node.id)}
                >
                  {node.generation.status === 'running' ? 'Restart generation' : 'Regenerate'}
                </button>
              </div>
            </div>
          ) : null}
          {node.status === 'review' && node.generation ? (
            <div className="wb-warning" style={{ marginBottom: 10, fontSize: 11 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>AI review</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button
                  type="button"
                  className="btn-primary btn-compact"
                  onClick={() =>
                    updateNode(node.id, {
                      status: 'valid',
                      aiWarnings: undefined,
                      generation: node.generation
                        ? {
                            ...node.generation,
                            status: 'succeeded',
                            finishedAt: new Date().toISOString(),
                          }
                        : undefined,
                    })
                  }
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={!onRegenerateNode}
                  onClick={() => onRegenerateNode?.(node.id)}
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={!onDeleteNode}
                  onClick={() => onDeleteNode?.(node.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
          {node.aiWarnings?.length ? (
            <div className="wb-warning" style={{ marginBottom: 10, fontSize: 11 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>AI warnings</div>
              {node.aiWarnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          ) : null}
          <label htmlFor="insp-label">Label</label>
          <input
            id="insp-label"
            className="input"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={() => flushNodeText('label')}
          />
          <label htmlFor="insp-kind">Kind</label>
          <select
            id="insp-kind"
            className="input"
            value={node.kind}
            onChange={(e) => updateNode(node.id, { kind: e.target.value as SkillNodeKind })}
          >
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {node.kind === 'variable' ? (
            <>
              <label htmlFor="insp-varname">Variable name</label>
              <input
                id="insp-varname"
                className="input font-mono"
                value={draftVarName}
                onChange={(e) => setDraftVarName(e.target.value)}
                onBlur={flushVariableMeta}
              />
              <label htmlFor="insp-varlabel">Artifact label</label>
              <input
                id="insp-varlabel"
                className="input"
                value={draftVarLabel}
                onChange={(e) => setDraftVarLabel(e.target.value)}
                onBlur={flushVariableMeta}
              />
              <label htmlFor="insp-vartype">Data type</label>
              <select
                id="insp-vartype"
                className="input"
                value={draftVarDataType}
                onChange={(e) => {
                  setDraftVarDataType(e.target.value as SkillVariableDataType);
                  updateNode(node.id, {
                    variable: {
                      ...(node.variable ?? { variableName: draftVarName || '$var' }),
                      dataType: e.target.value as SkillVariableDataType,
                    },
                  });
                }}
              >
                {VARIABLE_DATA_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <label htmlFor="insp-varkind">Artifact kind</label>
              <select
                id="insp-varkind"
                className="input"
                value={draftVarArtifactKind}
                onChange={(e) => {
                  setDraftVarArtifactKind(e.target.value as SkillVariableArtifactKind);
                  updateNode(node.id, {
                    variable: {
                      ...(node.variable ?? { variableName: draftVarName || '$var' }),
                      artifactKind: e.target.value as SkillVariableArtifactKind,
                    },
                  });
                }}
              >
                {VARIABLE_ARTIFACT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <label htmlFor="insp-varstorage">Storage</label>
              <select
                id="insp-varstorage"
                className="input"
                value={draftVarStorage}
                onChange={(e) => {
                  setDraftVarStorage(e.target.value as SkillVariableStorage);
                  updateNode(node.id, {
                    variable: {
                      ...(node.variable ?? { variableName: draftVarName || '$var' }),
                      storage: e.target.value as SkillVariableStorage,
                    },
                  });
                }}
              >
                {VARIABLE_STORAGE.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <label htmlFor="insp-varpath">Path template</label>
              <input
                id="insp-varpath"
                className="input font-mono"
                value={draftVarPathTemplate}
                onChange={(e) => setDraftVarPathTemplate(e.target.value)}
                onBlur={flushVariableMeta}
              />
              <label htmlFor="insp-vardesc">Variable description</label>
              <textarea
                id="insp-vardesc"
                className="input font-mono"
                rows={2}
                value={draftVarDesc}
                onChange={(e) => setDraftVarDesc(e.target.value)}
                onBlur={flushVariableMeta}
              />
              <label htmlFor="insp-varexport">Export</label>
              <select
                id="insp-varexport"
                className="input"
                value={node.variable?.exportBehavior ?? 'include-in-markdown'}
                onChange={(e) =>
                  updateNode(node.id, {
                    variable: {
                      ...(node.variable ?? { variableName: draftVarName || '$var', exportBehavior: 'include-in-markdown' }),
                      exportBehavior: e.target.value as SkillVariableExportBehavior,
                    },
                  })
                }
              >
                <option value="visual-only">visual-only</option>
                <option value="include-in-markdown">include-in-markdown</option>
              </select>
              <div className="skill-variable-inspector-meta">
                <div>
                  <span>Set by</span>
                  <strong>{(node.variable?.producedBy ?? dataWriteSources).map(labelForNodeId).join(', ') || 'None'}</strong>
                </div>
                <div>
                  <span>Read by</span>
                  <strong>{(node.variable?.consumedBy ?? dataReadTargets).map(labelForNodeId).join(', ') || 'None'}</strong>
                </div>
              </div>
            </>
          ) : null}
          <label htmlFor="insp-summary">Summary</label>
          <textarea
            id="insp-summary"
            className="input font-mono"
            rows={3}
            value={draftSummary}
            onChange={(e) => setDraftSummary(e.target.value)}
            onBlur={() => flushNodeText('summary')}
          />
          <label htmlFor="insp-body">Body</label>
          <textarea
            id="insp-body"
            className="input font-mono"
            rows={6}
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            onBlur={() => flushNodeText('body')}
          />
          <label htmlFor="insp-tags">Tags (comma-separated)</label>
          <input
            id="insp-tags"
            className="input"
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            onBlur={() => flushNodeText('tags')}
          />
          {(node.variableReads?.length || node.variableWrites?.length || dataWriteSources.length || dataReadTargets.length) ? (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
              {node.variableWrites?.length ? (
                <div>
                  <span style={{ fontWeight: 600 }}>Declared writes: </span>
                  {node.variableWrites.join(', ')}
                </div>
              ) : null}
              {node.variableReads?.length ? (
                <div>
                  <span style={{ fontWeight: 600 }}>Declared reads: </span>
                  {node.variableReads.join(', ')}
                </div>
              ) : null}
              {dataWriteSources.length ? (
                <div>
                  <span style={{ fontWeight: 600 }}>SET edges from: </span>
                  {dataWriteSources.join(', ')}
                </div>
              ) : null}
              {dataReadTargets.length ? (
                <div>
                  <span style={{ fontWeight: 600 }}>GET edges to: </span>
                  {dataReadTargets.join(', ')}
                </div>
              ) : null}
            </div>
          ) : null}
          <label htmlFor="insp-layer">Layer hint</label>
          <input
            id="insp-layer"
            className="input"
            type="number"
            value={node.layer ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              updateNode(node.id, { layer: v === '' ? undefined : Number(v) });
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={Boolean(node.ui?.manuallyPositioned)}
              onChange={(e) =>
                updateNode(node.id, {
                  ui: { ...node.ui, manuallyPositioned: e.target.checked },
                })
              }
            />{' '}
            Lock position (skip auto-layout)
          </label>
          {issuesFor(node.id, validationIssues).length ? (
            <div className="wb-warning" style={{ marginTop: 10, fontSize: 11 }}>
              {issuesFor(node.id, validationIssues).map((i) => (
                <div key={`${i.code}-${i.message}`}>{i.message}</div>
              ))}
            </div>
          ) : null}
          {onAppendConnected ? (
            <button type="button" className="btn-secondary btn-compact" style={{ marginTop: 12 }} onClick={onAppendConnected}>
              Add connected step
            </button>
          ) : null}
        </>
      ) : edge ? (
        <>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            Edge <span className="font-mono">{edge.id}</span>
          </div>
          <label htmlFor="insp-elabel">Label</label>
          <input
            id="insp-elabel"
            className="input"
            value={draftEdgeLabel}
            onChange={(e) => setDraftEdgeLabel(e.target.value)}
            onBlur={flushEdgeLabel}
          />
          <label htmlFor="insp-ekind">Kind</label>
          <select
            id="insp-ekind"
            className="input"
            value={edge.kind}
            onChange={(e) => updateEdge(edge.id, { kind: e.target.value as SkillEdgeKind })}
          >
            {EDGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <label htmlFor="insp-esem">Semantic (palette)</label>
          <select
            id="insp-esem"
            className="input"
            value={edge.ui?.semanticKind ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              updateEdge(edge.id, {
                ui: {
                  ...edge.ui,
                  ...(v ? { semanticKind: v as SkillEdgeSemanticKind } : { semanticKind: undefined }),
                },
              });
            }}
          >
            <option value="">(auto / layout)</option>
            {SEMANTIC_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a node or edge on the canvas.</p>
      )}
    </aside>
  );
}

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  SKILL_FLOW_HANDLE_SRC,
  SKILL_FLOW_HANDLE_TGT,
  type SkillFlowRfNodeData,
} from '../../lib/skillFlowRf';

function statusClassForNode(
  status: string | undefined,
  hasErr: boolean,
  hasWarn: boolean,
): string {
  if (status === 'error' || hasErr) return 'skill-flow-node--status-error';
  if (status === 'warning' || hasWarn) return 'skill-flow-node--status-warn';
  if (status === 'generating') return 'skill-flow-node--status-generating';
  if (status === 'review') return 'skill-flow-node--status-review';
  if (status === 'draft') return 'skill-flow-node--status-draft';
  return '';
}

function SkillFlowNode({ data }: NodeProps<Node<SkillFlowRfNodeData>>) {
  const { node, issues, selected } = data;
  const hasErr = issues.some((i) => i.severity === 'error');
  const hasWarn = issues.some((i) => i.severity === 'warn');
  const statusClass = statusClassForNode(node.status, hasErr, hasWarn);
  const kindClass = node.kind === 'variable' ? 'skill-flow-node--kind-variable' : '';
  const generationStatus = node.generation?.status;
  const statusLabel =
    generationStatus === 'running'
      ? 'Generating'
      : generationStatus === 'failed'
        ? 'Failed'
        : node.status === 'review'
          ? 'Review'
          : node.status === 'draft'
            ? 'Draft'
            : node.status === 'error'
              ? 'Error'
              : '';

  return (
    <div
      className={`skill-flow-node ${selected ? 'skill-flow-node--selected' : ''} ${data.traceActive ? 'skill-flow-node--trace-active' : ''} ${statusClass} ${kindClass}`.trim()}
      data-kind={node.kind}
    >
      <Handle type="target" position={Position.Left} id={SKILL_FLOW_HANDLE_TGT.L} className="skill-flow-handle" />
      <Handle type="source" position={Position.Left} id={SKILL_FLOW_HANDLE_SRC.L} className="skill-flow-handle" />
      <Handle type="target" position={Position.Right} id={SKILL_FLOW_HANDLE_TGT.R} className="skill-flow-handle" />
      <Handle type="source" position={Position.Right} id={SKILL_FLOW_HANDLE_SRC.R} className="skill-flow-handle" />
      <Handle type="target" position={Position.Top} id={SKILL_FLOW_HANDLE_TGT.T} className="skill-flow-handle" />
      <Handle type="source" position={Position.Top} id={SKILL_FLOW_HANDLE_SRC.T} className="skill-flow-handle" />
      <Handle type="target" position={Position.Bottom} id={SKILL_FLOW_HANDLE_TGT.B} className="skill-flow-handle" />
      <Handle type="source" position={Position.Bottom} id={SKILL_FLOW_HANDLE_SRC.B} className="skill-flow-handle" />
      <div className="skill-flow-node__header">
        <span className="skill-flow-node__badge">{node.kind}</span>
        {node.variable?.variableName ? (
          <span className="skill-flow-node__var-name" title="Variable name">
            {node.variable.variableName}
          </span>
        ) : null}
        {node.kind === 'variable' && data.variableFlowRole ? (
          <span className={`skill-flow-node__var-role skill-flow-node__var-role--${data.variableFlowRole}`}>
            {data.variableFlowRole === 'set-get'
              ? 'Variable set/get'
              : data.variableFlowRole === 'set'
                ? 'Variable set'
                : 'Variable get'}
          </span>
        ) : null}
        {statusLabel ? <span className="skill-flow-node__status-pill">{statusLabel}</span> : null}
      </div>
      <div className="skill-flow-node__title">{node.label}</div>
      {node.summary ? <div className="skill-flow-node__summary">{node.summary}</div> : null}
      {generationStatus === 'running' ? (
        <div className="skill-flow-node__generation-meter" aria-hidden>
          <span />
        </div>
      ) : null}
      {node.tags?.length ? (
        <div className="skill-flow-node__tags">
          {node.tags.slice(0, 5).map((t) => (
            <span key={t} className="skill-flow-node__tag">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default memo(SkillFlowNode);

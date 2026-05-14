import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { SkillDataArtifactLayoutNode } from '../../lib/skillFlowLayoutPlanV2';
import {
  SKILL_FLOW_HANDLE_SRC,
  SKILL_FLOW_HANDLE_TGT,
} from '../../lib/skillFlowRf';

export type SkillArtifactRfData = {
  artifact: SkillDataArtifactLayoutNode;
};

function SkillArtifactNode({ data }: NodeProps<Node<SkillArtifactRfData>>) {
  const { artifact } = data;

  return (
    <div className="skill-artifact-node" data-artifact-kind={artifact.kind}>
      <Handle type="target" position={Position.Left} id={SKILL_FLOW_HANDLE_TGT.L} className="skill-flow-handle" />
      <Handle type="source" position={Position.Left} id={SKILL_FLOW_HANDLE_SRC.L} className="skill-flow-handle" />
      <Handle type="target" position={Position.Right} id={SKILL_FLOW_HANDLE_TGT.R} className="skill-flow-handle" />
      <Handle type="source" position={Position.Right} id={SKILL_FLOW_HANDLE_SRC.R} className="skill-flow-handle" />
      <Handle type="target" position={Position.Top} id={SKILL_FLOW_HANDLE_TGT.T} className="skill-flow-handle" />
      <Handle type="source" position={Position.Top} id={SKILL_FLOW_HANDLE_SRC.T} className="skill-flow-handle" />
      <Handle type="target" position={Position.Bottom} id={SKILL_FLOW_HANDLE_TGT.B} className="skill-flow-handle" />
      <Handle type="source" position={Position.Bottom} id={SKILL_FLOW_HANDLE_SRC.B} className="skill-flow-handle" />

      <div className="skill-artifact-node__badge">variable</div>
      <div className="skill-artifact-node__title">{artifact.label}</div>
      {artifact.description ? <div className="skill-artifact-node__desc">{artifact.description}</div> : null}
    </div>
  );
}

export default memo(SkillArtifactNode);

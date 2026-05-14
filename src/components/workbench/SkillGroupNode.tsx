import { memo } from 'react';
import { type Node, type NodeProps } from '@xyflow/react';
import type { SkillGroupRfData } from '../../lib/skillFlowRf';

const USER_GROUP_COLORS = new Set([
  'goal',
  'research',
  'decision',
  'scoring',
  'generation',
  'validation',
  'output',
  'response',
  'rules',
  'tools',
  'guardrails',
  'neutral',
  'start',
  'input',
  'analysis',
  'artifact',
  'examples',
  'fallback',
]);

function SkillGroupNode({ data }: NodeProps<Node<SkillGroupRfData>>) {
  if (data.variant === 'user') {
    const { userGroup, nodeCount } = data;
    const ckRaw = userGroup.colorKey ?? 'neutral';
    const ck = USER_GROUP_COLORS.has(ckRaw) ? ckRaw : 'neutral';
    const k = `skill-group skill-group--${ck}`;

    return (
      <div className={k} data-group-kind="user-cluster">
        <div className="skill-group__header">
          <span className="skill-group__badge">Cluster</span>
          <span className="skill-group__title">{userGroup.label}</span>
          <span className="skill-group__count">{nodeCount} nodes</span>
        </div>
        {userGroup.description ? <div className="skill-group__desc">{userGroup.description}</div> : null}
      </div>
    );
  }

  const { group, nodeCount } = data;
  const k = `skill-group skill-group--${group.visual.colorKey}`;

  return (
    <div className={k} data-group-kind={group.kind}>
      <div className="skill-group__header">
        <span className="skill-group__badge">{group.kind}</span>
        <span className="skill-group__title">{group.label}</span>
        <span className="skill-group__count">{nodeCount} nodes</span>
      </div>
      {group.description ? <div className="skill-group__desc">{group.description}</div> : null}
    </div>
  );
}

export default memo(SkillGroupNode);

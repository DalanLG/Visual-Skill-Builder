import { describe, expect, it } from 'vitest';
import { validateSkillFlowGraphV2 } from './skillFlowValidation';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';

const base = (): SkillFlowGraphV2 => ({
  version: SKILL_FLOW_GRAPH_V2_VERSION,
  id: 'g1',
  name: 'G',
  nodes: [{ id: 'a', label: 'A', kind: 'step' }],
  edges: [],
});

describe('validateSkillFlowGraphV2', () => {
  it('flags duplicate node ids', () => {
    const g: SkillFlowGraphV2 = {
      ...base(),
      nodes: [
        { id: 'dup', label: 'One', kind: 'step' },
        { id: 'dup', label: 'Two', kind: 'step' },
      ],
    };
    const r = validateSkillFlowGraphV2(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'duplicate_node_id')).toBe(true);
  });

  it('passes minimal valid graph', () => {
    const r = validateSkillFlowGraphV2(base());
    expect(r.ok).toBe(true);
  });
});

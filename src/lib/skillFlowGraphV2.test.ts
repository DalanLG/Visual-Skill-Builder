import { describe, expect, it } from 'vitest';
import { migrateSkillFlowGraphV1ToV2, SKILL_FLOW_GRAPH_V2_VERSION } from './skillFlowGraphV2';
import type { SkillFlowGraphV1 } from './skillFlowGraph';

describe('migrateSkillFlowGraphV1ToV2', () => {
  it('maps nodes and edges', () => {
    const v1: SkillFlowGraphV1 = {
      version: 1,
      name: 'My Skill',
      description: 'desc',
      nodes: [
        { id: 'n1', label: 'First', description: 'Long body text' },
        { id: 'n2', label: 'Second' },
      ],
      edges: [{ id: 'x', source: 'n1', target: 'n2' }],
    };
    const v2 = migrateSkillFlowGraphV1ToV2(v1);
    expect(v2.version).toBe(SKILL_FLOW_GRAPH_V2_VERSION);
    expect(v2.name).toBe('My Skill');
    expect(v2.nodes).toHaveLength(2);
    expect(v2.edges[0]?.kind).toBe('sequence');
    expect(v2.nodes[0]?.kind).toBe('step');
  });
});

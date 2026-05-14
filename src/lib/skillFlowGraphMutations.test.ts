import { describe, it, expect } from 'vitest';
import type { SkillFlowGraphV2 } from './skillFlowGraphV2';
import { hitTestLayoutGroupAtFlowPoint } from './skillFlowRf';
import { applyGeneratedPatchToNode } from './skillFlowGeneratedNode';
import {
  connectExistingSkillNodes,
  connectVariableRead,
  createGeneratingPlaceholderNode,
  createSkillNodeFromRadialPick,
  deleteSkillNodeFromGraph,
  insertSkillNodeOnEdge,
  prepareSkillNodeRegeneration,
} from './skillFlowGraphMutations';

describe('hitTestLayoutGroupAtFlowPoint', () => {
  it('returns null when no layout plan', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
    };
    expect(hitTestLayoutGroupAtFlowPoint(graph, 50, 50)).toBeNull();
  });
});

describe('createSkillNodeFromRadialPick', () => {
  it('sets groupId when layoutGroupPlanId is a fast-board panel id', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
    };
    const { graph: next } = createSkillNodeFromRadialPick(graph, {
      flowX: 100,
      flowY: 200,
      kind: 'rule',
      layoutGroupPlanId: 'fb-main',
    });
    const created = next.nodes.find((n) => n.id !== 'a');
    expect(created?.groupId).toBe('fb-main');
  });

  it('centers the created node on the pointer and locks the position', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [],
      edges: [],
    };
    const { graph: next } = createSkillNodeFromRadialPick(graph, {
      flowX: 400,
      flowY: 300,
      kind: 'note',
    });
    const created = next.nodes[0];
    expect(created.ui?.x).toBe(290);
    expect(created.ui?.y).toBe(252);
    expect(created.ui?.manuallyPositioned).toBe(true);
    expect(created.groupId).toBeUndefined();
  });

  it('adds created nodes to layout metadata only when dropped inside a group', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
      layout: {
        strategy: 'fast-board',
        orientation: 'left-to-right',
        layoutPlan: {
          version: '2.0',
          graphId: 'g1',
          strategy: 'grouped-workflow',
          orientation: 'left-to-right',
          intent: 'test',
          groups: [
            {
              id: 'fb-main',
              label: 'Workflow',
              kind: 'generation',
              nodeIds: ['a'],
              order: 0,
              laneId: 'lane-main',
              layoutRole: 'main-panel',
              visual: { colorKey: 'generation', emphasis: 'primary' },
            },
          ],
          lanes: [{ id: 'lane-main', label: 'Main', kind: 'main-flow', order: 0 }],
          nodeAssignments: [
            {
              nodeId: 'a',
              groupId: 'fb-main',
              laneId: 'lane-main',
              role: 'main-step',
              layer: 0,
              order: 0,
              placement: 'inside-group',
              visualEmphasis: 'primary',
            },
          ],
          edgePlans: [],
          mainPath: ['a'],
        },
      },
    };

    const { graph: next, newNodeId } = createSkillNodeFromRadialPick(graph, {
      flowX: 100,
      flowY: 120,
      kind: 'note',
      layoutGroupPlanId: 'fb-main',
    });

    const plan = next.layout?.layoutPlan;
    expect(plan && 'groups' in plan ? plan.groups[0].nodeIds : []).toContain(newNodeId);
    expect(plan && 'nodeAssignments' in plan ? plan.nodeAssignments.find((a) => a.nodeId === newNodeId)?.groupId : undefined).toBe('fb-main');
  });

  it('increments layer from source using (layer ?? 0) + 1', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', layer: undefined, ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
    };
    const { graph: next } = createSkillNodeFromRadialPick(graph, {
      flowX: 50,
      flowY: 50,
      kind: 'step',
      sourceNodeId: 'a',
    });
    const created = next.nodes.find((n) => n.id !== 'a');
    expect(created?.layer).toBe(1);
  });

  it('creates a canonical draft contract for blank radial nodes', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [],
      edges: [],
    };
    const { graph: next } = createSkillNodeFromRadialPick(graph, {
      flowX: 50,
      flowY: 50,
      kind: 'output',
      initialStatus: 'draft',
    });
    expect(next.nodes[0].contract?.purpose).toBeTruthy();
    expect(next.nodes[0].body).toContain('Purpose');
  });

  it('uses data_read when the radial pick is Get variable', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', layer: 2, ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
    };
    const { graph: next, newNodeId } = createSkillNodeFromRadialPick(graph, {
      flowX: 50,
      flowY: 50,
      kind: 'variable',
      variableMode: 'read',
      sourceNodeId: 'a',
    });
    const edge = next.edges.find((e) => e.source === newNodeId && e.target === 'a');
    expect(edge?.ui?.semanticKind).toBe('data_read');
    expect(next.nodes.find((n) => n.id === newNodeId)?.variable?.exportBehavior).toBe('include-in-markdown');
  });

  it('uses data_write when the radial pick is Set variable', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [{ id: 'a', label: 'A', kind: 'step', layer: 2, ui: { x: 0, y: 0, width: 220, height: 96 } }],
      edges: [],
    };
    const { graph: next, newNodeId } = createSkillNodeFromRadialPick(graph, {
      flowX: 50,
      flowY: 50,
      kind: 'variable',
      variableMode: 'write',
      sourceNodeId: 'a',
    });
    const edge = next.edges.find((e) => e.source === 'a' && e.target === newNodeId);
    expect(edge?.ui?.semanticKind).toBe('data_write');
  });
});

describe('deleteSkillNodeFromGraph', () => {
  it('removes node and incident edges', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'b', label: 'B', kind: 'step', ui: { x: 300, y: 0, width: 220, height: 96 } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'depends_on' }],
    };
    const next = deleteSkillNodeFromGraph(graph, 'b');
    expect(next.nodes.map((n) => n.id)).toEqual(['a']);
    expect(next.edges).toHaveLength(0);
  });
});

describe('connection mutation helpers', () => {
  it('connects existing nodes and rejects duplicate/self links', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'b', label: 'B', kind: 'decision', ui: { x: 300, y: 0, width: 220, height: 96 } },
      ],
      edges: [],
    };

    const connected = connectExistingSkillNodes(graph, 'a', 'b');
    expect(connected.changed).toBe(true);
    expect(connected.edgeId).toBeTruthy();
    expect(connected.graph.edges.some((e) => e.source === 'a' && e.target === 'b' && e.ui?.semanticKind === 'branch')).toBe(true);
    expect(connected.graph.nodes.some((n) => n.kind === 'response')).toBe(true);

    const dup = connectExistingSkillNodes(connected.graph, 'a', 'b');
    expect(dup.changed).toBe(false);
    expect(dup.reason).toBe('duplicate');

    const self = connectExistingSkillNodes(connected.graph, 'a', 'a');
    expect(self.changed).toBe(false);
    expect(self.reason).toBe('self-edge');
  });

  it('connects an existing variable as a data_read without creating a new variable node', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [
        {
          id: 'var-a',
          label: 'Research',
          kind: 'variable',
          variable: { variableName: '$research_report', exportBehavior: 'include-in-markdown' },
          ui: { x: 0, y: 0, width: 220, height: 96 },
        },
        { id: 'consumer', label: 'Use research', kind: 'step', ui: { x: 300, y: 0, width: 220, height: 96 } },
      ],
      edges: [],
    };

    const next = connectVariableRead(graph, 'var-a', 'consumer');
    expect(next.changed).toBe(true);
    expect(next.graph.nodes.filter((n) => n.kind === 'variable')).toHaveLength(1);
    expect(next.graph.edges[0]).toMatchObject({ source: 'var-a', target: 'consumer', ui: { semanticKind: 'data_read' } });
    expect(next.graph.nodes.find((n) => n.id === 'consumer')?.contract?.reads).toContain('$research_report');
  });

  it('splits an edge when inserting a node on it', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [
        { id: 'a', label: 'A', kind: 'step', ui: { x: 0, y: 0, width: 220, height: 96 } },
        { id: 'b', label: 'B', kind: 'step', ui: { x: 300, y: 0, width: 220, height: 96 } },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', kind: 'depends_on', ui: { semanticKind: 'dependency' } }],
    };

    const inserted = insertSkillNodeOnEdge(graph, {
      edgeId: 'e1',
      flowX: 180,
      flowY: 40,
      kind: 'validation',
      initialStatus: 'draft',
    });

    expect(inserted.changed).toBe(true);
    expect(inserted.newNodeId).toBeTruthy();
    expect(inserted.graph.edges.some((e) => e.id === 'e1')).toBe(false);
    expect(inserted.graph.edges.some((e) => e.source === 'a' && e.target === inserted.newNodeId)).toBe(true);
    expect(inserted.graph.edges.some((e) => e.source === inserted.newNodeId && e.target === 'b')).toBe(true);
    expect(inserted.graph.nodes.some((n) => n.kind === 'response')).toBe(true);
  });
});

describe('node generation lifecycle metadata', () => {
  it('does not treat the generated placeholder as a manual edit', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [],
      edges: [],
    };
    const started = Date.now();
    const { graph: next, newNodeId } = createGeneratingPlaceholderNode(graph, {
      flowX: 100,
      flowY: 120,
      kind: 'decision',
      userPrompt: 'choose a path',
      jobId: 'job-1',
    });

    const node = next.nodes.find((n) => n.id === newNodeId);
    expect(node?.userEditEpoch).toBeUndefined();

    const patched = applyGeneratedPatchToNode(
      next,
      newNodeId,
      {
        kind: 'decision',
        label: 'Choose path',
        summary: 'Select the next workflow path.',
        body: 'Use the available context to choose the next path.',
      },
      { jobStartedAtMs: started },
    );

    const filled = patched.nodes.find((n) => n.id === newNodeId);
    expect(filled?.status).toBe('review');
    expect(filled?.generation?.status).toBe('succeeded');
  });

  it('does not bump userEditEpoch when restarting generation', () => {
    const graph: SkillFlowGraphV2 = {
      version: '2.0',
      id: 'g1',
      name: 't',
      nodes: [
        {
          id: 'a',
          label: 'Failed decision',
          kind: 'decision',
          status: 'error',
          userEditEpoch: 123,
          generation: {
            jobId: 'old-job',
            status: 'failed',
            requestedKind: 'decision',
            userPrompt: 'choose a path',
            startedAt: new Date(0).toISOString(),
            error: 'Previous failure',
          },
        },
      ],
      edges: [],
    };

    const next = prepareSkillNodeRegeneration(graph, 'a', 'new-job');
    const node = next?.nodes[0];
    expect(node?.status).toBe('generating');
    expect(node?.generation?.jobId).toBe('new-job');
    expect(node?.userEditEpoch).toBe(123);
  });
});

import { describe, expect, it } from 'vitest';
import {
  RESPONSE_EDGE_STROKE,
  VARIABLE_READ_EDGE_STROKE,
  VARIABLE_WRITE_EDGE_STROKE,
  resolveEdgeVisual,
} from './skillFlowEdgeStyles';
import type { SkillEdgeV2 } from './skillFlowGraphV2';

describe('resolveEdgeVisual', () => {
  it('renders response-target edges purple before semantic styling', () => {
    const edge: SkillEdgeV2 = {
      id: 'e-response',
      source: 'var-report',
      target: 'response',
      kind: 'depends_on',
      ui: { semanticKind: 'data_read', layoutColorKey: 'response' },
    };

    const visual = resolveEdgeVisual(edge, undefined, { selectedNodeId: null, fadeUnrelated: false });
    expect(visual.stroke).toBe(RESPONSE_EDGE_STROKE);
    expect(visual.strokeWidth).toBeGreaterThan(3);
    expect(visual.showLabel).toBe(true);
  });

  it('uses distinct variable write and read colors', () => {
    const write = resolveEdgeVisual(
      { id: 'write', source: 'step', target: 'var', kind: 'depends_on', ui: { semanticKind: 'data_write' } },
      undefined,
      { selectedNodeId: null, fadeUnrelated: false },
    );
    const read = resolveEdgeVisual(
      { id: 'read', source: 'var', target: 'step', kind: 'depends_on', ui: { semanticKind: 'data_read' } },
      undefined,
      { selectedNodeId: null, fadeUnrelated: false },
    );

    expect(write.stroke).toBe(VARIABLE_WRITE_EDGE_STROKE);
    expect(read.stroke).toBe(VARIABLE_READ_EDGE_STROKE);
    expect(write.strokeDasharray).toBeTruthy();
    expect(read.strokeDasharray).toBeUndefined();
  });
});

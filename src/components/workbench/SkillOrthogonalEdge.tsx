import { Fragment, memo } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import {
  orthogonalPathHorizontalFirst,
  orthogonalPathVerticalFirst,
} from '../../lib/skillFlowOrthogonalEdgePath';
import type { OrthogonalRoutingPrimary } from '../../lib/skillFlowLayoutRouting';

export type SkillOrthogonalEdgeData = {
  points?: { x: number; y: number }[];
  renderMode?: 'interactive' | 'settled';
  /** Matches settled routing — keeps drag preview aligned with obstacle-aware path shape. */
  laneMidOffset?: number;
  routingPrimary?: OrthogonalRoutingPrimary;
  /** Variable bus edges only: `read` draws a junction dot at the variable end (see stroke colour). */
  variableEdgeRole?: 'write' | 'read';
  /** Play-mode data-flow packet animation. */
  traceFlow?: 'active' | 'pulse';
  tracePacketIndex?: number;
};

const VARIABLE_BUS_STROKE = '#8fd3e8';
const EDGE_CORNER_RADIUS = 14;
const POINT_EPS = 1.5;

function strokeFromEdgeProps(props: EdgeProps): string {
  const st = props.style;
  if (st && typeof st === 'object' && 'stroke' in st && typeof (st as { stroke?: unknown }).stroke === 'string') {
    return (st as { stroke: string }).stroke;
  }
  return VARIABLE_BUS_STROKE;
}

function svgIdFromEdgeId(edgeId: string): string {
  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) {
    hash = (hash * 31 + edgeId.charCodeAt(i)) >>> 0;
  }
  return `skill-flow-packet-path-${edgeId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${hash.toString(36)}`;
}

function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const total = points.slice(1).reduce((sum, p, index) => {
    const prev = points[index];
    return sum + Math.hypot(p.x - prev.x, p.y - prev.y);
  }, 0);
  if (total <= 0) return points[Math.floor(points.length / 2)];
  let walked = 0;
  const target = total / 2;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const len = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (walked + len >= target) {
      const t = len > 0 ? (target - walked) / len : 0;
      return {
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
      };
    }
    walked += len;
  }
  return points[points.length - 1];
}

export function simplifyRoutedPoints(points: { x: number; y: number }[], eps = POINT_EPS): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  const deduped: { x: number; y: number }[] = [];
  for (const p of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) deduped.push(p);
  }
  if (deduped.length <= 2) return deduped;
  const simplified: { x: number; y: number }[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const a = simplified[simplified.length - 1];
    const b = deduped[i];
    const c = deduped[i + 1];
    const sameX = Math.abs(a.x - b.x) <= eps && Math.abs(b.x - c.x) <= eps;
    const sameY = Math.abs(a.y - b.y) <= eps && Math.abs(b.y - c.y) <= eps;
    if (!sameX && !sameY) simplified.push(b);
  }
  simplified.push(deduped[deduped.length - 1]);
  return simplified;
}

export function roundedPolylinePath(pointsIn: { x: number; y: number }[], radius = EDGE_CORNER_RADIUS): string {
  const points = simplifyRoutedPoints(pointsIn);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const prevLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const nextLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, prevLen / 2, nextLen / 2);
    if (r <= 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const before = {
      x: cur.x + ((prev.x - cur.x) / prevLen) * r,
      y: cur.y + ((prev.y - cur.y) / prevLen) * r,
    };
    const after = {
      x: cur.x + ((next.x - cur.x) / nextLen) * r,
      y: cur.y + ((next.y - cur.y) / nextLen) * r,
    };
    d += ` L ${before.x} ${before.y} Q ${cur.x} ${cur.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function SkillOrthogonalEdge(props: EdgeProps) {
  const data = props.data as SkillOrthogonalEdgeData | undefined;
  const mode = data?.renderMode ?? 'settled';
  const pts = data?.points;

  let pathD: string;
  let packetPoints: { x: number; y: number }[];
  if (mode === 'interactive') {
    const lane = data?.laneMidOffset ?? 0;
    const prim = data?.routingPrimary ?? 'horizontal';
    const ip =
      prim === 'vertical'
        ? orthogonalPathVerticalFirst(
            props.sourceX,
            props.sourceY,
            props.targetX,
            props.targetY,
            lane * 0.28,
          )
        : orthogonalPathHorizontalFirst(
            props.sourceX,
            props.sourceY,
            props.targetX,
            props.targetY,
            lane,
          );
    packetPoints = ip;
    pathD = roundedPolylinePath(ip);
  } else if (pts && pts.length >= 2) {
    packetPoints = simplifyRoutedPoints(pts);
    pathD = roundedPolylinePath(pts);
  } else {
    packetPoints = [
      { x: props.sourceX, y: props.sourceY },
      { x: props.targetX, y: props.targetY },
    ];
    pathD = `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`;
  }

  const dotFill = strokeFromEdgeProps(props);
  const readJunction = data?.variableEdgeRole === 'read';
  const traceFlow = data?.traceFlow;
  const packetIndex = data?.tracePacketIndex ?? 0;
  const packetPathId = svgIdFromEdgeId(props.id);
  const packetRadius = traceFlow === 'active' ? 6 : 5;
  const packetDuration = traceFlow === 'active' ? '1.25s' : '1.55s';
  const packetDelay = `${-(packetIndex % 5) * 0.18}s`;
  const staticPoint = midpoint(packetPoints);

  return (
    <Fragment>
      <BaseEdge
        id={props.id}
        path={pathD}
        style={props.style}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        interactionWidth={props.interactionWidth}
      />
      {traceFlow ? (
        <g
          className={`skill-flow-packet-layer skill-flow-packet-layer--${traceFlow}`}
          pointerEvents="none"
          aria-hidden
        >
          <path id={packetPathId} d={pathD} className="skill-flow-packet-motion-path" />
          <g className="skill-flow-packet skill-flow-packet--animated">
            <animateMotion
              dur={packetDuration}
              begin={packetDelay}
              repeatCount="indefinite"
              rotate="auto"
            >
              <mpath href={`#${packetPathId}`} />
            </animateMotion>
            <circle r={packetRadius} fill={dotFill} className="skill-flow-packet__dot" />
            <path
              d={`M ${packetRadius + 2} 0 L ${Math.max(1.5, packetRadius - 2)} ${Math.max(2.5, packetRadius - 3)} L ${Math.max(1.5, packetRadius - 2)} ${-Math.max(2.5, packetRadius - 3)} Z`}
              fill={dotFill}
              className="skill-flow-packet__arrow"
            />
          </g>
          <g
            className="skill-flow-packet skill-flow-packet--static"
            transform={`translate(${staticPoint.x} ${staticPoint.y})`}
          >
            <circle r={packetRadius} fill={dotFill} className="skill-flow-packet__dot" />
            <path
              d={`M ${packetRadius + 2} 0 L ${Math.max(1.5, packetRadius - 2)} ${Math.max(2.5, packetRadius - 3)} L ${Math.max(1.5, packetRadius - 2)} ${-Math.max(2.5, packetRadius - 3)} Z`}
              fill={dotFill}
              className="skill-flow-packet__arrow"
            />
          </g>
        </g>
      ) : null}
      {readJunction ? (
        <circle
          cx={props.sourceX}
          cy={props.sourceY}
          r={10}
          fill={dotFill}
          stroke="rgba(0, 0, 0, 0.38)"
          strokeWidth={1.25}
          className="skill-var-read-junction"
          pointerEvents="none"
        />
      ) : null}
    </Fragment>
  );
}

export default memo(SkillOrthogonalEdge);

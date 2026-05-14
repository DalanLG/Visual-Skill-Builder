import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

export type SkillEdgeRenderMode = 'interactive' | 'settled';

export type SkillRoutedEdgeData = {
  points?: { x: number; y: number }[];
  /** During canvas drag, use live handles — avoids lag vs frozen obstacle polylines */
  renderMode?: SkillEdgeRenderMode;
};

export default function SkillRoutedEdge(props: EdgeProps) {
  const data = props.data as SkillRoutedEdgeData | undefined;
  const mode = data?.renderMode ?? 'settled';
  const pts = data?.points;

  let pathD: string;
  if (mode === 'interactive') {
    const [path] = getSmoothStepPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
    });
    pathD = path;
  } else if (pts && pts.length >= 2) {
    pathD = `M ${pts[0].x} ${pts[0].y}${pts
      .slice(1)
      .map((p) => ` L ${p.x} ${p.y}`)
      .join('')}`;
  } else {
    pathD = `M ${props.sourceX} ${props.sourceY} L ${props.targetX} ${props.targetY}`;
  }

  return (
    <BaseEdge
      id={props.id}
      path={pathD}
      style={props.style}
      markerEnd={props.markerEnd}
      markerStart={props.markerStart}
      interactionWidth={props.interactionWidth}
    />
  );
}

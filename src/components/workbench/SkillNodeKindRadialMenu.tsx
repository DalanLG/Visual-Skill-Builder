import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { SkillNodeKind } from '../../lib/skillFlowGraphV2';
import './skill-flow.css';

type MenuLeaf = {
  kind: SkillNodeKind;
  title: string;
  short: string;
  icon: string;
  action?: 'get-variable' | 'set-variable' | 'default';
};

type MenuCategory = {
  id: string;
  title: string;
  short: string;
  icon: string;
  accent: string;
  tint: string;
  items: MenuLeaf[];
};

const MENU_SIZE = 700;
const CENTER = MENU_SIZE / 2;
const INNER_RADIUS = 112;
const OUTER_RADIUS = 208;
const LABEL_RADIUS = 158;
const COMMAND_RADIUS = 286;
const CATEGORY_GAP_DEG = 0;

const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: 'flow',
    title: 'Flow',
    short: 'Flow',
    icon: '->',
    accent: '#78b56f',
    tint: 'rgba(120, 181, 111, 0.14)',
    items: [
      { kind: 'step', title: 'Step', short: 'Step', icon: '+' },
      { kind: 'decision', title: 'Decision', short: 'Decide', icon: '?' },
      { kind: 'group', title: 'Group node', short: 'Group', icon: '[]' },
    ],
  },
  {
    id: 'context',
    title: 'Context',
    short: 'Ctx',
    icon: '@',
    accent: '#6fb3a5',
    tint: 'rgba(111, 179, 165, 0.14)',
    items: [
      { kind: 'goal', title: 'Goal', short: 'Goal', icon: '*' },
      { kind: 'role', title: 'Role', short: 'Role', icon: 'R' },
      { kind: 'note', title: 'Note', short: 'Note', icon: 'N' },
    ],
  },
  {
    id: 'io',
    title: 'Input / Output',
    short: 'I/O',
    icon: 'IO',
    accent: '#d1b762',
    tint: 'rgba(209, 183, 98, 0.14)',
    items: [
      { kind: 'input', title: 'Input', short: 'Input', icon: 'IN' },
      { kind: 'output', title: 'Output', short: 'Output', icon: 'OUT' },
      { kind: 'response', title: 'Response', short: 'Response', icon: 'AI' },
    ],
  },
  {
    id: 'variables',
    title: 'Variables',
    short: 'Vars',
    icon: '$',
    accent: '#93b7c1',
    tint: 'rgba(147, 183, 193, 0.14)',
    items: [
      { kind: 'variable', title: 'Set variable', short: 'Set var', icon: 'SET', action: 'set-variable' },
      { kind: 'variable', title: 'Get variable', short: 'Get var', icon: 'GET', action: 'get-variable' },
    ],
  },
  {
    id: 'rules',
    title: 'Rules',
    short: 'Rules',
    icon: '!',
    accent: '#d1b762',
    tint: 'rgba(209, 183, 98, 0.14)',
    items: [
      { kind: 'rule', title: 'Rule', short: 'Rule', icon: 'R' },
      { kind: 'validation', title: 'Validation', short: 'Check', icon: 'V' },
      { kind: 'guardrail', title: 'Guardrail', short: 'Guard', icon: 'G' },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    short: 'Tools',
    icon: '{}',
    accent: '#c97979',
    tint: 'rgba(201, 121, 121, 0.14)',
    items: [
      { kind: 'tool', title: 'Tool', short: 'Tool', icon: 'T' },
      { kind: 'example', title: 'Example', short: 'Example', icon: 'Ex' },
      { kind: 'note', title: 'Custom', short: 'Custom', icon: 'C' },
    ],
  },
];

export type SkillNodeKindRadialMenuProps = {
  screenX: number;
  screenY: number;
  onPick: (kind: SkillNodeKind, action?: MenuLeaf['action']) => void;
  onDismiss: () => void;
};

function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(a),
    y: CENTER + radius * Math.sin(a),
  };
}

function ringSegmentPath(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const outerStart = polarPoint(outerRadius, startAngle);
  const outerEnd = polarPoint(outerRadius, endAngle);
  const innerEnd = polarPoint(innerRadius, endAngle);
  const innerStart = polarPoint(innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function menuOrigin(screenX: number, screenY: number): { left: number; top: number } {
  if (typeof window === 'undefined') {
    return { left: screenX - MENU_SIZE / 2, top: screenY - MENU_SIZE / 2 };
  }
  const pad = 12;
  const maxLeft = Math.max(pad, window.innerWidth - MENU_SIZE - pad);
  const maxTop = Math.max(pad, window.innerHeight - MENU_SIZE - pad);
  const left = Math.min(Math.max(screenX - MENU_SIZE / 2, pad), maxLeft);
  const top = Math.min(Math.max(screenY - MENU_SIZE / 2, pad), maxTop);
  return { left, top };
}

function subCommandAngles(mid: number, count: number): number[] {
  if (count <= 1) return [mid];
  const spread = Math.min(76, Math.max(28, (count - 1) * 28));
  return Array.from({ length: count }, (_, i) => mid - spread / 2 + (i * spread) / (count - 1));
}

/** Nested circular type picker opened from canvas / node context / handle drag. */
export default function SkillNodeKindRadialMenu({ screenX, screenY, onPick, onDismiss }: SkillNodeKindRadialMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeCategoryId, setActiveCategoryId] = useState(MENU_CATEGORIES[0].id);
  const [hoveredLeaf, setHoveredLeaf] = useState<MenuLeaf | null>(null);
  const categoryStep = 360 / MENU_CATEGORIES.length;
  const activeCategory = MENU_CATEGORIES.find((c) => c.id === activeCategoryId) ?? MENU_CATEGORIES[0];
  const activeIndex = Math.max(0, MENU_CATEGORIES.findIndex((c) => c.id === activeCategory.id));
  const origin = menuOrigin(screenX, screenY);

  const activateCategory = useCallback((id: string) => {
    setActiveCategoryId(id);
    setHoveredLeaf(null);
  }, []);

  const segments = useMemo(
    () =>
      MENU_CATEGORIES.map((category, i) => {
        const start = -90 + i * categoryStep;
        const end = start + categoryStep;
        const mid = start + categoryStep / 2;
        return {
          category,
          start,
          end,
          mid,
          path: ringSegmentPath(INNER_RADIUS, OUTER_RADIUS, start + CATEGORY_GAP_DEG, end - CATEGORY_GAP_DEG),
          labelPoint: polarPoint(LABEL_RADIUS, mid),
        };
      }),
    [categoryStep],
  );

  const activeSegment = segments[activeIndex] ?? segments[0];
  const commandAngles = subCommandAngles(activeSegment.mid, activeCategory.items.length);
  const commands = activeCategory.items.map((item, i) => {
    const angle = commandAngles[i] ?? activeSegment.mid;
    return {
      item,
      angle,
      point: polarPoint(COMMAND_RADIUS, angle),
      railStart: polarPoint(OUTER_RADIUS - 8, angle),
      railEnd: polarPoint(COMMAND_RADIUS - 10, angle),
    };
  });

  const hubLeaf = hoveredLeaf ?? activeCategory.items[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        activateCategory(MENU_CATEGORIES[(activeIndex + 1) % MENU_CATEGORIES.length].id);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        activateCategory(MENU_CATEGORIES[(activeIndex - 1 + MENU_CATEGORIES.length) % MENU_CATEGORIES.length].id);
        return;
      }
      if (e.key === 'Enter' && hubLeaf) {
        e.preventDefault();
        onPick(hubLeaf.kind, hubLeaf.action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activateCategory, activeIndex, hubLeaf, onDismiss, onPick]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el?.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener('mousedown', onPointer, true);
    return () => window.removeEventListener('mousedown', onPointer, true);
  }, [onDismiss]);

  const activeStyle = {
    '--skill-radial-accent': activeCategory.accent,
    '--skill-radial-tint': activeCategory.tint,
  } as CSSProperties;

  const ui = (
    <>
      <button
        type="button"
        className="skill-node-kind-radial-backdrop"
        aria-hidden
        tabIndex={-1}
        onClick={onDismiss}
      />
      <div
        ref={rootRef}
        className="skill-node-kind-radial-shell skill-node-kind-radial-shell--command"
        role="menu"
        aria-label="Add node type"
        style={{
          position: 'fixed',
          left: origin.left,
          top: origin.top,
          zIndex: 10100,
          pointerEvents: 'auto',
          ...activeStyle,
        }}
      >
        <svg className="skill-node-kind-radial-svg" viewBox={`0 0 ${MENU_SIZE} ${MENU_SIZE}`} aria-hidden>
          {commands.map(({ item, railStart, railEnd }, i) => (
            <line
              key={`rail-${activeCategory.id}-${item.kind}`}
              x1={railStart.x}
              y1={railStart.y}
              x2={railEnd.x}
              y2={railEnd.y}
              className="skill-node-kind-radial-command-rail"
              style={{ '--delay': `${90 + i * 34}ms` } as CSSProperties}
            />
          ))}
          {segments.map(({ category, path }, i) => {
            const active = category.id === activeCategory.id;
            return (
              <path
                key={category.id}
                d={path}
                className={`skill-node-kind-radial-wedge${active ? ' skill-node-kind-radial-wedge--active' : ''}`}
                style={
                  {
                    '--skill-radial-accent': category.accent,
                    '--skill-radial-tint': category.tint,
                    '--delay': `${i * 24}ms`,
                  } as CSSProperties
                }
                onMouseEnter={() => activateCategory(category.id)}
                onClick={() => activateCategory(category.id)}
              />
            );
          })}
        </svg>

        <div className="skill-node-kind-radial-label-layer" role="none">
          {segments.map(({ category, labelPoint }, i) => {
            const active = category.id === activeCategory.id;
            return (
              <button
                key={category.id}
                type="button"
                role="menuitem"
                aria-label={`${category.title} category`}
                className={`skill-node-kind-radial-category${active ? ' skill-node-kind-radial-category--active' : ''}`}
                style={
                  {
                    left: labelPoint.x,
                    top: labelPoint.y,
                    '--skill-radial-accent': category.accent,
                    '--skill-radial-tint': category.tint,
                    '--delay': `${50 + i * 20}ms`,
                  } as CSSProperties
                }
                onFocus={() => activateCategory(category.id)}
                onMouseEnter={() => activateCategory(category.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  activateCategory(category.id);
                }}
              >
                <span className="skill-node-kind-radial-category-icon">{category.icon}</span>
                <span className="skill-node-kind-radial-category-label">{category.short}</span>
              </button>
            );
          })}
        </div>

        <div className="skill-node-kind-radial-command-layer" role="none">
          {commands.map(({ item, point }, i) => (
            <button
              key={`${activeCategory.id}-${item.kind}`}
              type="button"
              role="menuitem"
              aria-label={`Add ${item.title}`}
              className="skill-node-kind-radial-command"
              style={
                {
                  left: point.x,
                  top: point.y,
                  '--delay': `${100 + i * 36}ms`,
                } as CSSProperties
              }
              onFocus={() => setHoveredLeaf(item)}
              onMouseEnter={() => setHoveredLeaf(item)}
              onMouseLeave={() => setHoveredLeaf(null)}
              onClick={(e) => {
                e.stopPropagation();
                onPick(item.kind, item.action);
              }}
            >
              <span className="skill-node-kind-radial-command-icon">{item.icon}</span>
              <span className="skill-node-kind-radial-command-label">{item.short}</span>
            </button>
          ))}
        </div>

        <div className="skill-node-kind-radial-hub" aria-hidden>
          <div className="skill-node-kind-radial-hub-inner">
            <div className="skill-node-kind-radial-hub-kicker">{activeCategory.title}</div>
            <div className="skill-node-kind-radial-hub-icon-wrap">
              <div className="skill-node-kind-radial-hub-placeholder">
                <span className="skill-node-kind-radial-hub-plus">{hubLeaf?.icon ?? activeCategory.icon}</span>
              </div>
            </div>
            <p className="skill-node-kind-radial-hub-title">{hubLeaf?.title ?? activeCategory.title}</p>
            <p className="skill-node-kind-radial-hub-hint">Arrow keys switch category</p>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(ui, document.body);
}

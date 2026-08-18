'use client';

import { useRef, useState } from 'react';
import { Layer, Rectangle, ResponsiveContainer, Sankey } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { NetSupplyFlows, SankeyNode as SankeyNodeData } from '@/lib/queries/overview';

interface Props {
  /** Pre-fetched flows keyed by `${view}:${period}` so toggles are instant. */
  byKey: Record<string, NetSupplyFlows>;
}

type View = 'chain' | 'curator';
type Period = 'W' | 'M' | 'Q';

interface NodeHoverInfo { name: string; kind: string; usd: number }
interface LinkHoverInfo { from: string; to: string; usd: number; color: string }
interface Tip { left: number; top: number; title: string; value: string; valColor: string }

const INFLOW_COLOR = '#34D399';   // green
const OUTFLOW_COLOR = '#F26B68';  // red

const nodeColor = (kind: string): string => {
  if (kind === 'inflow') return tokens.colors.chart[1];      // green
  if (kind === 'outflow') return tokens.colors.negative;     // red
  return tokens.colors.accent;                                // component = orange
};

export function NetSupplyFlowsSankey({ byKey }: Props) {
  const [view, setView] = useState<View>('chain');
  const [period, setPeriod] = useState<Period>('W');
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const flows = byKey[`${view}:${period}`];

  const hasData = flows && flows.nodes.length > 0 && flows.links.length > 0;

  // Self-managed tooltip: Recharts' built-in Sankey tooltip doesn't fire once
  // we supply custom node + link renderers, so we wire hover ourselves for
  // BOTH the nodes (bars) and the links (ribbons. What users actually point
  // at). Positions are computed relative to the wrapper.
  const showTip = (title: string, value: string, valColor: string, e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setTip({
      left: e.clientX - (rect?.left ?? 0),
      top: e.clientY - (rect?.top ?? 0),
      title,
      value,
      valColor,
    });
  };

  const onNodeHover = (info: NodeHoverInfo | null, e?: React.MouseEvent) => {
    if (!info || !e) { setTip(null); return; }
    const signed =
      info.kind === 'component'
        ? (info.usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(info.usd), { compact: true })
        : fmtUsd(info.usd, { compact: true });
    const valColor =
      info.kind === 'component'
        ? info.usd >= 0 ? tokens.colors.positive : tokens.colors.negative
        : info.kind === 'inflow' ? tokens.colors.positive : tokens.colors.negative;
    showTip(info.name, signed, valColor, e);
  };

  const onLinkHover = (info: LinkHoverInfo | null, e?: React.MouseEvent) => {
    if (!info || !e) { setTip(null); return; }
    showTip(`${info.from} → ${info.to}`, fmtUsd(info.usd, { compact: true }), info.color, e);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          options={[{ value: 'chain', label: 'By Chain' }, { value: 'curator', label: 'By Curator' }]}
          value={view}
          onChange={(v) => setView(v as View)}
        />
        <Segmented
          options={[{ value: 'W', label: 'W' }, { value: 'M', label: 'M' }, { value: 'Q', label: 'Q' }]}
          value={period}
          onChange={(v) => setPeriod(v as Period)}
        />
      </div>

      {/* Inflow / outflow legend (matches the reference) */}
      <div className="flex items-center justify-between text-tiny uppercase tracking-header-medium">
        <span className="inline-flex items-center gap-1.5" style={{ color: INFLOW_COLOR }}>
          <span className="inline-block size-2 rounded-sm" style={{ background: INFLOW_COLOR }} />
          Inflows →
        </span>
        <span className="inline-flex items-center gap-1.5" style={{ color: OUTFLOW_COLOR }}>
          → Outflows
          <span className="inline-block size-2 rounded-sm" style={{ background: OUTFLOW_COLOR }} />
        </span>
      </div>

      {hasData ? (
        <div ref={wrapRef} className="relative">
          <ResponsiveContainer width="100%" height={420}>
            <Sankey
              data={{ nodes: flows.nodes, links: flows.links }}
              nodePadding={18}
              nodeWidth={12}
              linkCurvature={0.5}
              iterations={64}
              link={<SankeyLink onHover={onLinkHover} nodes={flows.nodes} />}
              node={<SankeyNode onHover={onNodeHover} />}
              margin={{ top: 26, right: 150, bottom: 12, left: 150 }}
            >
              <defs>
                <filter id="sankeyGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
            </Sankey>
          </ResponsiveContainer>
          {tip && (
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left: tip.left + 12,
                top: tip.top + 12,
                background: tokens.colors.tooltipBg,
                border: `1px solid ${tokens.colors.borderBright}`,
                borderRadius: tokens.radii.md,
                boxShadow: `0 8px 24px ${tokens.colors.tooltipShadow}`,
                padding: '6px 9px',
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: tokens.colors.textPrimary }}>{tip.title}</span>
              <span style={{ color: tip.valColor, marginLeft: 8 }}>{tip.value}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-[240px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
          No net flows for this period.
        </div>
      )}

      <div className="text-tiny uppercase tracking-header-medium text-text-muted">
        Net inflow <span className="text-positive">{fmtUsd(flows?.netInflowUsd ?? 0, { compact: true })}</span>
        <span className="mx-2 text-text-muted/40">·</span>
        Net outflow <span className="text-negative">{fmtUsd(flows?.netOutflowUsd ?? 0, { compact: true })}</span>
        <span className="mx-2 text-text-muted/40">·</span>
        Period: {period === 'W' ? '1 week' : period === 'M' ? '1 month' : '1 quarter'}
        <span className="mx-2 text-text-muted/40">·</span>
        <span className="normal-case" style={{ letterSpacing: 'normal' }}>
          USD deltas of the supply + collateral footprint; includes price drift, not volume-only.
        </span>
      </div>
    </div>
  );
}

// Custom link (ribbon) renderer: colored by side (green inflow, red outflow),
// semi-opaque with a soft glow, and hoverable. The ribbons are the big
// target users actually point at, so this is where the tooltip must fire.
interface LinkProps {
  sourceX?: number; targetX?: number; sourceY?: number; targetY?: number;
  sourceControlX?: number; targetControlX?: number;
  linkWidth?: number; index?: number;
  payload?: { source: number | SankeyNodeData; target: number | SankeyNodeData; value: number };
  nodes?: SankeyNodeData[];
  onHover?: (info: LinkHoverInfo | null, e?: React.MouseEvent) => void;
}
function SankeyLink(props: LinkProps) {
  const {
    sourceX = 0, targetX = 0, sourceY = 0, targetY = 0,
    sourceControlX = 0, targetControlX = 0, linkWidth = 0,
    payload, nodes = [], onHover,
  } = props;
  if (!payload) return null;

  // Recharts may hand back source/target as indices or as node objects . 
  // resolve to the node either way.
  const resolve = (v: number | SankeyNodeData | undefined): SankeyNodeData | undefined =>
    typeof v === 'number' ? nodes[v] : v;
  const src = resolve(payload.source);
  const tgt = resolve(payload.target);

  const color =
    src?.kind === 'inflow' ? INFLOW_COLOR
    : tgt?.kind === 'outflow' ? OUTFLOW_COLOR
    : tokens.colors.accent;

  const d =
    `M${sourceX},${sourceY}` +
    `C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;

  const info: LinkHoverInfo = {
    from: src?.name ?? '', to: tgt?.name ?? '', usd: payload.value ?? 0, color,
  };

  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(1, linkWidth)}
      strokeOpacity={0.4}
      filter="url(#sankeyGlow)"
      style={{ cursor: 'pointer' }}
      onMouseMove={(e) => { e.currentTarget.setAttribute('stroke-opacity', '0.75'); onHover?.(info, e); }}
      onMouseLeave={(e) => { e.currentTarget.setAttribute('stroke-opacity', '0.4'); onHover?.(null); }}
    />
  );
}

// Custom node renderer: colored rect + right/left label + value.
interface NodeProps {
  x?: number; y?: number; width?: number; height?: number;
  index?: number;
  payload?: { name: string; kind: string; usd?: number };
  containerWidth?: number;
  onHover?: (info: NodeHoverInfo | null, e?: React.MouseEvent) => void;
}
function SankeyNode(props: NodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload, onHover } = props;
  if (!payload) return null;
  const color = nodeColor(payload.kind);
  const usd = payload.usd ?? 0;
  const name = payload.name.length > 14 ? payload.name.slice(0, 13) + '…' : payload.name;
  const font = tokens.typography.fontFamilyMono;
  const info: NodeHoverInfo = { name: payload.name, kind: payload.kind, usd };

  // Transparent, widened hit area so the thin (12px) bars are easy to hover.
  const hit = (
    <rect
      x={x - 4}
      y={y - 2}
      width={width + 8}
      height={height + 4}
      fill="transparent"
      style={{ cursor: 'pointer' }}
      onMouseMove={(e) => onHover?.(info, e)}
      onMouseLeave={() => onHover?.(null)}
    />
  );

  // Component (middle) nodes: name + signed net ABOVE the bar (avoids
  // overlapping the flows). Asset nodes: name + value beside the bar . 
  // inflow to the left, outflow to the right. Labels are non-interactive so
  // the hit area underneath captures hover.
  if (payload.kind === 'component') {
    const signed = (usd >= 0 ? '+' : '−') + fmtUsd(Math.abs(usd), { compact: true });
    const valColor = usd >= 0 ? tokens.colors.positive : tokens.colors.negative;
    return (
      <Layer>
        <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.95} radius={1} />
        <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontFamily={font} style={{ pointerEvents: 'none' }}>
          <tspan fill={tokens.colors.textPrimary} fontWeight={600}>{name}</tspan>
          <tspan fill={valColor} dx={5}>{signed}</tspan>
        </text>
        {hit}
      </Layer>
    );
  }

  const isLeft = payload.kind === 'inflow';
  const labelX = isLeft ? x - 6 : x + width + 6;
  const anchor = isLeft ? 'end' : 'start';
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} radius={1} />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={anchor}
        dominantBaseline="middle"
        fontSize={10}
        fontFamily={font}
        style={{ pointerEvents: 'none' }}
      >
        <tspan fill={tokens.colors.textSecondary}>{name}</tspan>
        <tspan fill={tokens.colors.textMuted} dx={5}>{fmtUsd(usd, { compact: true })}</tspan>
      </text>
      {hit}
    </Layer>
  );
}

interface SegmentedProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}
function Segmented({ options, value, onChange }: SegmentedProps) {
  return (
    <div
      data-chart-export-hide="segmented"
      style={{
        display: 'inline-flex', borderRadius: 4, border: '1px solid var(--card-border)',
        overflow: 'hidden', background: 'var(--background)',
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            padding: '3px 10px', fontSize: 10, fontWeight: 500, cursor: 'pointer', border: 'none',
            fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.05em',
            background: value === o.value ? 'var(--card-border)' : 'transparent',
            color: value === o.value ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

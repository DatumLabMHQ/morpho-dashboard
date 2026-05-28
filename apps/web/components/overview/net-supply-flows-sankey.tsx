'use client';

import { useState } from 'react';
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { NetSupplyFlows } from '@/lib/queries/overview';

interface Props {
  /** Pre-fetched flows keyed by `${view}:${period}` so toggles are instant. */
  byKey: Record<string, NetSupplyFlows>;
}

type View = 'chain' | 'curator';
type Period = 'W' | 'M' | 'Q';

const nodeColor = (kind: string): string => {
  if (kind === 'inflow') return tokens.colors.chart[1];      // green
  if (kind === 'outflow') return tokens.colors.negative;     // red
  return tokens.colors.accent;                                // component = orange
};

export function NetSupplyFlowsSankey({ byKey }: Props) {
  const [view, setView] = useState<View>('chain');
  const [period, setPeriod] = useState<Period>('W');
  const flows = byKey[`${view}:${period}`];

  const hasData = flows && flows.nodes.length > 0 && flows.links.length > 0;

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

      {hasData ? (
        <ResponsiveContainer width="100%" height={420}>
          <Sankey
            data={{ nodes: flows.nodes, links: flows.links }}
            nodePadding={18}
            nodeWidth={12}
            linkCurvature={0.5}
            iterations={64}
            link={{ stroke: 'hsla(0,0%,100%,0.10)' }}
            node={<SankeyNode />}
            margin={{ top: 12, right: 140, bottom: 12, left: 140 }}
          >
            <Tooltip
              formatter={(v: unknown) => [fmtUsd(typeof v === 'number' ? v : 0, { compact: true }), 'Net flow']}
              contentStyle={{
                background: tokens.colors.tooltipBg,
                border: `1px solid ${tokens.colors.borderBright}`,
                borderRadius: tokens.radii.md,
                fontFamily: tokens.typography.fontFamilyMono,
                fontSize: 11,
                color: tokens.colors.textPrimary,
              }}
            />
          </Sankey>
        </ResponsiveContainer>
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

// Custom node renderer: colored rect + right/left label.
interface NodeProps {
  x?: number; y?: number; width?: number; height?: number;
  index?: number;
  payload?: { name: string; kind: string };
  containerWidth?: number;
}
function SankeyNode(props: NodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, payload, containerWidth = 0 } = props;
  if (!payload) return null;
  const color = nodeColor(payload.kind);
  // Component nodes label to the right; inflow (left side) label left,
  // outflow (right side) label right.
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
        fill={tokens.colors.textSecondary}
        fontFamily={tokens.typography.fontFamilyMono}
      >
        {payload.name.length > 16 ? payload.name.slice(0, 15) + '…' : payload.name}
      </text>
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

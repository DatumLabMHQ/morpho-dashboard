'use client';

import { format, parseISO } from 'date-fns';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { MarketShareByChain, ShareMetric } from '@/lib/queries/overview';

interface Props {
  /** One pre-fetched series per metric so the toggle is instant (no refetch). */
  byMetric: Record<ShareMetric, MarketShareByChain>;
}

const METRICS: { key: ShareMetric; label: string }[] = [
  { key: 'borrows', label: 'Borrows' },
  { key: 'deposits', label: 'Deposits' },
  { key: 'liquidity', label: 'Available Liquidity' },
  { key: 'tvl', label: 'TVL' },
  { key: 'utilization', label: 'Utilization' },
];

const RANGES: { days: number; label: string }[] = [
  { days: 730, label: '24-Month' },
  { days: 365, label: '12-Month' },
  { days: 180, label: '6-Month' },
  { days: 90, label: '3-Month' },
];

export function MarketShareChart({ byMetric }: Props) {
  const [metric, setMetric] = useState<ShareMetric>('borrows');
  const [rangeDays, setRangeDays] = useState(730);
  const series = byMetric[metric];

  const points = useMemo(() => {
    const cutoff = new Date(Date.now() - rangeDays * 86_400_000).toISOString().slice(0, 10);
    return series.points.filter((p) => (p.day as string) >= cutoff);
  }, [series, rangeDays]);

  const isRatio = series.mode === 'ratio';

  return (
    <div className="space-y-3">
      {/* Toggle row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
          value={metric}
          onChange={(v) => setMetric(v as ShareMetric)}
        />
        <Segmented
          options={RANGES.map((r) => ({ value: String(r.days), label: r.label }))}
          value={String(rangeDays)}
          onChange={(v) => setRangeDays(Number(v))}
        />
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <AreaChart
          data={points}
          margin={{ top: 12, right: 16, left: 8, bottom: 8 }}
          stackOffset={isRatio ? 'none' : 'expand'}
        >
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
          <XAxis
            dataKey="day"
            tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.06em' }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            minTickGap={48}
          />
          <YAxis
            tickFormatter={(v: number) => (isRatio ? `${(v * 100).toFixed(0)}%` : `${Math.round(v * 100)}%`)}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={44}
            domain={isRatio ? [0, 'auto'] : [0, 1]}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown, ctx: unknown) => {
              const n = typeof v === 'number' ? v : 0;
              const chain = series.chains.find((c) => c.slug === name);
              const label = chain?.name ?? String(name);
              if (isRatio) return [`${(n * 100).toFixed(1)}%`, label];
              // Share mode: show $ + % of that day's total.
              const payload = (ctx as { payload?: Record<string, number> })?.payload ?? {};
              const total = series.chains.reduce((s, c) => s + (Number(payload[c.slug]) || 0), 0);
              const sharePct = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
              return [`${fmtUsd(n, { compact: true })} · ${sharePct}%`, label];
            }}
            contentStyle={{
              background: tokens.colors.tooltipBg,
              border: `1px solid ${tokens.colors.borderBright}`,
              borderRadius: tokens.radii.md,
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 11,
              color: tokens.colors.textPrimary,
            }}
            labelStyle={{ color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}
          />
          {series.chains.map((c, i) => {
            const color =
              c.slug === 'Other' ? 'hsla(0, 0%, 100%, 0.22)' : tokens.colors.chart[i % tokens.colors.chart.length];
            return (
              <Area
                key={c.slug}
                type="monotone"
                dataKey={c.slug}
                name={c.slug}
                stackId={isRatio ? undefined : 'share'}
                stroke={color}
                strokeWidth={isRatio ? 1.5 : 0.5}
                fill={color}
                fillOpacity={isRatio ? 0.12 : 0.6}
                isAnimationActive={false}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-tiny uppercase tracking-header-medium">
        {series.chains.map((c, i) => (
          <span key={c.slug} className="inline-flex items-center gap-1.5 text-text-secondary">
            <span
              className="inline-block size-2 rounded-sm"
              style={{ background: c.slug === 'Other' ? 'hsla(0,0%,100%,0.22)' : tokens.colors.chart[i % tokens.colors.chart.length] }}
            />
            {c.name}
          </span>
        ))}
      </div>
    </div>
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
        display: 'inline-flex',
        borderRadius: 4,
        border: '1px solid var(--card-border)',
        overflow: 'hidden',
        background: 'var(--background)',
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            padding: '3px 9px',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            fontFamily: 'inherit',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
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

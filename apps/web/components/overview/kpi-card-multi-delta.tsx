'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { fmtUsd } from '@/lib/format';
import type { KpiCardData } from '@/lib/queries/overview';

interface Props {
  label: string;
  data: KpiCardData;
  /** Accent token name (e.g. 'chart-1'). Drives stripe + sparkline color. */
  accent: string;
}

const fmtMain = (data: KpiCardData): string => {
  if (data.value == null) return '—';
  if (data.display === 'usd') return fmtUsd(data.value, { compact: true });
  return `${(data.value * 100).toFixed(2)}%`;
};

const fmtDelta = (kind: 'usd' | 'pp' | 'pct', value: number | null): string => {
  if (value == null) return '—';
  const sign = value >= 0 ? '▲' : '▼';
  if (kind === 'usd') return `${sign} ${fmtUsd(Math.abs(value), { compact: true })}`;
  if (kind === 'pp') return `${sign} ${Math.abs(value).toFixed(2)}pp`;
  return `${sign} ${Math.abs(value * 100).toFixed(1)}%`;
};

/**
 * KPI card with a 30-day sparkline and a row of up-to-three timeframe
 * deltas (24h / MoM / YoY). Each delta is color-coded green up / red down.
 * Layout: label top, big value + caption middle-left, sparkline middle-
 * right, delta row at the bottom.
 */
export function KpiCardMultiDelta({ label, data, accent }: Props) {
  const color = `var(--${accent})`;
  return (
    <div
      className="relative overflow-hidden rounded-md border border-card-border bg-card-bg p-4 flex flex-col gap-2"
      style={{ minHeight: 150 }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: color }} />
      <div className="text-tiny uppercase" style={{ letterSpacing: '0.1em', color }}>
        {label}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-kpi tabular-nums text-text-primary leading-tight">{fmtMain(data)}</div>
          <div className="mt-0.5 text-tiny uppercase tracking-header-medium text-text-muted">
            {data.caption}
          </div>
        </div>
        <div style={{ width: 88, height: 34 }} className="shrink-0">
          {data.sparkline.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.sparkline} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`kpispark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.25}
                  fill={`url(#kpispark-${accent})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-tiny tabular-nums">
        {data.deltas.map((d, i) => (
          <span key={d.label} className="inline-flex items-center gap-1">
            <span style={{ color: d.value == null ? 'var(--text-muted)' : d.value >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmtDelta(d.kind, d.value)}
            </span>
            <span className="text-text-muted uppercase tracking-header-medium">{d.label}</span>
            {i < data.deltas.length - 1 && <span className="text-text-muted/40">·</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

'use client';

import {
  Activity,
  DollarSign,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import { fmtUsd } from '@/lib/format';
import type { KpiCardData } from '@/lib/queries/overview';

// Icon registry — the page passes a stable string key (server→client props
// can't carry a function/component across the RSC boundary, so we resolve the
// lucide component here, inside the client island).
export type KpiIconKey =
  | 'trending-up' | 'trending-down' | 'wallet' | 'activity' | 'percent' | 'dollar';

const ICONS: Record<KpiIconKey, LucideIcon> = {
  'trending-up': TrendingUp,
  'trending-down': TrendingDown,
  wallet: Wallet,
  activity: Activity,
  percent: Percent,
  dollar: DollarSign,
};

interface Props {
  label: string;
  data: KpiCardData;
  /** Accent token name (e.g. 'chart-1', 'positive'). Drives the left stripe,
   *  icon, label and sparkline color. */
  accent: string;
  /** Icon key resolved to a lucide component inside the card. */
  icon?: KpiIconKey;
}

const fmtMain = (data: KpiCardData): string => {
  if (data.value == null) return '—';
  if (data.display === 'usd') return fmtUsd(data.value, { compact: true });
  return `${(data.value * 100).toFixed(2)}%`;
};

const fmtDelta = (kind: 'usd' | 'pp' | 'pct', value: number | null): string => {
  if (value == null) return '—';
  const sign = value >= 0 ? '▲' : '▼';
  if (kind === 'usd') return `${sign}${fmtUsd(Math.abs(value), { compact: true })}`;
  if (kind === 'pp') return `${sign} ${Math.abs(value).toFixed(2)} pp`;
  return `${sign} ${Math.abs(value * 100).toFixed(1)}%`;
};

/**
 * KPI card matching the Lending Intelligence Terminal layout:
 *   - left-edge accent stripe (per-card color)
 *   - icon + ALL-CAPS label (accent) top-left, sparkline top-right
 *   - big mono value with an inline muted caption
 *   - bottom row of up-to-three timeframe deltas (24h / MoM / YoY),
 *     green up / red down
 */
export function KpiCardMultiDelta({ label, data, accent, icon }: Props) {
  const color = `var(--${accent})`;
  const Icon = icon ? ICONS[icon] : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-md border border-card-border bg-card-bg pl-5 pr-4 py-4 flex flex-col gap-2"
      style={{ minHeight: 132 }}
    >
      {/* Left accent stripe */}
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />

      {/* Header: icon + label · sparkline */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5" style={{ color }}>
          {Icon && <Icon size={13} strokeWidth={2} />}
          <span className="text-tiny uppercase font-bold" style={{ letterSpacing: '0.1em' }}>
            {label}
          </span>
        </div>
        <div style={{ width: 96, height: 26 }} className="shrink-0">
          {data.sparkline.length > 1 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.sparkline} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`kpispark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.35} />
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

      {/* Value + inline caption */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-kpi tabular-nums text-text-primary leading-none">{fmtMain(data)}</span>
        <span className="text-tiny text-text-muted">{data.caption}</span>
      </div>

      {/* Deltas */}
      <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-tiny tabular-nums">
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

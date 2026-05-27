'use client';

import { Area, AreaChart, ResponsiveContainer } from 'recharts';

import type { SparklinePoint } from '@/lib/queries/overview';

interface Props {
  label: string;
  value: string;
  /** Decimal: 0.05 = +5%. Sign drives positive/negative coloring. */
  deltaPct: number | null;
  /** Color name (matches a CSS var) — same one used on the card's accent stripe. */
  accent: string;
  sparkline: SparklinePoint[];
}

/**
 * KPI card variant that adds a 30-day sparkline below the value.
 *
 * Same dimensions / typography as the base KpiCard so the Overview's
 * 7-card strip lays out cleanly next to the existing cards on other
 * pages. Sparkline draws against the same accent color as the top stripe.
 */
export function KpiCardWithSparkline({ label, value, deltaPct, accent, sparkline }: Props) {
  const color = `var(--${accent})`;
  const deltaLabel = deltaPct == null
    ? '—'
    : `${deltaPct >= 0 ? '+' : ''}${(deltaPct * 100).toFixed(1)}% 30d`;
  const deltaColor =
    deltaPct == null ? 'var(--text-muted)' : deltaPct >= 0 ? 'var(--success)' : 'var(--danger)';

  return (
    <div
      className="relative overflow-hidden rounded-md border border-card-border bg-card-bg p-4 flex flex-col gap-1"
      style={{ minHeight: 132 }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: color }} />
      <div
        className="text-tiny uppercase"
        style={{ letterSpacing: '0.1em', color }}
      >
        {label}
      </div>
      <div className="mt-1 text-kpi tabular-nums text-text-primary leading-tight">{value}</div>
      <div
        className="text-tiny uppercase tracking-header-medium"
        style={{ color: deltaColor }}
      >
        {deltaLabel}
      </div>
      <div className="mt-auto -mx-1" style={{ height: 36 }}>
        {sparkline.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`spark-${accent}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.25}
                fill={`url(#spark-${accent})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full" />
        )}
      </div>
    </div>
  );
}

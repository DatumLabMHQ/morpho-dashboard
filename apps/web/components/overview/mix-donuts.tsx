'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { AssetSlice, MixDonuts as MixData, MixPeriod } from '@/lib/queries/overview';

interface Props {
  /** Pre-fetched donut data per period so the toggle is instant. */
  byPeriod: Record<MixPeriod, MixData>;
  /** Render only one side (for separate side-by-side cards). Omit for both. */
  only?: 'collateral' | 'borrow';
}

const PERIODS: { value: MixPeriod; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

const sliceColor = (symbol: string, i: number) =>
  symbol === 'Other' ? 'hsla(0,0%,100%,0.22)' : tokens.colors.chart[i % tokens.colors.chart.length];

// High-contrast hover tooltip matching the Lending Terminal: a solid dark
// card with a colored dot + symbol header, then USD and Share rows in light
// text. Built custom (not Recharts' default) so the text is always legible
// in dark mode instead of dark-on-dark.
interface TooltipProps {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { symbol: string }; color?: string }[];
  total: number;
}
function DonutTooltip({ active, payload, total }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]!;
  const symbol = p.payload?.symbol ?? p.name ?? '';
  const usd = typeof p.value === 'number' ? p.value : 0;
  const share = total > 0 ? (usd / total) * 100 : 0;
  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius-md)',
        boxShadow: `0 8px 24px ${tokens.colors.tooltipShadow}`,
        padding: '8px 11px',
        fontFamily: tokens.typography.fontFamilyMono,
        fontSize: 11,
        minWidth: 132,
      }}
    >
      <div className="flex items-center gap-1.5" style={{ marginBottom: 5 }}>
        <span className="inline-block size-2 rounded-sm" style={{ background: p.color ?? 'var(--accent)' }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{symbol}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span style={{ color: 'var(--text-muted)' }}>USD</span>
        <span style={{ color: 'var(--text-primary)' }}>{fmtUsd(usd, { compact: true })}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span style={{ color: 'var(--text-muted)' }}>Share</span>
        <span style={{ color: 'var(--text-primary)' }}>{share.toFixed(1)}%</span>
      </div>
    </div>
  );
}

/** Donut + a right-side legend listing each asset with its share %. */
function Donut({ title, slices, total }: { title: string; slices: AssetSlice[]; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-tiny uppercase font-bold" style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}>
        {title}
      </h3>
      <div className="flex items-center gap-5">
        {/* Donut. Hollow center, on-hover tooltip only. */}
        <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="usd"
                nameKey="symbol"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={82}
                paddingAngle={1}
                isAnimationActive={false}
                stroke="var(--card-bg)"
                strokeWidth={1}
              >
                {slices.map((s, i) => (
                  <Cell key={s.symbol} fill={sliceColor(s.symbol, i)} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Side legend. TOTAL header, then dot · symbol · share% rows
            (mirrors the Lending Terminal layout). */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between border-b border-card-border pb-1.5 mb-1">
            <span className="text-tiny uppercase tracking-header-medium text-text-muted">Total</span>
            <span className="text-body tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {fmtUsd(total, { compact: true })}
            </span>
          </div>
          <table className="w-full text-tiny tabular-nums">
            <tbody>
              {slices.map((s, i) => {
                const share = total > 0 ? (s.usd / total) * 100 : 0;
                return (
                  <tr key={s.symbol} className="border-b border-card-border last:border-0">
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-sm shrink-0" style={{ background: sliceColor(s.symbol, i) }} />
                        <span className="uppercase tracking-header-medium" style={{ color: 'var(--text-primary)' }}>{s.symbol}</span>
                      </span>
                    </td>
                    <td className="py-1 text-right" style={{ color: 'var(--text-primary)' }}>{share.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Collateral and/or borrow donuts with a period toggle. With `only` set,
 *  renders a single donut (used for two separate side-by-side cards). */
export function MixDonuts({ byPeriod, only }: Props) {
  const [period, setPeriod] = useState<MixPeriod>('current');
  const d = byPeriod[period] ?? byPeriod.current;

  return (
    <div className="space-y-4">
      {/* Period toggle */}
      <div className="flex items-center justify-end">
        <div
          data-chart-export-hide="period"
          style={{
            display: 'inline-flex', borderRadius: 4, border: '1px solid var(--card-border)',
            overflow: 'hidden', background: 'var(--background)',
          }}
        >
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 500, cursor: 'pointer', border: 'none',
                fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.05em',
                background: period === p.value ? 'var(--card-border)' : 'transparent',
                color: period === p.value ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {only === 'collateral' ? (
        <Donut title="Deposit base by asset" slices={d.collateralMix} total={d.collateralTotal} />
      ) : only === 'borrow' ? (
        <Donut title="Debt by asset" slices={d.borrowMix} total={d.borrowTotal} />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Donut title="Collateral mix · deposit base by asset" slices={d.collateralMix} total={d.collateralTotal} />
          <Donut title="Borrow mix · debt by asset" slices={d.borrowMix} total={d.borrowTotal} />
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { AssetSlice, MixDonuts as MixData, MixPeriod } from '@/lib/queries/overview';

interface Props {
  /** Pre-fetched donut data per period so the toggle is instant. */
  byPeriod: Record<MixPeriod, MixData>;
}

const PERIODS: { value: MixPeriod; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];

const sliceColor = (symbol: string, i: number) =>
  symbol === 'Other' ? 'hsla(0,0%,100%,0.22)' : tokens.colors.chart[i % tokens.colors.chart.length];

/** Donut + a right-side legend listing each asset with its share %. */
function Donut({ title, slices, total }: { title: string; slices: AssetSlice[]; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-tiny uppercase font-bold" style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}>
        {title}
      </h3>
      <div className="flex items-center gap-4">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="usd"
                nameKey="symbol"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={74}
                paddingAngle={1}
                isAnimationActive={false}
                stroke="var(--card-bg)"
                strokeWidth={1}
              >
                {slices.map((s, i) => (
                  <Cell key={s.symbol} fill={sliceColor(s.symbol, i)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: unknown, name: unknown) => {
                  const n = typeof v === 'number' ? v : 0;
                  const share = total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
                  return [`${fmtUsd(n, { compact: true })} · ${share}%`, String(name)];
                }}
                contentStyle={{
                  background: tokens.colors.tooltipBg,
                  border: `1px solid ${tokens.colors.borderBright}`,
                  borderRadius: tokens.radii.md,
                  fontFamily: tokens.typography.fontFamilyMono,
                  fontSize: 11,
                  color: tokens.colors.textPrimary,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[9px] uppercase tracking-header-medium text-text-muted">Total</span>
            <span className="text-small tabular-nums text-text-primary">{fmtUsd(total, { compact: true })}</span>
          </div>
        </div>

        {/* Side legend: dot · symbol · share% */}
        <div className="min-w-0 flex-1">
          <table className="w-full text-tiny tabular-nums">
            <tbody>
              {slices.map((s, i) => {
                const share = total > 0 ? (s.usd / total) * 100 : 0;
                return (
                  <tr key={s.symbol} className="border-b border-card-border last:border-0">
                    <td className="py-1 pr-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-sm shrink-0" style={{ background: sliceColor(s.symbol, i) }} />
                        <span className="uppercase tracking-header-medium text-text-secondary">{s.symbol}</span>
                      </span>
                    </td>
                    <td className="py-1 text-right text-text-primary">{share.toFixed(1)}%</td>
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

/** Paired collateral + borrow donuts with a shared period toggle. */
export function MixDonuts({ byPeriod }: Props) {
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Donut title="Collateral mix · deposit base by asset" slices={d.collateralMix} total={d.collateralTotal} />
        <Donut title="Borrow mix · debt by asset" slices={d.borrowMix} total={d.borrowTotal} />
      </div>
    </div>
  );
}

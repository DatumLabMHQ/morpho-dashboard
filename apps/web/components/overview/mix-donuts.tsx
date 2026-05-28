'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { AssetSlice } from '@/lib/queries/overview';

interface DonutProps {
  title: string;
  slices: AssetSlice[];
  total: number;
}

function Donut({ title, slices, total }: DonutProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <h3 className="text-tiny uppercase font-bold" style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}>
        {title}
      </h3>
      <div className="relative" style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="usd"
              nameKey="symbol"
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={1}
              isAnimationActive={false}
              stroke="var(--card-bg)"
              strokeWidth={1}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.symbol}
                  fill={s.symbol === 'Other' ? 'hsla(0,0%,100%,0.22)' : tokens.colors.chart[i % tokens.colors.chart.length]}
                />
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
          <span className="text-tiny uppercase tracking-header-medium text-text-muted">Total</span>
          <span className="text-body tabular-nums text-text-primary">{fmtUsd(total, { compact: true })}</span>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-tiny uppercase tracking-header-medium">
        {slices.map((s, i) => (
          <span key={s.symbol} className="inline-flex items-center gap-1 text-text-secondary">
            <span
              className="inline-block size-2 rounded-sm"
              style={{ background: s.symbol === 'Other' ? 'hsla(0,0%,100%,0.22)' : tokens.colors.chart[i % tokens.colors.chart.length] }}
            />
            {s.symbol}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Props {
  collateralMix: AssetSlice[];
  collateralTotal: number;
  borrowMix: AssetSlice[];
  borrowTotal: number;
}

/** Paired collateral + borrow donuts side by side. */
export function MixDonuts({ collateralMix, collateralTotal, borrowMix, borrowTotal }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <Donut title="Collateral mix · deposit base by asset" slices={collateralMix} total={collateralTotal} />
      <Donut title="Borrow mix · debt by asset" slices={borrowMix} total={borrowTotal} />
    </div>
  );
}

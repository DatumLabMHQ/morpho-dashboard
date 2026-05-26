'use client';

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { ScatterPoint } from '@/lib/queries/rates';

interface Props {
  data: ScatterPoint[];
}

// Colors mirror /assets so the category mapping is consistent across surfaces.
const CATEGORY_COLOR: Record<string, string> = {
  stablecoin: tokens.colors.chart[0],     // blue
  lst:        tokens.colors.chart[1],     // green
  lrt:        tokens.colors.chart[3],     // purple
  btc:        tokens.colors.chart[5],     // orange
  eth:        tokens.colors.chart[4],     // cyan
  rwa:        tokens.colors.chart[2],     // yellow
  other:      'hsla(0, 0%, 100%, 0.35)',
};

const CATEGORY_LABEL: Record<string, string> = {
  stablecoin: 'Stablecoin',
  lst: 'LST', lrt: 'LRT', btc: 'BTC', eth: 'ETH', rwa: 'RWA', other: 'Other',
};

export function UtilRateScatter({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No market data
      </div>
    );
  }

  // Group by category so the legend has one Scatter per color.
  const groups = new Map<string, ScatterPoint[]>();
  for (const p of data) {
    const arr = groups.get(p.category) ?? [];
    arr.push(p);
    groups.set(p.category, arr);
  }

  const categoryOrder = ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];

  // Convert raw utilization (0..1) and APY (0..1) into percent display.
  // bubble size encoded via ZAxis (sqrt scaling done by Recharts).
  return (
    <div>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 12, right: 16, left: 12, bottom: 20 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
          <XAxis
            dataKey="utilization"
            type="number"
            domain={[0, 1]}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            label={{
              value: 'UTILIZATION',
              position: 'insideBottom',
              offset: -8,
              fill: tokens.colors.textMuted,
              fontSize: 10,
              letterSpacing: '0.12em',
            }}
          />
          <YAxis
            dataKey="supplyApy"
            type="number"
            tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={60}
            domain={[0, (max: number) => Math.min(max * 1.05, 0.5)]}
            label={{
              value: 'SUPPLY APY',
              angle: -90,
              position: 'insideLeft',
              offset: 12,
              fill: tokens.colors.textMuted,
              fontSize: 10,
              letterSpacing: '0.12em',
            }}
          />
          <ZAxis dataKey="supplyUsd" range={[30, 600]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'hsla(0, 0%, 100%, 0.18)' }}
            content={(props: unknown) => {
              const p = props as { active?: boolean; payload?: { payload: ScatterPoint }[] };
              if (!p.active || !p.payload?.length) return null;
              const d = p.payload[0]!.payload;
              return (
                <div
                  style={{
                    background: tokens.colors.tooltipBg,
                    border: `1px solid ${tokens.colors.borderBright}`,
                    borderRadius: tokens.radii.md,
                    padding: '8px 10px',
                    fontFamily: tokens.typography.fontFamilyMono,
                    fontSize: 11,
                    color: tokens.colors.textPrimary,
                  }}
                >
                  <div style={{ color: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {d.collateralSymbol ?? '—'} / {d.loanSymbol} · {d.chainSlug}
                  </div>
                  <div style={{ marginTop: 4 }}>Supply: {fmtUsd(d.supplyUsd, { compact: true })}</div>
                  <div>Util: {(d.utilization * 100).toFixed(1)}% · APY: {(d.supplyApy * 100).toFixed(2)}%</div>
                  {d.lltv != null && <div>LLTV: {(d.lltv * 100).toFixed(0)}%</div>}
                </div>
              );
            }}
          />
          {categoryOrder.map((cat) => {
            const pts = groups.get(cat);
            if (!pts || pts.length === 0) return null;
            return (
              <Scatter
                key={cat}
                name={CATEGORY_LABEL[cat] ?? cat}
                data={pts}
                fill={CATEGORY_COLOR[cat] ?? 'hsla(0, 0%, 100%, 0.4)'}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            );
          })}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {categoryOrder
          .filter((cat) => groups.has(cat))
          .map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span
                className="block size-2 rounded-full"
                style={{ background: CATEGORY_COLOR[cat] ?? 'transparent' }}
              />
              <span className="text-tiny uppercase tracking-header-medium text-text-muted">
                {CATEGORY_LABEL[cat] ?? cat}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

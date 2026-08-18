'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { AssetMixSlice } from '@/lib/queries/chain-detail';

interface Props {
  data: AssetMixSlice[];
}

const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

const CATEGORY_COLOR: Record<string, string> = {
  stablecoin: tokens.colors.chart[1],          // green
  lst:        tokens.colors.chart[4],          // cyan
  lrt:        tokens.colors.chart[7],          // indigo
  btc:        tokens.colors.chart[2],          // yellow
  eth:        tokens.colors.chart[0],          // blue
  rwa:        tokens.colors.chart[3],          // purple
  other:      'hsla(0, 0%, 100%, 0.22)',
};

const CATEGORY_LABEL: Record<string, string> = {
  stablecoin: 'Stablecoins',
  lst:        'LSTs',
  lrt:        'LRTs / PTs',
  btc:        'BTC-pegged',
  eth:        'ETH',
  rwa:        'RWA',
  other:      'Other',
};

export function ChainAssetMix({ data }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[260px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No supply data</div>;
  }
  const total = data.reduce((s, d) => s + d.supplyUsd, 0);
  const sorted = [...data].sort((a, b) => b.supplyUsd - a.supplyUsd);
  const stable = sorted.find((d) => d.category === 'stablecoin');
  const stablePct = total > 0 && stable ? stable.supplyUsd / total : 0;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
      <div>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={sorted}
              dataKey="supplyUsd"
              nameKey="category"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={1}
              stroke="none"
              isAnimationActive={false}
            >
              {sorted.map((s) => (
                <Cell key={s.category} fill={CATEGORY_COLOR[s.category] ?? CATEGORY_COLOR.other} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: unknown, _n: unknown, ctx: any) => {
                const n = typeof v === 'number' ? v : 0;
                const pct = total > 0 ? (n / total) * 100 : 0;
                return [`${fmtUsd(n)} · ${pct.toFixed(1)}%`, CATEGORY_LABEL[ctx?.payload?.category] ?? String(ctx?.payload?.category)];
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
      </div>
      <div className="space-y-3">
        <ul className="space-y-1.5">
          {sorted.map((s) => (
            <li key={s.category} className="flex items-center justify-between gap-3 text-body">
              <div className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[s.category] ?? CATEGORY_COLOR.other }} />
                <span className="uppercase tracking-header-medium text-text-secondary">
                  {CATEGORY_LABEL[s.category] ?? s.category}
                </span>
                {s.topSymbol && (
                  <span className="text-tiny text-text-muted">· top {s.topSymbol}</span>
                )}
              </div>
              <div className="tabular-nums text-text-primary">
                {fmtUsd(s.supplyUsd)}
                <span className="ml-2 text-tiny text-text-muted">
                  {total > 0 ? ((s.supplyUsd / total) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-border pt-3 text-tiny text-text-secondary">
          {stable && total > 0 ? (
            <>
              <span className="uppercase tracking-header-medium text-text-primary">Stablecoins</span>
              {' make up '}
              <span className="text-text-primary">{(stablePct * 100).toFixed(1)}%</span>
              {' of Morpho supply on this chain. Top stable: '}
              <span className="text-text-primary">{stable.topSymbol ?? 'N/A'}</span>
              {stable.topSymbol ? ` (${fmtUsd(stable.topSymbolUsd)})` : ''}
              .
            </>
          ) : (
            <>No stablecoin supply on this chain yet.</>
          )}
        </p>
      </div>
    </div>
  );
}

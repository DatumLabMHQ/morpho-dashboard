'use client';

import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartFrame } from '@/components/chains/chart-frame';
import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, type AssetClass } from '@/lib/assets/asset-class';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { AssetCompositionPayload, AssetMixMetric } from '@/lib/queries/assets';

interface Props { payload: AssetCompositionPayload }

const METRICS: { key: AssetMixMetric; label: string }[] = [
  { key: 'SUPPLY', label: 'Supply Mix' },
  { key: 'COLLATERAL', label: 'Collateral Mix' },
  { key: 'BORROW_INTEREST', label: 'Borrow Interest Mix' },
];
const METHODOLOGY: Record<AssetMixMetric, string> = {
  SUPPLY: 'Supply Mix = Σ supply_assets_usd by loan-asset class over time (stacked). What capital is lent.',
  COLLATERAL: 'Collateral Mix = Σ collateral_assets_usd by collateral-asset class over time. What capital is locked to back borrows.',
  BORROW_INTEREST: 'Borrow Interest Mix = Σ borrow × LEAST(borrow_apy,1.0) by loan-asset class (annualized). Which classes are economically productive vs merely locked.',
};
const usdC = (v: number) => fmtUsd(v, { compact: true });
const tip = { background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary } as const;
const lblS = { color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' } as const;
const axis = { stroke: 'hsla(0,0%,100%,0.12)' } as const;

export function AssetCompositionChart({ payload }: Props) {
  const [metric, setMetric] = useState<AssetMixMetric>(payload.defaultMetric);
  const data = payload.byMetric[metric] ?? [];
  const keys = payload.categories as AssetClass[];

  const s = payload.subtitle;
  const subtitle = `Stablecoins: ${(s.stableSupplyNow * 100).toFixed(0)}% of supply${s.stableSupply12mo != null ? ` (was ${(s.stableSupply12mo * 100).toFixed(0)}% 12mo ago)` : ''}. BTC: ${(s.btcCollNow * 100).toFixed(0)}% of collateral${s.btcColl12mo != null ? ` (was ${(s.btcColl12mo * 100).toFixed(0)}%)` : ''}.`;

  const toggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-card-border p-0.5">
      {METRICS.map((m) => (
        <button key={m.key} onClick={() => setMetric(m.key)}
          className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-header-medium transition-colors ${metric === m.key ? 'bg-accent text-background' : 'text-text-muted hover:text-text-secondary'}`}>{m.label}</button>
      ))}
    </div>
  );

  return (
    <ChartFrame title="Asset Class Composition Over Time" subtitle={subtitle}
      csvFilename="asset-class-composition.csv" csvContent={toCsv(data, keys)} rightControls={toggle}
      methodologyText={METHODOLOGY[metric]} methodologySource="morpho_.market_state_daily × morpho_.markets">
      {data.length === 0 ? (
        <div className="flex h-[340px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={340}>
            <AreaChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
              <XAxis dataKey="date" tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} minTickGap={36} />
              <YAxis tickFormatter={usdC} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} width={62} />
              <Tooltip labelFormatter={(v: string) => format(parseISO(v), 'PP')} formatter={(v: unknown, n: unknown) => [typeof v === 'number' ? usdC(v) : 'N/A', ASSET_CLASS_LABEL[n as AssetClass] ?? String(n)]} contentStyle={tip} labelStyle={lblS} itemSorter={(it) => -(Number(it.value) || 0)} />
              {keys.map((k) => (<Area key={k} type="monotone" dataKey={k} stackId="1" stroke={ASSET_CLASS_COLOR[k]} fill={ASSET_CLASS_COLOR[k]} fillOpacity={0.55} strokeWidth={0.5} isAnimationActive={false} />))}
            </AreaChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {keys.map((k) => (<div key={k} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: ASSET_CLASS_COLOR[k] }} /><span className="text-tiny uppercase tracking-header-medium text-text-muted">{ASSET_CLASS_LABEL[k]}</span></div>))}
          </div>
        </div>
      )}
    </ChartFrame>
  );
}
function toCsv(data: { date: string; [k: string]: string | number | null }[], keys: string[]): string {
  return [['date', ...keys].join(','), ...data.map((p) => ['date', ...keys].map((k) => (p[k] == null ? '' : p[k])).join(','))].join('\n');
}

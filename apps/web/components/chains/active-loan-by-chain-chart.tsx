'use client';

import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import { ChartFrame } from './chart-frame';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import { OTHER_COLOR, type ActiveLoanSeriesPayload, type ChainMetricKey } from '@/lib/queries/chains';

interface Props {
  payload: ActiveLoanSeriesPayload;
}

const METRICS: { key: ChainMetricKey; label: string; titleWord: string }[] = [
  { key: 'ACTIVE_LOANS', label: 'Active Loans', titleWord: 'Active Loans' },
  { key: 'BORROW_INTEREST', label: 'Borrow Interest', titleWord: 'Borrow Interest' },
  { key: 'NIM', label: 'NIM', titleWord: 'Net Interest Margin' },
  { key: 'DEPOSITS', label: 'Deposits', titleWord: 'Total Deposits' },
  { key: 'TVL', label: 'TVL', titleWord: 'TVL' },
];

const METHODOLOGY: Record<ChainMetricKey, string> = {
  ACTIVE_LOANS: 'Active Loans = Σ borrow_assets_usd across all of a chain’s Morpho markets (the outstanding debt borrowers owe). Stacked by chain; the long tail is grouped as "Other".',
  BORROW_INTEREST: 'Borrow Interest (annualized) = Σ borrow_assets_usd × borrow APY per market, summed by chain. APYs are clamped below 100% and bad-oracle markets (APY > 100%) are excluded entirely.',
  NIM: 'Net Interest Margin = weighted borrow APY − weighted supply APY for each chain (borrow-weighted and supply-weighted respectively). Plotted as one line per chain, not stacked.',
  DEPOSITS: 'Total Deposits = Σ supply_assets_usd + Σ collateral_assets_usd per chain. The full deposit base backing the loan book. Stacked by chain; the long tail is grouped as "Other".',
  TVL: 'TVL = total deposits (Σ supply + Σ collateral) − active loans, per chain. Kept for sector comparison; it is not the headline metric.',
};

const usdC = (v: number) => fmtUsd(v, { compact: true });
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

const tooltipStyle = {
  background: tokens.colors.tooltipBg,
  border: `1px solid ${tokens.colors.borderBright}`,
  borderRadius: tokens.radii.md,
  fontFamily: tokens.typography.fontFamilyMono,
  fontSize: 11,
  color: tokens.colors.textPrimary,
} as const;
const labelStyle = { color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' } as const;
const axisLine = { stroke: 'hsla(0, 0%, 100%, 0.12)' } as const;

export function ActiveLoanByChainChart({ payload }: Props) {
  const [metric, setMetric] = useState<ChainMetricKey>(payload.defaultMetric);
  const { topChains, byMetric } = payload;
  const data = byMetric[metric] ?? [];
  const isStacked = metric === 'ACTIVE_LOANS' || metric === 'BORROW_INTEREST' || metric === 'DEPOSITS';
  const isUsd = metric !== 'NIM';

  // Series keys: top chains, plus an "Other" band for the stacked + TVL views.
  const nameBySlug = new Map(topChains.map((c) => [c.slug, c.name] as const));
  const colorBySlug = new Map(topChains.map((c) => [c.slug, c.color] as const));
  const keys = metric === 'NIM'
    ? topChains.map((c) => c.slug)
    : [...topChains.map((c) => c.slug), 'Other'];
  const colorFor = (k: string) => (k === 'Other' ? OTHER_COLOR : colorBySlug.get(k) ?? OTHER_COLOR);
  const nameFor = (k: string) => (k === 'Other' ? 'Other' : nameBySlug.get(k) ?? k);
  const fmtVal = (v: number) => (isUsd ? usdC(v) : pct(v));

  const toggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-card-border p-0.5">
      {METRICS.map((m) => (
        <button
          key={m.key}
          onClick={() => setMetric(m.key)}
          className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-header-medium transition-colors ${
            metric === m.key ? 'bg-accent text-background' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  const subtitle =
    payload.topChainLeader && metric === 'ACTIVE_LOANS'
      ? `Active loans across chains over 24 months. Top chain: ${payload.topChainLeader.name} at ${usdC(payload.topChainLeader.value)} (${(payload.topChainLeader.pct * 100).toFixed(1)}%)`
      : metric === 'NIM'
        ? 'Weighted borrow APY − weighted supply APY, per chain'
        : metric === 'BORROW_INTEREST'
          ? 'Annualized borrow interest by chain (APY clamped <100%)'
          : metric === 'DEPOSITS'
            ? 'Total deposits (supply + collateral) by chain. The deposit base'
            : 'TVL = total deposits − active loans, by chain';

  const titleWord = METRICS.find((m) => m.key === metric)?.titleWord ?? 'Active Loans';

  return (
    <ChartFrame
      title={`Morpho ${titleWord} by Chain`}
      subtitle={subtitle}
      csvFilename="morpho-active-loans-by-chain.csv"
      csvContent={toCsv(data, keys)}
      rightControls={toggle}
      methodologyText={METHODOLOGY[metric]}
      methodologySource="morpho_.market_state_daily (Morpho GraphQL, daily snapshot)"
    >
      {data.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={360}>
            {isStacked ? (
              <AreaChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
                <XAxis dataKey="date" tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
                  tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }} axisLine={axisLine} tickLine={axisLine} minTickGap={36} />
                <YAxis tickFormatter={(v: number) => usdC(v)} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axisLine} tickLine={axisLine} width={62} />
                <Tooltip labelFormatter={(v: string) => format(parseISO(v), 'PP')}
                  formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? fmtVal(v) : 'N/A', nameFor(String(name))]}
                  contentStyle={tooltipStyle} labelStyle={labelStyle} itemSorter={(it) => -(Number(it.value) || 0)} />
                {keys.map((k) => (
                  <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={colorFor(k)} fill={colorFor(k)}
                    fillOpacity={0.55} strokeWidth={0.5} isAnimationActive={false} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
                <XAxis dataKey="date" tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
                  tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }} axisLine={axisLine} tickLine={axisLine} minTickGap={36} />
                <YAxis tickFormatter={(v: number) => (isUsd ? usdC(v) : `${(v * 100).toFixed(0)}%`)} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axisLine} tickLine={axisLine} width={62} />
                <Tooltip labelFormatter={(v: string) => format(parseISO(v), 'PP')}
                  formatter={(v: unknown, name: unknown) => [typeof v === 'number' ? fmtVal(v) : 'N/A', nameFor(String(name))]}
                  contentStyle={tooltipStyle} labelStyle={labelStyle} itemSorter={(it) => -(Number(it.value) || 0)} />
                {keys.map((k) => (
                  <Line key={k} type="monotone" dataKey={k} stroke={colorFor(k)} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {keys.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="size-2.5 rounded-sm" style={{ background: colorFor(k) }} />
                <span className="text-tiny uppercase tracking-header-medium text-text-muted">{nameFor(k)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartFrame>
  );
}

function toCsv(data: { date: string; [k: string]: string | number | null }[], keys: string[]): string {
  const head = ['date', ...keys].join(',');
  const rows = data.map((p) => ['date', ...keys].map((k) => (p[k] == null ? '' : p[k])).join(','));
  return [head, ...rows].join('\n');
}

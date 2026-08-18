'use client';

import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartFrame } from '@/components/chains/chart-frame';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import { OTHER_COLOR } from '@/lib/queries/chains';
import type { CuratorMetricKey, CuratorSeriesPayload } from '@/lib/queries/curators';

interface Props { payload: CuratorSeriesPayload }

const METRICS: { key: CuratorMetricKey; label: string; titleWord: string }[] = [
  { key: 'AUM', label: 'AUM', titleWord: 'AUM' },
  { key: 'BORROW_INTEREST', label: 'Borrow Interest Captured', titleWord: 'Borrow Interest Captured' },
  { key: 'CURATOR_FEES', label: 'Curator Fees', titleWord: 'Fees' },
  { key: 'NET_APY', label: 'Net APY Delivered', titleWord: 'Net APY Delivered' },
];
const METHODOLOGY: Record<CuratorMetricKey, string> = {
  AUM: 'AUM = Σ vault TVL per curator, stacked over time (top 10 + "Other"). The depositor base each curator manages.',
  BORROW_INTEREST: 'Borrow Interest Captured = Σ vault TVL × pre-fee APY per curator (annualized). The interest a curator’s allocations extract from borrowers. APY clamped <100%; degenerate-IRM vaults excluded.',
  CURATOR_FEES: 'Curator Fees = Σ vault TVL × pre-fee APY × performance fee per curator (annualized). What the curator retains.',
  NET_APY: 'Net APY Delivered = AUM-weighted vault net_apy per curator. What depositors actually earn after fees. One line per curator.',
};

const usdC = (v: number) => fmtUsd(v, { compact: true });
const tip = { background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary } as const;
const lblS = { color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' } as const;
const axis = { stroke: 'hsla(0, 0%, 100%, 0.12)' } as const;

export function CuratorAumChart({ payload }: Props) {
  const [metric, setMetric] = useState<CuratorMetricKey>(payload.defaultMetric);
  const { topCurators, byMetric } = payload;
  const data = byMetric[metric] ?? [];
  const isStacked = metric !== 'NET_APY';
  const isUsd = metric !== 'NET_APY';
  const nameById = new Map(topCurators.map((c) => [c.id, c.name] as const));
  const colorById = new Map(topCurators.map((c) => [c.id, c.color] as const));
  const keys = metric === 'NET_APY' ? topCurators.map((c) => c.id) : [...topCurators.map((c) => c.id), 'Other'];
  const colorFor = (k: string) => (k === 'Other' ? OTHER_COLOR : colorById.get(k) ?? OTHER_COLOR);
  const nameFor = (k: string) => (k === 'Other' ? 'Other' : nameById.get(k) ?? k);
  const fmtV = (v: number) => (isUsd ? usdC(v) : `${(v * 100).toFixed(2)}%`);
  const titleWord = METRICS.find((m) => m.key === metric)?.titleWord ?? 'AUM';
  // Adaptive x-axis: day-level labels for short windows (e.g. the clipped
  // Curator Fees series), month-level for the full-year metrics.
  const spanDays = data.length > 1
    ? (parseISO(String(data[data.length - 1]!.date)).getTime() - parseISO(String(data[0]!.date)).getTime()) / 86_400_000
    : 0;
  const xTickFmt = (v: string) => format(parseISO(v), spanDays <= 75 ? 'MMM d' : 'MMM yy').toUpperCase();

  const subtitle = payload.leader && metric === 'AUM'
    ? `Top curator: ${payload.leader.name} at ${usdC(payload.leader.aum)} (${(payload.leader.pct * 100).toFixed(1)}%)${payload.leader.delta30d != null ? `: ${payload.leader.delta30d >= 0 ? '+' : ''}${(payload.leader.delta30d * 100).toFixed(1)}% in 30 days` : ''}`
    : metric === 'CURATOR_FEES' && payload.feeReliableFrom
      ? `${METHODOLOGY.CURATOR_FEES} Per-vault fee capture begins ${format(parseISO(payload.feeReliableFrom), 'MMM d, yyyy')}; earlier history omitted (the source serves only the current fee).`
      : METHODOLOGY[metric];

  const toggle = (
    <div className="flex items-center gap-0.5 rounded-md border border-card-border p-0.5">
      {METRICS.map((m) => (
        <button key={m.key} onClick={() => setMetric(m.key)}
          className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-header-medium transition-colors ${metric === m.key ? 'bg-accent text-background' : 'text-text-muted hover:text-text-secondary'}`}>
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <ChartFrame title={`Curator ${titleWord} Over Time`} subtitle={subtitle}
      csvFilename="curator-aum-over-time.csv" csvContent={toCsv(data, keys)} rightControls={toggle}
      methodologyText={METHODOLOGY[metric]} methodologySource="morpho_.vault_state_daily × morpho_.vaults">
      {data.length === 0 ? (
        <div className="flex h-[340px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>
      ) : (
        <div>
          <ResponsiveContainer width="100%" height={340}>
            {isStacked ? (
              <AreaChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
                <XAxis dataKey="date" tickFormatter={xTickFmt} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} minTickGap={36} />
                <YAxis tickFormatter={usdC} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} width={62} />
                <Tooltip labelFormatter={(v: string) => format(parseISO(v), 'PP')} formatter={(v: unknown, n: unknown) => [typeof v === 'number' ? fmtV(v) : 'N/A', nameFor(String(n))]} contentStyle={tip} labelStyle={lblS} itemSorter={(it) => -(Number(it.value) || 0)} />
                {keys.map((k) => (<Area key={k} type="monotone" dataKey={k} stackId="1" stroke={colorFor(k)} fill={colorFor(k)} fillOpacity={0.55} strokeWidth={0.5} isAnimationActive={false} />))}
              </AreaChart>
            ) : (
              <LineChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
                <XAxis dataKey="date" tickFormatter={xTickFmt} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} minTickGap={36} />
                <YAxis tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={axis} tickLine={axis} width={48} />
                <Tooltip labelFormatter={(v: string) => format(parseISO(v), 'PP')} formatter={(v: unknown, n: unknown) => [typeof v === 'number' ? fmtV(v) : 'N/A', nameFor(String(n))]} contentStyle={tip} labelStyle={lblS} itemSorter={(it) => -(Number(it.value) || 0)} />
                {keys.map((k) => (<Line key={k} type="monotone" dataKey={k} stroke={colorFor(k)} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />))}
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
  return [head, ...data.map((p) => ['date', ...keys].map((k) => (p[k] == null ? '' : p[k])).join(','))].join('\n');
}

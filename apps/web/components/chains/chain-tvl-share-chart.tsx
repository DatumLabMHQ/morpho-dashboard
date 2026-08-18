'use client';

import { format, parseISO } from 'date-fns';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { TvlSharePoint } from '@/lib/queries/chain-detail';

interface Props {
  data: TvlSharePoint[];
}

const LOANS_COLOR = tokens.colors.accentSecondary; // purple, left axis
const SHARE_COLOR = tokens.colors.accent;          // orange, right axis

const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);
const fmtMonth = (iso: string) => {
  try { return format(parseISO(iso), 'MMM yyyy').toUpperCase(); } catch { return iso; }
};

type Row = TvlSharePoint & { loansMa: number | null };

// 7-day trailing moving average of active loans so the line shows the trend
// without daily oscillation. Raw daily values stay in the CSV export upstream.
function withMovingAverage(data: TvlSharePoint[]): Row[] {
  const win: number[] = [];
  return data.map((p) => {
    if (p.activeLoansUsd != null) {
      win.push(p.activeLoansUsd);
      if (win.length > 7) win.shift();
    }
    const ma = win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
    return { ...p, loansMa: p.activeLoansUsd != null ? ma : null };
  });
}

export function ChainTvlShareChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  const series = withMovingAverage(data);
  const crossover = series.find((p) => p.morphoSharePct != null && p.morphoSharePct >= 0.5);

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={series} margin={{ top: 24, right: 36, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={false}
          minTickGap={32}
        />
        <YAxis
          yAxisId="tvl"
          orientation="left"
          tickFormatter={(v: number) => fmtUsd(v)}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={false}
          tickLine={false}
          width={62}
        />
        <YAxis
          yAxisId="share"
          orientation="right"
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={false}
          tickLine={false}
          width={40}
          domain={[0, 1]}
        />
        <Tooltip
          labelFormatter={(v: string) => format(parseISO(v), 'PP')}
          formatter={(v: unknown, name: unknown) => {
            const n = typeof v === 'number' ? v : null;
            if (n == null) return ['N/A', String(name)];
            if (name === 'morphoSharePct') return [`${(n * 100).toFixed(1)}%`, 'Market share'];
            return [fmtUsd(n), 'Active loans (7d avg)'];
          }}
          contentStyle={{
            background: tokens.colors.tooltipBg,
            border: `1px solid ${tokens.colors.borderBright}`,
            borderRadius: tokens.radii.md,
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 11,
            color: tokens.colors.textPrimary,
          }}
          labelStyle={{ color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}
        />
        {crossover && (
          <ReferenceLine
            yAxisId="share"
            x={crossover.date}
            stroke={tokens.colors.textMuted}
            strokeDasharray="3 4"
            strokeWidth={1}
            label={{
              value: `Morpho passes 50% of chain lending: ${fmtMonth(crossover.date)}`,
              position: 'insideTopLeft',
              fill: tokens.colors.textSecondary,
              fontSize: 10,
              offset: 8,
            }}
          />
        )}
        <Line
          yAxisId="tvl"
          type="monotone"
          dataKey="loansMa"
          stroke={LOANS_COLOR}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          yAxisId="share"
          type="monotone"
          dataKey="morphoSharePct"
          stroke={SHARE_COLOR}
          strokeWidth={2}
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

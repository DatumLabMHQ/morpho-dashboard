'use client';

import { format, parseISO } from 'date-fns';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
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

const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

export function ChainTvlShareChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 12, right: 36, left: 12, bottom: 8 }}>
        <defs>
          <linearGradient id="tvlfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens.colors.accent} stopOpacity={0.4} />
            <stop offset="100%" stopColor={tokens.colors.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          minTickGap={32}
        />
        <YAxis
          yAxisId="tvl"
          orientation="left"
          tickFormatter={(v: number) => fmtUsd(v)}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={62}
        />
        <YAxis
          yAxisId="share"
          orientation="right"
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={40}
          domain={[0, (max: number) => Math.min(1, Math.max(0.2, Math.ceil(max * 10) / 10))]}
        />
        <Tooltip
          labelFormatter={(v: string) => format(parseISO(v), 'PP')}
          formatter={(v: unknown, name: unknown) => {
            const n = typeof v === 'number' ? v : null;
            if (n == null) return ['—', String(name)];
            if (name === 'morphoSharePct') return [`${(n * 100).toFixed(1)}%`, 'Morpho share'];
            return [fmtUsd(n), 'Morpho TVL'];
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
        <Area
          yAxisId="tvl"
          type="monotone"
          dataKey="morphoTvlUsd"
          stroke={tokens.colors.accent}
          strokeWidth={2}
          fill="url(#tvlfill)"
          isAnimationActive={false}
        />
        <Line
          yAxisId="share"
          type="monotone"
          dataKey="morphoSharePct"
          stroke={tokens.colors.accentSecondary}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

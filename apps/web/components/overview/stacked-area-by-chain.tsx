'use client';

import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { ChainSeries } from '@/lib/queries/overview';

interface Props { data: ChainSeries }

/**
 * Stacked area chart with one band per chain (top 8) + "Other" rolled up.
 * Used by Deposits-by-Chain and Active-Loans-by-Chain on the Overview.
 *
 * Colors come from the 8-color brand chart palette. "Other" gets a neutral
 * border color so it sits clearly behind the named chains.
 */
export function StackedAreaByChain({ data }: Props) {
  if (data.chains.length === 0 || data.points.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data.points} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="day"
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.06em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          minTickGap={48}
        />
        <YAxis
          tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={66}
        />
        <Tooltip
          labelFormatter={(v: string) => format(parseISO(v), 'PP')}
          formatter={(v: unknown, name: unknown) => {
            const n = typeof v === 'number' ? v : 0;
            const chain = data.chains.find((c) => c.slug === name);
            return [fmtUsd(n, { compact: true }), chain?.name ?? String(name)];
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
        <Legend
          wrapperStyle={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.colors.textMuted }}
          iconType="square"
        />
        {data.chains.map((c, i) => {
          const color =
            c.slug === 'Other'
              ? 'hsla(0, 0%, 100%, 0.25)'
              : tokens.colors.chart[i % tokens.colors.chart.length];
          return (
            <Area
              key={c.slug}
              type="monotone"
              dataKey={c.slug}
              name={c.name}
              stackId="chain"
              stroke={color}
              strokeWidth={0.75}
              fill={color}
              fillOpacity={0.55}
              isAnimationActive={false}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

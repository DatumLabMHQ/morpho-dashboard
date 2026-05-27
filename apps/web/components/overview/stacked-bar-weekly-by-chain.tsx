'use client';

import { format, parseISO } from 'date-fns';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { WeeklyChainSeries } from '@/lib/queries/overview';

interface Props { data: WeeklyChainSeries }

interface FlatBucket {
  weekStart: string;
  [chainSlug: string]: string | number;
}

/**
 * Stacked weekly bar chart with one segment per chain. Used by the
 * "weekly borrow interest" and "weekly curation fees" charts on
 * /overview. Data shape is { weekStart, [chain]: usd }; we pivot from
 * WeeklyChainSeries before handing it to Recharts.
 */
export function StackedBarWeeklyByChain({ data }: Props) {
  if (data.buckets.length === 0 || data.chains.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data yet — waiting on the weekly aggregation job to complete its first rebuild.
      </div>
    );
  }
  const flat: FlatBucket[] = data.buckets.map((b) => ({
    weekStart: b.weekStart,
    ...b.byChain,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={flat} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" vertical={false} />
        <XAxis
          dataKey="weekStart"
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.06em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          minTickGap={36}
        />
        <YAxis
          tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={66}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          labelFormatter={(v: string) => `Week of ${format(parseISO(v), 'PP')}`}
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
        {data.chains.map((c, i) => (
          <Bar
            key={c.slug}
            dataKey={c.slug}
            name={c.name}
            stackId="chain"
            fill={tokens.colors.chart[i % tokens.colors.chart.length]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

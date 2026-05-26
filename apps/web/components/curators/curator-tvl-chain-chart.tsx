'use client';

import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { CuratorTvlChainPoint } from '@/lib/queries/curators';

interface Props {
  data: CuratorTvlChainPoint[];
  chains: { slug: string; name: string; color: string }[];
}

const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

export function CuratorTvlChainChart({ data, chains }: Props) {
  if (data.length === 0 || chains.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No history</div>;
  }
  return (
    <div>
      <ResponsiveContainer width="100%" height={340}>
        <AreaChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
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
            tickFormatter={(v: number) => fmtUsd(v)}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={62}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              const ch = chains.find((c) => c.slug === String(name));
              return [n == null ? '—' : fmtUsd(n), ch?.name ?? String(name)];
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
            itemSorter={(it) => -(Number(it.value) || 0)}
          />
          {chains.map((c) => (
            <Area
              key={c.slug}
              type="monotone"
              dataKey={c.slug}
              stackId="1"
              stroke={c.color}
              fill={c.color}
              fillOpacity={0.7}
              strokeWidth={1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {chains.map((c) => (
          <div key={c.slug} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: c.color }} />
            <span className="text-tiny uppercase tracking-header-medium text-text-secondary">{c.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

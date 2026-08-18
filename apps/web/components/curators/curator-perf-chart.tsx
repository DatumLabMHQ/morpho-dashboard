'use client';

import { format, parseISO } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { PerfPoint } from '@/lib/queries/curators';

interface Props {
  data: PerfPoint[];
}

export function CuratorPerfChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[240px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No performance data</div>;
  }
  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => format(parseISO(v), 'MMM dd').toUpperCase()}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            minTickGap={36}
          />
          <YAxis
            tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={50}
            domain={['auto', 'auto']}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              const label = name === 'curatorNetApy' ? 'This curator' : 'Morpho-wide';
              return [n == null ? 'N/A' : `${(n * 100).toFixed(2)}%`, label];
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
          <Line
            type="monotone"
            dataKey="morphoNetApy"
            stroke="hsla(0, 0%, 100%, 0.4)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="curatorNetApy"
            stroke={tokens.colors.accent}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-2">
          <span className="block h-0.5 w-5 bg-accent" />
          <span className="text-tiny uppercase tracking-header-medium text-text-primary">This curator</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="block h-0.5 w-5" style={{ background: 'hsla(0, 0%, 100%, 0.4)' }} />
          <span className="text-tiny uppercase tracking-header-medium text-text-muted">Morpho-wide avg</span>
        </div>
      </div>
    </div>
  );
}

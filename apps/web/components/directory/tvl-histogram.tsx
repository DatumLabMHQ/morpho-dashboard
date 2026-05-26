'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { TvlHistogramBucket } from '@/lib/queries/vaults';

interface Props { data: TvlHistogramBucket[] }

// Log-scaled TVL distribution. Reveals the long tail — most vaults under $25M
// while a handful sit in the $1B+ band.
export function TvlHistogram({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }
  const maxIdx = data.reduce((m, r, i) => (r.vaultCount > data[m]!.vaultCount ? i : m), 0);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 12, bottom: 24 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="bucketLabel"
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.06em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          interval={0}
          angle={-25}
          textAnchor="end"
          height={36}
        />
        <YAxis
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={36}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          formatter={(v: unknown, _: unknown, ctx: unknown) => {
            const row = (ctx as { payload?: TvlHistogramBucket })?.payload;
            if (!row) return [String(v), ''];
            return [`${row.vaultCount} vaults · ${fmtUsd(row.totalUsd, { compact: true })}`, row.bucketLabel];
          }}
          labelFormatter={() => ''}
          contentStyle={{
            background: tokens.colors.tooltipBg,
            border: `1px solid ${tokens.colors.borderBright}`,
            borderRadius: tokens.radii.md,
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 11,
            color: tokens.colors.textPrimary,
          }}
        />
        <Bar dataKey="vaultCount" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === maxIdx ? tokens.colors.accent : 'hsla(255, 80%, 65%, 0.35)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

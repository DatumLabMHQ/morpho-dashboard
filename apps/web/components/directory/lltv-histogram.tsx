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
import type { LltvBucket } from '@/lib/queries/markets';

interface Props { data: LltvBucket[] }

// LLTV distribution weighted by supply USD. The bar height is "supply USD in
// this LLTV band". Quickly shows what loan-to-value risk Morpho's capital
// actually sits at.
export function LltvHistogram({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }
  const maxIdx = data.reduce((m, r, i) => (r.supplyUsd > data[m]!.supplyUsd ? i : m), 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="bucketLabel"
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
        />
        <YAxis
          tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={68}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          formatter={(v: unknown, _: unknown, ctx: unknown) => {
            const row = (ctx as { payload?: LltvBucket })?.payload;
            if (!row) return [String(v), ''];
            return [`${fmtUsd(row.supplyUsd, { compact: true })} · ${row.marketCount} markets`, row.bucketLabel];
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
        <Bar dataKey="supplyUsd" radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={i === maxIdx ? tokens.colors.accent : 'rgba(255, 129, 85, 0.35)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

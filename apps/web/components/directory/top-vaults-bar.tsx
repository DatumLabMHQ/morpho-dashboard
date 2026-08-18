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
import type { TopVaultBar } from '@/lib/queries/vaults';

interface Props { data: TopVaultBar[] }

export function TopVaultsBar({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No vault data
      </div>
    );
  }

  // Truncate long vault names so the y-axis stays readable.
  const formatted = data.map((d) => ({
    ...d,
    shortName: (d.name.length > 26 ? d.name.slice(0, 24) + '…' : d.name) + ` · ${d.chainSlug ?? ''}`,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={formatted} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
        />
        <YAxis
          type="category"
          dataKey="shortName"
          tick={{ fontSize: 10, fill: tokens.colors.textSecondary, letterSpacing: '0.05em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={200}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          formatter={(v: unknown, _: unknown, ctx: unknown) => {
            const row = (ctx as { payload?: TopVaultBar })?.payload;
            if (!row) return [String(v), ''];
            const apy = row.netApy == null ? '' : ` · ${(row.netApy * 100).toFixed(2)}% net APY`;
            return [fmtUsd(row.tvlUsd, { compact: true }) + apy, row.name];
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
        <Bar dataKey="tvlUsd" radius={[0, 2, 2, 0]}>
          {formatted.map((_, i) => (
            <Cell key={i} fill={i === 0 ? tokens.colors.accent : 'rgba(255, 129, 85, 0.35)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

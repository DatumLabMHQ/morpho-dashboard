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
import type { DepositsLoansPoint } from '@/lib/queries/overview';

interface Props { data: DepositsLoansPoint[] }

/**
 * Hero chart for the Overview page: stacked-style dual-area of Total
 * Deposits (upper band) and Active Loans (lower band). Visual gap
 * between the two = TVL.
 *
 * Not actually <stackOffset="expand">; we want the literal dollar values,
 * not normalized 0-1. The two areas are drawn back-to-back so the
 * Deposits area sits behind Loans.
 */
export function DualAreaChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id="depositsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={tokens.colors.accent} stopOpacity={0.45} />
            <stop offset="100%" stopColor={tokens.colors.accent} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="loansGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={tokens.colors.chart[3]} stopOpacity={0.55} />
            <stop offset="100%" stopColor={tokens.colors.chart[3]} stopOpacity={0.08} />
          </linearGradient>
        </defs>
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
            const label =
              name === 'totalDeposits' ? 'Total Deposits'
              : name === 'activeLoans' ? 'Active Loans'
              : name === 'tvl' ? 'TVL'
              : String(name);
            return [fmtUsd(n, { compact: true }), label];
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
        <Area
          type="monotone"
          dataKey="totalDeposits"
          name="Total Deposits"
          stroke={tokens.colors.accent}
          strokeWidth={1.5}
          fill="url(#depositsGrad)"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="activeLoans"
          name="Active Loans"
          stroke={tokens.colors.chart[3]}
          strokeWidth={1.5}
          fill="url(#loansGrad)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

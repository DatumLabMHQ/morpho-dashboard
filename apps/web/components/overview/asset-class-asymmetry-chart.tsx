'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { AssetClassAsymmetryRow } from '@/lib/queries/overview';

const DEPOSITS_COLOR = '#6B85FF'; // muted blue
const INTEREST_COLOR = tokens.colors.accent; // orange accent

interface Props {
  rows: AssetClassAsymmetryRow[];
}

const lbl = (v: number) => (v > 0 && v < 1 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`);

export function AssetClassAsymmetryChart({ rows }: Props) {
  const data = rows.map((r) => ({
    label: r.label,
    deposits: +(r.depositsPct * 100).toFixed(1),
    interest: +(r.interestPct * 100).toFixed(1),
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 8 }} barCategoryGap="24%" barGap={4}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: tokens.colors.textSecondary, letterSpacing: '0.04em' }}
            axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: 'hsla(0,0%,100%,0.04)' }}
            formatter={(v: unknown, name: unknown) => [
              typeof v === 'number' ? `${v}%` : 'N/A',
              name === 'deposits' ? 'Share of deposits' : 'Share of borrow interest',
            ]}
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
          <Bar dataKey="deposits" fill={DEPOSITS_COLOR} radius={[3, 3, 0, 0]} maxBarSize={54} isAnimationActive={false}>
            <LabelList dataKey="deposits" position="top" formatter={lbl} style={{ fill: tokens.colors.textSecondary, fontSize: 10, fontFamily: tokens.typography.fontFamilyMono }} />
          </Bar>
          <Bar dataKey="interest" fill={INTEREST_COLOR} radius={[3, 3, 0, 0]} maxBarSize={54} isAnimationActive={false}>
            <LabelList dataKey="interest" position="top" formatter={lbl} style={{ fill: INTEREST_COLOR, fontSize: 10, fontWeight: 700, fontFamily: tokens.typography.fontFamilyMono }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: DEPOSITS_COLOR }} />
          <span className="text-tiny uppercase tracking-header-medium text-text-muted">Share of deposits (supply + collateral)</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: INTEREST_COLOR }} />
          <span className="text-tiny uppercase tracking-header-medium text-text-muted">Share of annualized borrow interest</span>
        </span>
      </div>
    </div>
  );
}

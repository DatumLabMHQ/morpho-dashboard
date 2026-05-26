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
import type { RateBucket } from '@/lib/queries/rates';

interface Props {
  data: RateBucket[];
  // Color highlight follows the highest-supply bucket so the "where the money
  // sits" cluster jumps out at a glance.
  accent?: string;
  /** "supply" = bars colored by USD, label below shows market count. */
  mode?: 'supply' | 'markets';
}

export function RateHistogram({ data, accent = tokens.colors.accent, mode = 'supply' }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }

  const valueKey = mode === 'supply' ? 'supplyUsd' : 'marketCount';
  const maxIdx = data.reduce((m, r, i) => (r.supplyUsd > data[m]!.supplyUsd ? i : m), 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="bucketLabel"
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
        />
        <YAxis
          tickFormatter={(v: number) =>
            mode === 'supply' ? fmtUsd(v, { compact: true }) : String(v)
          }
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={70}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          formatter={(v: unknown, _: unknown, ctx: unknown) => {
            const row = (ctx as { payload?: RateBucket })?.payload;
            if (!row) return [String(v), ''];
            return [
              mode === 'supply'
                ? `${fmtUsd(row.supplyUsd, { compact: true })} · ${row.marketCount} mkts`
                : `${row.marketCount} markets · ${fmtUsd(row.supplyUsd, { compact: true })}`,
              row.bucketLabel,
            ];
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
        <Bar dataKey={valueKey} radius={[2, 2, 0, 0]}>
          {data.map((_, i) => (
            <Cell
              key={i}
              fill={i === maxIdx ? accent : 'hsla(255, 80%, 65%, 0.35)'}
              stroke={i === maxIdx ? accent : 'transparent'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

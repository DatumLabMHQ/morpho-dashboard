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

export interface HBar {
  label: string;          // y-axis row label (already includes chain/curator suffix)
  value: number;          // bar length (USD)
  color: string;          // bar fill
  tooltipTitle: string;
  tooltipLines: string[];
}

interface Props {
  data: HBar[];
  height?: number;
  /** x-axis + bar value formatter */
  valueFormatter?: (v: number) => string;
  yAxisWidth?: number;
}

// Generic horizontal bar chart for top-N rankings. Each bar carries its own
// color (e.g. by chain or by collateral asset class).
export function HorizontalBar({ data, height = 300, valueFormatter, yAxisWidth = 220 }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  const fmt = valueFormatter ?? ((v: number) => fmtUsd(v, { compact: true }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={fmt}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 10, fill: tokens.colors.textSecondary, letterSpacing: '0.04em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={yAxisWidth}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          content={({ payload }) => {
            if (!payload || !payload.length) return null;
            const d = payload[0]!.payload as HBar;
            return (
              <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.tooltipTitle}</div>
                {d.tooltipLines.map((ln, i) => (
                  <div key={i} style={{ color: tokens.colors.textSecondary, marginTop: i === 0 ? 4 : 0 }}>{ln}</div>
                ))}
              </div>
            );
          }}
        />
        <Bar dataKey="value" radius={[0, 2, 2, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

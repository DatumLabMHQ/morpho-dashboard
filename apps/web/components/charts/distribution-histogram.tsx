'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';

export interface HistogramBar {
  label: string;
  /** bar height (count or USD, per heightMode) */
  height: number;
  /** lines shown in the tooltip body */
  tooltipLines: string[];
  /** optional per-bar color override (e.g. dominant asset class) */
  color?: string;
}

interface Props {
  data: HistogramBar[];
  /** how to format the y-axis ticks (kept as a string flag so this client
   *  component can be used from server components without passing a function) */
  yFormat?: 'count' | 'usd';
  /** highlight the tallest bar with the accent color (ignored when bars carry their own color) */
  highlightMax?: boolean;
  height?: number;
}

const countFmt = new Intl.NumberFormat('en-US');

// Generic distribution histogram. Drives both the vault AUM distribution
// (height = vault count) and the market LLTV distribution (height = supply USD).
// Solid, uniformly-coloured bars with a value label on each: the standard
// look for a binned distribution.
export function DistributionHistogram({ data, yFormat = 'count', height = 260 }: Props) {
  const isUsd = yFormat === 'usd';
  const yTickFormatter = isUsd ? (v: number) => fmtUsd(v, { compact: true }) : (v: number) => countFmt.format(v);
  const labelFormatter = isUsd
    ? (v: number) => (v > 0 ? fmtUsd(v, { compact: true }) : '')
    : (v: number) => (v > 0 ? countFmt.format(v) : '');
  if (data.length === 0) {
    return <div className="flex h-[220px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 16, left: 12, bottom: 28 }} barCategoryGap="18%">
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.06em' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          tickLine={false}
          interval={0}
          height={36}
        />
        <YAxis
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={yTickFormatter}
        />
        <Tooltip
          cursor={{ fill: 'hsla(0, 0%, 100%, 0.04)' }}
          content={({ payload }) => {
            if (!payload || !payload.length) return null;
            const d = payload[0]!.payload as HistogramBar;
            return (
              <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.label}</div>
                {d.tooltipLines.map((ln, i) => (
                  <div key={i} style={{ color: tokens.colors.textSecondary, marginTop: i === 0 ? 4 : 0 }}>{ln}</div>
                ))}
              </div>
            );
          }}
        />
        <Bar dataKey="height" radius={[3, 3, 0, 0]} maxBarSize={72} isAnimationActive={false}>
          <LabelList
            dataKey="height"
            position="top"
            formatter={labelFormatter}
            style={{ fill: tokens.colors.textSecondary, fontSize: 10, fontFamily: tokens.typography.fontFamilyMono }}
          />
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? tokens.colors.accent} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

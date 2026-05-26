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
import type { ClassShareOverTimePoint } from '@/lib/queries/assets';

interface Props {
  data: ClassShareOverTimePoint[];
}

const CATEGORY_COLOR: Record<string, string> = {
  stablecoin: tokens.colors.chart[1],   // green
  lst:        tokens.colors.chart[4],   // cyan
  lrt:        tokens.colors.chart[7],   // indigo
  btc:        tokens.colors.chart[2],   // yellow
  eth:        tokens.colors.chart[0],   // blue
  rwa:        tokens.colors.chart[3],   // purple
  other:      'hsla(0, 0%, 100%, 0.30)',
};

const CATEGORY_LABEL: Record<string, string> = {
  stablecoin: 'Stablecoin',
  lst: 'LST',
  lrt: 'LRT',
  btc: 'BTC',
  eth: 'ETH',
  rwa: 'RWA',
  other: 'Other',
};

const ORDER = ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];

export function ClassShareChart({ data }: Props) {
  if (data.length === 0) {
    return <div className="flex h-[340px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={data} margin={{ top: 12, right: 24, left: 12, bottom: 8 }}>
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
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={44}
            domain={[0, 1]}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              const label = CATEGORY_LABEL[String(name)] ?? String(name);
              return [n == null ? '—' : `${(n * 100).toFixed(1)}%`, label];
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
          {ORDER.map((cat) => (
            <Line
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={CATEGORY_COLOR[cat]}
              strokeWidth={cat === 'stablecoin' ? 2.5 : 1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {ORDER.map((cat) => (
          <div key={cat} className="flex items-center gap-2">
            <span className="block h-0.5 w-5" style={{ background: CATEGORY_COLOR[cat] }} />
            <span className="text-tiny uppercase tracking-header-medium text-text-secondary">
              {CATEGORY_LABEL[cat]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

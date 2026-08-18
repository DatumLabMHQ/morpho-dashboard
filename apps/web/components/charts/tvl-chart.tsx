'use client';

import { format, parseISO } from 'date-fns';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface TvlChartPoint {
  date: string;          // YYYY-MM-DD
  morpho: number | null;
  aave: number | null;
  spark: number | null;
}

const fmtCompactUsd = (v: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);

const fmtFullUsd = (v: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

export function TvlChart({ data }: { data: TvlChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-neutral-500">
        No TVL series yet. Run the sync, then reload.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yy')}
          tick={{ fontSize: 11, fill: '#737373' }}
          minTickGap={32}
        />
        <YAxis
          tickFormatter={(v: number) => fmtCompactUsd(v)}
          tick={{ fontSize: 11, fill: '#737373' }}
          width={60}
        />
        <Tooltip
          labelFormatter={(v: string) => format(parseISO(v), 'PP')}
          formatter={(v: unknown, name: unknown) => {
            const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
            return [n == null ? 'N/A' : fmtFullUsd(n), String(name)];
          }}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e5e5' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Line
          type="monotone"
          dataKey="morpho"
          stroke="#4f46e5"
          strokeWidth={2}
          dot={false}
          name="Morpho"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="aave"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          name="Aave V3"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="spark"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          name="SparkLend"
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

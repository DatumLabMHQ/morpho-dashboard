'use client';

import { format, parseISO } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { ChainMetaRow, SharePoint } from '@/lib/queries/chains';

interface Props {
  data: SharePoint[];
  chains: ChainMetaRow[];
  reportMode?: boolean;
}

const Y_TICK = (v: number) => `${(v * 100).toFixed(0)}%`;
const X_TICK = (v: string) => format(parseISO(v), 'MMM yy').toUpperCase();

export function ShareByChainChart({ data, chains, reportMode = false }: Props) {
  if (data.length === 0 || chains.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data yet
      </div>
    );
  }

  const highlightedStroke = reportMode ? 3.5 : 2.5;
  const otherStroke = reportMode ? 1.25 : 1;
  const fontSize = reportMode ? 12 : 10;
  const height = reportMode ? 600 : 420;

  const latestPerHighlighted = chains
    .filter((c) => c.isHighlighted)
    .map((c) => {
      for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]![c.chainSlug];
        if (typeof v === 'number' && Number.isFinite(v)) {
          return { chain: c, date: data[i]!.date as string, value: v };
        }
      }
      return null;
    })
    .filter((x): x is { chain: ChainMetaRow; date: string; value: number } => x !== null);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 130, left: 12, bottom: 16 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
        <XAxis
          dataKey="date"
          tickFormatter={X_TICK}
          tick={{ fontSize, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          minTickGap={36}
        />
        <YAxis
          tickFormatter={Y_TICK}
          tick={{ fontSize, fill: tokens.colors.textMuted }}
          tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
          width={42}
          domain={[0, (max: number) => Math.min(1, Math.max(0.2, Math.ceil(max * 10) / 10))]}
        />
        <Tooltip
          labelFormatter={(v: string) => format(parseISO(v), 'PP')}
          formatter={(v: unknown, name: unknown) => {
            const n = typeof v === 'number' && Number.isFinite(v) ? v : null;
            const chain = chains.find((c) => c.chainSlug === String(name));
            return [n == null ? 'N/A' : `${(n * 100).toFixed(1)}%`, chain?.chainName ?? String(name)];
          }}
          contentStyle={{
            background: tokens.colors.tooltipBg,
            border: `1px solid ${tokens.colors.borderBright}`,
            borderRadius: tokens.radii.md,
            boxShadow: `0 8px 24px ${tokens.colors.tooltipShadow}`,
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 11,
            color: tokens.colors.textPrimary,
            padding: '8px 12px',
          }}
          labelStyle={{
            color: tokens.colors.textMuted,
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 4,
          }}
          itemStyle={{ color: tokens.colors.textPrimary }}
          itemSorter={(item) => -(Number(item.value) || 0)}
        />
        {chains
          .filter((c) => !c.isHighlighted)
          .map((c) => (
            <Line
              key={c.chainSlug}
              type="monotone"
              dataKey={c.chainSlug}
              stroke={c.color}
              strokeWidth={otherStroke}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        {chains
          .filter((c) => c.isHighlighted)
          .map((c) => (
            <Line
              key={c.chainSlug}
              type="monotone"
              dataKey={c.chainSlug}
              stroke={c.color}
              strokeWidth={highlightedStroke}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        {latestPerHighlighted.map((p) => (
          <ReferenceDot
            key={`${p.chain.chainSlug}-anno`}
            x={p.date}
            y={p.value}
            r={5}
            fill={p.chain.color}
            stroke={tokens.colors.background}
            strokeWidth={2}
            ifOverflow="extendDomain"
            label={{
              value: `${p.chain.chainName.toUpperCase()} ${(p.value * 100).toFixed(0)}%`,
              position: 'right',
              fill: p.chain.color,
              fontSize: reportMode ? 13 : 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              offset: 10,
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

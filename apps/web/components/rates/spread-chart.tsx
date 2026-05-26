'use client';

import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import type { SpreadSeries } from '@/lib/queries/rates';

interface Props {
  series: SpreadSeries[];
}

// Two-tab chart: "APY" overlays Morpho vs Aave absolute rates; "Spread"
// shows the Morpho - Aave difference in bps. Each series picks the active
// (asset, chain) tab so the operator can drill into one comparison at a time.
export function MorphoVsAaveSpreadChart({ series }: Props) {
  const [mode, setMode] = useState<'apy' | 'spread'>('spread');
  const [tabIdx, setTabIdx] = useState(0);

  if (series.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No rate data
      </div>
    );
  }

  // Default tab to USDC on Ethereum if present.
  const defaultIdx = series.findIndex((s) => s.asset === 'USDC' && s.chainId === 1);
  const startIdx = defaultIdx >= 0 ? defaultIdx : 0;
  const active = series[tabIdx >= 0 && tabIdx < series.length ? tabIdx : startIdx]!;

  return (
    <div>
      {/* Asset/chain tab pills */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {series.map((s, i) => {
          const label = `${s.asset} · ${s.chainName}`;
          const sel = i === tabIdx || (tabIdx < 0 && i === startIdx);
          return (
            <button
              key={`${s.asset}-${s.chainId}`}
              onClick={() => setTabIdx(i)}
              className={`rounded-md border px-2 py-0.5 text-tiny uppercase tracking-header-medium ${
                sel
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-background text-text-muted hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setMode('spread')}
            className={`rounded-md border px-2 py-0.5 text-tiny uppercase tracking-header-medium ${
              mode === 'spread'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-background text-text-muted hover:text-text-primary'
            }`}
          >
            Spread (bps)
          </button>
          <button
            onClick={() => setMode('apy')}
            className={`rounded-md border px-2 py-0.5 text-tiny uppercase tracking-header-medium ${
              mode === 'apy'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-background text-text-muted hover:text-text-primary'
            }`}
          >
            APY (both)
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={active.points} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => format(parseISO(v), 'MMM dd').toUpperCase()}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            minTickGap={36}
          />
          <YAxis
            tickFormatter={(v: number) => (mode === 'apy' ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(0)}`)}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={56}
            domain={['auto', 'auto']}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              if (mode === 'apy') {
                return [n == null ? '—' : `${(n * 100).toFixed(2)}%`, name === 'morphoApy' ? 'Morpho' : 'Aave V3'];
              }
              return [n == null ? '—' : `${n.toFixed(0)} bps`, 'Morpho − Aave'];
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
          {mode === 'spread' && (
            <ReferenceLine y={0} stroke="hsla(0, 0%, 100%, 0.25)" strokeDasharray="3 3" />
          )}
          {mode === 'apy' ? (
            <>
              <Line
                type="monotone"
                dataKey="aaveApy"
                stroke="hsla(0, 0%, 100%, 0.5)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="morphoApy"
                stroke={tokens.colors.accent}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </>
          ) : (
            <Line
              type="monotone"
              dataKey="spreadBps"
              stroke={tokens.colors.accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {mode === 'apy' && (
          <>
            <div className="flex items-center gap-2">
              <span className="block h-0.5 w-5 bg-accent" />
              <span className="text-tiny uppercase tracking-header-medium text-text-primary">Morpho (weighted)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="block h-0.5 w-5" style={{ background: 'hsla(0, 0%, 100%, 0.5)' }} />
              <span className="text-tiny uppercase tracking-header-medium text-text-muted">Aave V3</span>
            </div>
          </>
        )}
        {mode === 'spread' && (
          <div className="flex items-center gap-2">
            <span className="block h-0.5 w-5 bg-accent" />
            <span className="text-tiny uppercase tracking-header-medium text-text-primary">
              Morpho minus Aave (bps)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

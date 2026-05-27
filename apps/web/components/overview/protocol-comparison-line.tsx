'use client';

import { format, parseISO } from 'date-fns';
import { useMemo } from 'react';
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

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import { BRAND_COLORS } from '@/lib/protocols/comparison-set';
import type { ProtocolComparisonResult } from '@/lib/queries/overview';

interface Props {
  data: ProtocolComparisonResult;
  /** When false, omit the CDP lines (still in data, just not rendered). */
  showCdp: boolean;
}

interface RowShape {
  day: string;
  [key: string]: string | number;
}

/**
 * Multi-line TVL comparison across the lending sector. Two visual layers:
 *   - Lending protocols (LENDING_PROTOCOLS.overcollateralized) — solid lines,
 *     full opacity. Drawn last so they sit on top.
 *   - CDP protocols (LENDING_PROTOCOLS.cdp) — dashed lines, ~40% opacity.
 *     Drawn first as the background layer.
 *
 * `data.collapsedLegacy` (set by the data layer) controls whether v2+v3
 * are aggregated into one line per brand. Color comes from BRAND_COLORS:
 * legacy variants get the lighter shade so the brand stays identifiable.
 */
export function ProtocolComparisonLine({ data, showCdp }: Props) {
  // Wide-pivot { day: { key: tvl, ... } } across both layers.
  const flatRows: RowShape[] = useMemo(() => {
    const byDay = new Map<string, RowShape>();
    const all = [...data.lending, ...(showCdp ? data.cdp : [])];
    for (const s of all) {
      for (const p of s.points) {
        let r = byDay.get(p.day);
        if (!r) { r = { day: p.day }; byDay.set(p.day, r); }
        r[s.key] = p.tvl;
      }
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [data, showCdp]);

  if (flatRows.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }

  const colorFor = (brand: string, legacy: boolean) => {
    const c = BRAND_COLORS[brand];
    if (!c) return tokens.colors.textMuted;
    return legacy ? c.legacy : c.primary;
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={flatRows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
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
              const all = [...data.lending, ...data.cdp];
              const series = all.find((s) => s.key === name);
              return [fmtUsd(n, { compact: true }), series?.label ?? String(name)];
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
          {/* Background layer: CDP dashed */}
          {showCdp && data.cdp.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colorFor(s.brand, s.legacy)}
              strokeWidth={1.2}
              strokeDasharray="4 3"
              strokeOpacity={0.55}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          {/* Top layer: lending solid */}
          {data.lending.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={colorFor(s.brand, s.legacy)}
              strokeWidth={s.brand === 'morpho' ? 2.4 : 1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Custom legend grouped LENDING / CDP. Recharts' built-in legend
          doesn't group, so we render our own. */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-tiny uppercase tracking-header-medium">
        <LegendGroup title="Lending" series={data.lending} colorFor={colorFor} solid />
        {showCdp && data.cdp.length > 0 && (
          <LegendGroup title="CDP" series={data.cdp} colorFor={colorFor} solid={false} />
        )}
      </div>
    </div>
  );
}

interface LegendGroupProps {
  title: string;
  series: { key: string; label: string; brand: string; legacy: boolean }[];
  colorFor: (brand: string, legacy: boolean) => string;
  solid: boolean;
}

function LegendGroup({ title, series, colorFor, solid }: LegendGroupProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-text-muted">{title}:</span>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-text-secondary">
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 0,
              borderBottom: `${solid ? '2px solid' : '2px dashed'} ${colorFor(s.brand, s.legacy)}`,
            }}
          />
          {s.label}
        </span>
      ))}
    </div>
  );
}

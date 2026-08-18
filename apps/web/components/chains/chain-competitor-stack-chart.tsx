'use client';

import { format, parseISO } from 'date-fns';
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
import type { CompetitorMeta, CompetitorPoint } from '@/lib/queries/chain-detail';

interface Props {
  data: CompetitorPoint[];
  meta: CompetitorMeta[];
}

const fmtUsd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);
const fmtMonth = (iso: string) => {
  try { return format(parseISO(iso), 'MMM yyyy').toUpperCase(); } catch { return iso; }
};

// 7-day trailing moving average per protocol. MA is emitted only on days a
// protocol actually reported, so a line never extends past its last data point;
// connectNulls bridges intermediate gaps.
function withMovingAverage(data: CompetitorPoint[], slugs: string[]): CompetitorPoint[] {
  const wins: Record<string, number[]> = {};
  for (const s of slugs) wins[s] = [];
  return data.map((p) => {
    const out: CompetitorPoint = { date: p.date };
    for (const s of slugs) {
      const v = p[s];
      if (typeof v === 'number') {
        wins[s]!.push(v);
        if (wins[s]!.length > 7) wins[s]!.shift();
        out[s] = wins[s]!.reduce((a, b) => a + b, 0) / wins[s]!.length;
      } else {
        out[s] = null;
      }
    }
    return out;
  });
}

export function ChainCompetitorStackChart({ data, meta }: Props) {
  if (data.length === 0 || meta.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }

  const slugs = meta.map((m) => m.protocolSlug);
  const series = withMovingAverage(data, slugs);

  // Crossover: first day Morpho's TVL first exceeds Aave V3's. Computed on the
  // RAW series (not the moving average) so it matches the subtitle and the
  // "first exceeded" definition; the dotted guide marks that date.
  let crossover: string | null = null;
  const hasAave = slugs.includes('aave-v3');
  if (hasAave) {
    for (const p of data) {
      const mo = p['morpho-blue'];
      const av = p['aave-v3'];
      if (typeof mo === 'number' && typeof av === 'number' && mo > av) { crossover = p.date; break; }
    }
  }

  // Largest single-step drop in Aave V3's averaged TVL (the late-Apr-2026
  // outflow). Annotated only when the fall is material (> 15%).
  let aaveDrop: { date: string } | null = null;
  if (hasAave) {
    let worst = 0;
    let prev: number | null = null;
    for (const p of series) {
      const v = p['aave-v3'];
      if (typeof v === 'number') {
        if (prev != null && prev > 0) {
          const chg = (v - prev) / prev;
          if (chg < worst && chg < -0.15) { worst = chg; aaveDrop = { date: p.date }; }
        }
        prev = v;
      }
    }
  }

  // Draw Morpho last (on top) with the thickest stroke.
  const ordered = [...meta].sort((a, b) => Number(a.isMorpho) - Number(b.isMorpho));

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={series} margin={{ top: 24, right: 16, left: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0, 0%, 100%, 0.06)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => format(parseISO(v), 'MMM yy').toUpperCase()}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted, letterSpacing: '0.08em' }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(v: number) => fmtUsd(v)}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={false}
            tickLine={false}
            width={62}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              const proto = meta.find((m) => m.protocolSlug === String(name));
              return [n == null ? 'N/A' : fmtUsd(n), proto?.name ?? String(name)];
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
          {crossover && (
            <ReferenceLine
              x={crossover}
              stroke={tokens.colors.textMuted}
              strokeDasharray="3 4"
              strokeWidth={1}
              label={{ value: `Morpho overtakes Aave V3: ${fmtMonth(crossover)}`, position: 'insideTopLeft', fill: tokens.colors.textSecondary, fontSize: 10, offset: 8 }}
            />
          )}
          {aaveDrop && (
            <ReferenceLine
              x={aaveDrop.date}
              stroke={tokens.colors.textMuted}
              strokeDasharray="3 4"
              strokeWidth={1}
              label={{ value: `Aave V3 outflow: ${fmtMonth(aaveDrop.date)}`, position: 'insideTopRight', fill: tokens.colors.textSecondary, fontSize: 10, offset: 8 }}
            />
          )}
          {ordered.map((m) => (
            <Line
              key={m.protocolSlug}
              type="monotone"
              dataKey={m.protocolSlug}
              stroke={m.color}
              strokeWidth={m.isMorpho ? 2.5 : 1.25}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {meta.map((m) => (
          <div key={m.protocolSlug} className="flex items-center gap-2">
            <span className="inline-block h-[3px] w-4 rounded-sm" style={{ background: m.color }} />
            <span className={`text-tiny uppercase tracking-header-medium ${m.isMorpho ? 'text-text-primary' : 'text-text-muted'}`}>
              {m.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

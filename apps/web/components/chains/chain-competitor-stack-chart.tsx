'use client';

import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  CartesianGrid,
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

export function ChainCompetitorStackChart({ data, meta }: Props) {
  if (data.length === 0 || meta.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }

  // Stack order: non-Morpho first (so Morpho lands on top of the visual stack
  // and reads as the lead band when growth is the story).
  const ordered = [...meta].sort((a, b) => Number(a.isMorpho) - Number(b.isMorpho));

  return (
    <div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={data} margin={{ top: 12, right: 16, left: 12, bottom: 8 }}>
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
            tickFormatter={(v: number) => fmtUsd(v)}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }}
            axisLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            tickLine={{ stroke: 'hsla(0, 0%, 100%, 0.12)' }}
            width={62}
          />
          <Tooltip
            labelFormatter={(v: string) => format(parseISO(v), 'PP')}
            formatter={(v: unknown, name: unknown) => {
              const n = typeof v === 'number' ? v : null;
              const proto = meta.find((m) => m.protocolSlug === String(name));
              return [n == null ? '—' : fmtUsd(n), proto?.name ?? String(name)];
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
          {ordered.map((m) => (
            <Area
              key={m.protocolSlug}
              type="monotone"
              dataKey={m.protocolSlug}
              stackId="1"
              stroke={m.color}
              fill={m.color}
              fillOpacity={m.isMorpho ? 0.85 : 0.45}
              strokeWidth={m.isMorpho ? 1.5 : 0.5}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {meta.map((m) => (
          <div key={m.protocolSlug} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: m.color, opacity: m.isMorpho ? 1 : 0.7 }} />
            <span
              className={`text-tiny uppercase tracking-header-medium ${m.isMorpho ? 'text-text-primary' : 'text-text-muted'}`}
            >
              {m.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

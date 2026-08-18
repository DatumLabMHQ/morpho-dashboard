'use client';

import { format, parseISO } from 'date-fns';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';

interface Props {
  chains: { slug: string; name: string; color: string }[];
  points: { weekStart: string; [chain: string]: string | number }[];
}

export function AssetFlowsChart({ chains, points }: Props) {
  if (points.length === 0) return <div className="flex h-[280px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No weekly history</div>;
  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={points} margin={{ top: 12, right: 16, left: 12, bottom: 8 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
          <XAxis dataKey="weekStart" tickFormatter={(v: string) => format(parseISO(v), 'd MMM')} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} minTickGap={16} />
          <YAxis tickFormatter={(v: number) => fmtUsd(v, { compact: true })} tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} width={62} />
          <ReferenceLine y={0} stroke="hsla(0,0%,100%,0.25)" />
          <Tooltip cursor={{ fill: 'hsla(0,0%,100%,0.04)' }} labelFormatter={(v: string) => `Week of ${format(parseISO(v), 'PP')}`}
            formatter={(v: unknown, n: unknown) => [fmtUsd(Number(v), { compact: true }), chains.find((c) => c.slug === n)?.name ?? String(n)]}
            contentStyle={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}
            labelStyle={{ color: tokens.colors.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }} />
          {chains.map((c) => (<Bar key={c.slug} dataKey={c.slug} stackId="flow" fill={c.color} fillOpacity={0.8} isAnimationActive={false} />))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {chains.map((c) => (<div key={c.slug} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: c.color }} /><span className="text-tiny uppercase tracking-header-medium text-text-muted">{c.name}</span></div>))}
      </div>
    </div>
  );
}

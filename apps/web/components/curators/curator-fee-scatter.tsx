'use client';

import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { FeeStructurePoint } from '@/lib/queries/curators';

interface Props { points: FeeStructurePoint[] }

export function CuratorFeeScatter({ points }: Props) {
  const data = points
    .filter((p) => p.feeBps != null && p.tvlUsd > 0)
    .map((p) => ({ x: (p.feeBps ?? 0) / 100, y: p.tvlUsd, z: Math.max(0, (p.netApy ?? 0) * 100), name: p.name, net: p.netApy }));
  if (data.length === 0) {
    return <div className="flex h-[320px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No vaults with fee data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
        <XAxis type="number" dataKey="x" name="Fee" unit="%" domain={[0, 'dataMax']}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }}
          label={{ value: 'PERFORMANCE FEE', position: 'bottom', offset: 4, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
        <YAxis type="number" dataKey="y" name="TVL" tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
          tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} width={56}
          label={{ value: 'VAULT TVL', angle: -90, position: 'left', offset: -10, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
        <ZAxis type="number" dataKey="z" range={[50, 700]} name="Net APY" />
        <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'hsla(0,0%,100%,0.2)' }}
          content={({ payload }) => {
            if (!payload || !payload.length) return null;
            const d = payload[0]!.payload as typeof data[number];
            return (
              <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.name}</div>
                <div style={{ color: tokens.colors.textSecondary, marginTop: 4 }}>Fee: {d.x.toFixed(1)}%</div>
                <div style={{ color: tokens.colors.textSecondary }}>TVL: {fmtUsd(d.y, { compact: true })}</div>
                <div style={{ color: tokens.colors.textSecondary }}>Net APY: {d.net == null ? 'N/A' : `${(d.net * 100).toFixed(2)}%`}</div>
              </div>
            );
          }} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((_, i) => (<Cell key={i} fill={tokens.colors.accent} fillOpacity={0.55} stroke={tokens.colors.accent} strokeOpacity={0.9} />))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

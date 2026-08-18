'use client';

import { CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, ASSET_CLASS_ORDER } from '@/lib/assets/asset-class';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { AssetVelocityPoint } from '@/lib/queries/assets';

interface Props { points: AssetVelocityPoint[] }

export function AssetVelocityScatter({ points }: Props) {
  const data = points
    .filter((p) => p.supply30dDeltaPct != null && p.totalSupply > 0)
    .map((p) => ({ x: (p.supply30dDeltaPct ?? 0) * 100, y: p.totalSupply, z: Math.max(1, p.marketCount), name: p.symbol, cls: p.category, annotate: p.annotate, quadrant: p.quadrant }));
  if (data.length === 0) return <div className="flex h-[360px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  const used = ASSET_CLASS_ORDER.filter((c) => data.some((d) => d.cls === c));

  return (
    <div>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 16, right: 24, left: 12, bottom: 28 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
          <XAxis type="number" dataKey="x" name="30d supply growth" unit="%"
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }}
            label={{ value: '30D SUPPLY GROWTH', position: 'bottom', offset: 6, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <YAxis type="number" dataKey="y" name="Total supply" scale="log" domain={['auto', 'auto']} tickFormatter={(v: number) => fmtUsd(v, { compact: true })}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} width={56}
            label={{ value: 'TOTAL SUPPLY (log)', angle: -90, position: 'left', offset: -8, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <ZAxis type="number" dataKey="z" range={[50, 900]} name="markets" />
          <ReferenceLine x={0} stroke="hsla(0,0%,100%,0.18)" strokeDasharray="3 3" />
          <Tooltip cursor={{ strokeDasharray: '3 3', stroke: 'hsla(0,0%,100%,0.2)' }}
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0]!.payload as typeof data[number];
              return (
                <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                  <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.name}</div>
                  <div style={{ color: tokens.colors.textSecondary, marginTop: 4 }}>Supply: {fmtUsd(d.y, { compact: true })}</div>
                  <div style={{ color: tokens.colors.textSecondary }}>30d growth: {d.x >= 0 ? '+' : ''}{d.x.toFixed(1)}%</div>
                  <div style={{ color: tokens.colors.textSecondary }}>Markets: {d.z}</div>
                  <div style={{ color: tokens.colors.textMuted, marginTop: 2 }}>{d.quadrant}</div>
                </div>
              );
            }} />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d, i) => (<Cell key={i} fill={ASSET_CLASS_COLOR[d.cls as keyof typeof ASSET_CLASS_COLOR]} fillOpacity={0.6} stroke={ASSET_CLASS_COLOR[d.cls as keyof typeof ASSET_CLASS_COLOR]} />))}
            <LabelList dataKey="name" position="top" content={(props: any) => {
              const { x, y, value, index } = props;
              if (index == null || !data[index]?.annotate) return null;
              return <text x={x} y={y - 8} fill={tokens.colors.textSecondary} fontSize={9} textAnchor="middle" style={{ letterSpacing: '0.05em' }}>{value}</text>;
            }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {used.map((c) => (<div key={c} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: ASSET_CLASS_COLOR[c] }} /><span className="text-tiny uppercase tracking-header-medium text-text-muted">{ASSET_CLASS_LABEL[c]}</span></div>))}
        <span className="text-tiny text-text-muted">· bubble = # markets · labels = top 5 growers / 3 shrinkers</span>
      </div>
    </div>
  );
}

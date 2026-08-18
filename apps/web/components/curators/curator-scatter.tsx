'use client';

import { CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, ASSET_CLASS_ORDER } from '@/lib/assets/asset-class';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { CuratorScatterPoint } from '@/lib/queries/curators';

interface Props { points: CuratorScatterPoint[] }

export function CuratorScatter({ points }: Props) {
  if (points.length === 0) {
    return <div className="flex h-[360px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  const data = points.map((p) => ({
    x: p.feeTakeRate * 100, y: (p.netApyDelivered ?? 0) * 100, z: p.aum,
    name: p.name, cls: p.assetClass, label: p.label,
  }));
  const usedClasses = ASSET_CLASS_ORDER.filter((c) => data.some((d) => d.cls === c));

  return (
    <div>
      <ResponsiveContainer width="100%" height={380}>
        <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
          <XAxis type="number" dataKey="x" name="Fee Take Rate" unit="%" domain={[0, 'dataMax']}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }}
            label={{ value: 'FEE TAKE RATE', position: 'bottom', offset: 4, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <YAxis type="number" dataKey="y" name="Net APY Delivered" unit="%" domain={[0, 'dataMax']}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} width={44}
            label={{ value: 'NET APY', angle: -90, position: 'left', offset: -8, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <ZAxis type="number" dataKey="z" range={[60, 1400]} name="AUM" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'hsla(0,0%,100%,0.2)' }}
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0]!.payload as typeof data[number];
              return (
                <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                  <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.name}</div>
                  <div style={{ color: tokens.colors.textSecondary, marginTop: 4 }}>Fee take rate: {d.x.toFixed(1)}%</div>
                  <div style={{ color: tokens.colors.textSecondary }}>Net APY: {d.y.toFixed(2)}%</div>
                  <div style={{ color: tokens.colors.textSecondary }}>AUM: {fmtUsd(d.z, { compact: true })}</div>
                  <div style={{ color: tokens.colors.textMuted, marginTop: 2 }}>{ASSET_CLASS_LABEL[d.cls]}</div>
                </div>
              );
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={ASSET_CLASS_COLOR[d.cls]} fillOpacity={0.62} stroke={ASSET_CLASS_COLOR[d.cls]} strokeOpacity={0.9} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {usedClasses.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: ASSET_CLASS_COLOR[c] }} />
            <span className="text-tiny uppercase tracking-header-medium text-text-muted">{ASSET_CLASS_LABEL[c]}</span>
          </div>
        ))}
        <span className="text-tiny text-text-muted">· bubble size = AUM</span>
      </div>
    </div>
  );
}

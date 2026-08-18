'use client';

import {
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, ASSET_CLASS_ORDER, type AssetClass } from '@/lib/assets/asset-class';
import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';

export interface BubblePoint {
  x: number;          // already scaled to display units (e.g. %)
  y: number;
  z: number;          // bubble size driver (USD)
  cls: AssetClass;
  name: string;
  label?: string | null;   // optional annotation for notable points
}

export interface QuadrantLabel {
  /** corner placement */
  corner: 'tl' | 'tr' | 'bl' | 'br';
  text: string;
}

interface Props {
  points: BubblePoint[];
  xLabel: string;
  yLabel: string;
  xUnit?: string;
  yUnit?: string;
  xMax?: number | 'dataMax';
  yMax?: number | 'dataMax';
  height?: number;
  quadrants?: QuadrantLabel[];
  /** legend caption suffix, e.g. "bubble size = AUM" */
  sizeCaption?: string;
}

export function BubbleScatter({
  points,
  xLabel,
  yLabel,
  xUnit = '%',
  yUnit = '%',
  xMax = 'dataMax',
  yMax = 'dataMax',
  height = 380,
  quadrants,
  sizeCaption = 'bubble size = supply USD',
}: Props) {
  if (points.length === 0) {
    return <div className="flex h-[360px] items-center justify-center text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }
  const usedClasses = ASSET_CLASS_ORDER.filter((c) => points.some((p) => p.cls === c));

  // Quadrant midlines for ReferenceArea placement.
  const xHi = typeof xMax === 'number' ? xMax : Math.max(...points.map((p) => p.x));
  const yHi = typeof yMax === 'number' ? yMax : Math.max(...points.map((p) => p.y));
  const xMid = xHi / 2;
  const yMid = yHi / 2;

  const cornerArea = (q: QuadrantLabel) => {
    const x1 = q.corner === 'tl' || q.corner === 'bl' ? 0 : xMid;
    const x2 = q.corner === 'tl' || q.corner === 'bl' ? xMid : xHi;
    const y1 = q.corner === 'bl' || q.corner === 'br' ? 0 : yMid;
    const y2 = q.corner === 'bl' || q.corner === 'br' ? yMid : yHi;
    const pos = q.corner === 'tl' ? 'insideTopLeft'
      : q.corner === 'tr' ? 'insideTopRight'
      : q.corner === 'bl' ? 'insideBottomLeft' : 'insideBottomRight';
    return (
      <ReferenceArea
        key={q.corner}
        x1={x1} x2={x2} y1={y1} y2={y2}
        fill="transparent" stroke="none"
        label={{ value: q.text, position: pos, fill: 'hsla(0,0%,100%,0.18)', fontSize: 10, letterSpacing: '0.12em' }}
      />
    );
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 16, right: 24, left: 8, bottom: 28 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(0,0%,100%,0.06)" />
          {quadrants?.map(cornerArea)}
          <XAxis type="number" dataKey="x" name={xLabel} unit={xUnit} domain={[0, xMax]}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }}
            label={{ value: xLabel.toUpperCase(), position: 'bottom', offset: 6, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <YAxis type="number" dataKey="y" name={yLabel} unit={yUnit} domain={[0, yMax]}
            tick={{ fontSize: 10, fill: tokens.colors.textMuted }} axisLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} tickLine={{ stroke: 'hsla(0,0%,100%,0.12)' }} width={46}
            label={{ value: yLabel.toUpperCase(), angle: -90, position: 'left', offset: -8, fill: tokens.colors.textMuted, fontSize: 10, letterSpacing: '0.1em' }} />
          <ZAxis type="number" dataKey="z" range={[50, 1300]} name="size" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'hsla(0,0%,100%,0.2)' }}
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0]!.payload as BubblePoint;
              return (
                <div style={{ background: tokens.colors.tooltipBg, border: `1px solid ${tokens.colors.borderBright}`, borderRadius: tokens.radii.md, padding: '8px 10px', fontFamily: tokens.typography.fontFamilyMono, fontSize: 11, color: tokens.colors.textPrimary }}>
                  <div style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.name}</div>
                  <div style={{ color: tokens.colors.textSecondary, marginTop: 4 }}>{xLabel}: {d.x.toFixed(1)}{xUnit}</div>
                  <div style={{ color: tokens.colors.textSecondary }}>{yLabel}: {d.y.toFixed(2)}{yUnit}</div>
                  <div style={{ color: tokens.colors.textSecondary }}>{fmtUsd(d.z, { compact: true })}</div>
                  <div style={{ color: tokens.colors.textMuted, marginTop: 2 }}>{ASSET_CLASS_LABEL[d.cls]}</div>
                </div>
              );
            }}
          />
          <Scatter data={points} isAnimationActive={false}>
            {points.map((d, i) => (
              <Cell key={i} fill={ASSET_CLASS_COLOR[d.cls]} fillOpacity={0.6} stroke={ASSET_CLASS_COLOR[d.cls]} strokeOpacity={0.9} />
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
        <span className="text-tiny text-text-muted">· {sizeCaption}</span>
      </div>
    </div>
  );
}

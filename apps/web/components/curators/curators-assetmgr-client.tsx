'use client';

import Link from 'next/link';

import { ConcentrationPanel } from './concentration-panel';
import { CuratorAumChart } from './curator-aum-chart';
import { CuratorScatter } from './curator-scatter';
import { CuratorShareBar } from './curator-share-bars';
import { ReachMatrix } from './reach-matrix';
import { ChartFrame } from '@/components/chains/chart-frame';
import { type HeatCell, type HeatColumn, type HeatRow, HeatmapGrid } from '@/components/chains/heatmap-grid';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import {
  ASSET_CLASS_COLOR, ASSET_CLASS_ORDER, ASSET_CLASS_SHORT, ASSET_CLASS_LABEL, type AssetClass,
} from '@/lib/assets/asset-class';
import { fmtNumber, fmtUsd } from '@/lib/format';
import type {
  ConcentrationStats, CuratorEconomics, CuratorScatterPoint, CuratorSeriesPayload,
  CuratorStructuralRow, CuratorSuperlative, CuratorTableExtRow, ShareStackSlice,
} from '@/lib/queries/curators';

interface Props {
  totalAum: number;
  chainCount: number;
  totalBorrowInterest: number;
  totalFees: number;
  concentration: ConcentrationStats;
  kpis: CuratorSuperlative[];
  series: CuratorSeriesPayload;
  economics: CuratorEconomics[];
  structural: CuratorStructuralRow[];
  scatter: CuratorScatterPoint[];
  allBar: ShareStackSlice[];
  ethBar: ShareStackSlice[];
  reach: { curators: { id: string; name: string }[]; chains: { slug: string; name: string }[]; cells: { curatorId: string; curatorName: string; chainSlug: string; chainName: string; tvlUsd: number }[]; maxTvl: number };
  table: CuratorTableExtRow[];
}

const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(2)}%`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

function rankIntensities(values: (number | null)[], lowerBetter = false): (number | null)[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  present.sort((a, b) => a.v - b.v);
  const n = present.length;
  const out: (number | null)[] = values.map(() => null);
  present.forEach((x, rank) => { const f = n <= 1 ? 1 : rank / (n - 1); out[x.i] = lowerBetter ? 1 - f : f; });
  return out;
}

export function CuratorsAssetMgrClient(props: Props) {
  const { totalAum, chainCount, totalBorrowInterest, totalFees, concentration, kpis, series, economics, structural, scatter, allBar, ethBar, reach, table } = props;

  return (
    <div className="space-y-6">
      {/* 1. HEADER + 2. CONCENTRATION PANEL */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">Curators</h1>
          <p className="mt-2 text-small text-text-secondary">
            {fmtNumber(economics.length)} active curators managing <span className="text-text-primary">{usdC(totalAum)}</span> across {chainCount} chains ·{' '}
            <span className="text-text-primary">${(totalBorrowInterest / 1e6).toFixed(1)}M</span> borrow interest captured annually ·{' '}
            <span className="text-text-primary">${(totalFees / 1e6).toFixed(1)}M</span> in fees
          </p>
        </div>
        <ConcentrationPanel stats={concentration} />
      </header>

      {/* 3. HEADLINE KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.key} className="relative overflow-hidden rounded-lg border border-border bg-surface p-4">
            <div className="absolute inset-x-0 top-0 h-px bg-accent" />
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">{k.label}</div>
            <div className="mt-2 text-body uppercase tracking-header-medium text-text-primary leading-tight">
              {k.curatorName ? <Link href={`/curators/${k.curatorId}`} className="hover:text-accent">{k.curatorName}</Link> : 'N/A'}
            </div>
            <div className="mt-1 text-tiny text-text-secondary normal-case tracking-normal">{k.caption}</div>
          </div>
        ))}
      </div>

      {/* 4. ANCHOR CHART */}
      <CuratorAumChart payload={series} />

      {/* 5. CURATOR ECONOMICS HEATMAP */}
      <EconomicsHeatmap rows={economics.slice(0, 15)} />

      {/* 6. STRUCTURAL IDENTITY HEATMAP */}
      <StructuralHeatmap rows={structural} />

      {/* 7. PERFORMANCE SCATTER */}
      <ChartFrame title="Curator Performance Landscape" subtitle="Fee take rate vs net APY delivered · bubble size = AUM"
        csvFilename="curator-performance.csv"
        csvContent={['curator,fee_take_rate,net_apy_delivered,aum,asset_class', ...scatter.map((p) => [p.name, p.feeTakeRate, p.netApyDelivered, p.aum, p.assetClass].join(','))].join('\n')}
        methodologyText="Each bubble is a curator. X = Fee Take Rate (curator fees ÷ borrow interest captured). Y = Net APY Delivered (AUM-weighted net_apy). Bubble size = AUM; color = dominant asset class (by vault asset symbol). Degenerate-IRM vaults excluded."
        methodologySource="morpho_.vault_state_daily × morpho_.vaults">
        <CuratorScatter points={scatter} />
      </ChartFrame>

      {/* 8. SHARE STACK */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-small uppercase tracking-header-wide text-accent">Curator Share. Visual Stack</h2>
        <div className="space-y-5">
          <CuratorShareBar label="All chains · top 10 + others" slices={allBar} />
          <CuratorShareBar label="Ethereum only · top 10 + others" slices={ethBar} />
        </div>
      </section>

      {/* 9. REACH MATRIX */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-accent">Curator Reach Matrix. Top 10 × Top 8 chains</h2>
        <ReachMatrix curators={reach.curators} chains={reach.chains} cells={reach.cells} maxTvl={reach.maxTvl} />
      </section>

      {/* 10. TOP CURATORS TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Top Curators</h2>
          <MethodologyTooltip text="Curators ranked by AUM. Borrow Interest Captured = Σ TVL × pre-fee APY. Curator Fees = × performance fee. Fee Take Rate = fees ÷ borrow interest captured. Net APY Delivered = AUM-weighted net_apy. APY clamped <100%; degenerate vaults excluded." source="morpho_.vault_state_daily × morpho_.vaults" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead><tr className="border-b border-border text-left">
              <Th>#</Th><Th>Curator</Th><Th r>AUM</Th><Th r>Share</Th><Th r>Vaults</Th><Th r>Chains</Th>
              <Th r>Net APY</Th><Th r>Borrow Int.</Th><Th r>Curator Fees</Th><Th r>Take Rate</Th><Th r>AUM 30d Δ</Th>
            </tr></thead>
            <tbody>
              {table.map((r, i) => (
                <tr key={r.curatorId} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2 tabular-nums text-text-muted">{i + 1}</td>
                  <td className="py-2 uppercase tracking-header-medium text-text-primary"><Link href={`/curators/${r.curatorId}`} className="hover:text-accent">{r.name}</Link></td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{usdC(r.aum)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(r.sharePct)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.vaultCount}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.chainCount}</td>
                  <td className="py-2 text-right tabular-nums text-positive">{pct2(r.netApyDelivered)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.borrowInterestCaptured)}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{usdC(r.curatorFees)}</td>
                  <td className="py-2 text-right tabular-nums text-accent">{pct1(r.feeTakeRate)}</td>
                  <td className={`py-2 text-right tabular-nums ${r.aum30dDeltaPct == null ? 'text-text-muted' : r.aum30dDeltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>{signedPct(r.aum30dDeltaPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 11. METHODOLOGY */}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3 text-small text-text-secondary leading-relaxed">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Methodology</h2>
        <p>This page analyzes curators as asset managers for Morpho depositors. Lead metrics are AUM, borrow interest captured, fee take rate, and net APY delivered. Not curator TVL share alone. Per the framing principle adopted across this dashboard, sector position is treated as supporting context.</p>
        <p><span className="text-text-primary">Fee Take Rate</span> = curator fees ÷ borrow interest captured. The share of depositor-generated yield the curator retains. <span className="text-text-primary">APYs are clamped at 100% per-vault and vaults reporting &gt;100% APY are excluded</span> before any aggregation, to drop degenerate-IRM markets. Structural identity uses vault.asset_symbol (the loan-asset side) as a proxy; true collateral-level allocation lives in vault_allocations_daily, currently empty.</p>
      </section>
    </div>
  );
}

// ---------- Economics heatmap ----------
const ECON_COLS: { key: string; label: string; fmt: (r: CuratorEconomics) => string; val: (r: CuratorEconomics) => number | null; lowerBetter?: boolean }[] = [
  { key: 'aum', label: 'AUM', fmt: (r) => usdC(r.aum), val: (r) => r.aum },
  { key: 'bi', label: 'Borrow Int.', fmt: (r) => usdC(r.borrowInterestCaptured), val: (r) => r.borrowInterestCaptured },
  { key: 'fees', label: 'Curator Fees', fmt: (r) => usdC(r.curatorFees), val: (r) => r.curatorFees },
  { key: 'take', label: 'Fee Take Rate', fmt: (r) => pct1(r.feeTakeRate), val: (r) => r.feeTakeRate },
  { key: 'net', label: 'Net APY', fmt: (r) => pct2(r.netApyDelivered), val: (r) => r.netApyDelivered },
  { key: 'd30', label: 'AUM 30d Δ', fmt: (r) => signedPct(r.aum30dDeltaPct), val: (r) => r.aum30dDeltaPct },
];

function EconomicsHeatmap({ rows }: { rows: CuratorEconomics[] }) {
  const intens = ECON_COLS.map((c) => rankIntensities(rows.map((r) => c.val(r)), c.lowerBetter));
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Curator Economics</h2>
        <MethodologyTooltip text="Cross-sectional view of the top-15 curators by AUM. Borrow Interest Captured = Σ TVL × pre-fee APY. Curator Fees = × fee. Fee Take Rate = fees ÷ borrow interest captured. Net APY = AUM-weighted net_apy. Each column shaded by cross-sectional rank. Degenerate vaults excluded." source="morpho_.vault_state_daily × morpho_.vaults" />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Cross-sectional view of curator performance</p>
      <HeatmapGrid cornerLabel="Curator"
        columns={ECON_COLS.map((c): HeatColumn => ({ key: c.key, label: c.label }))}
        rows={rows.map((r, ri): HeatRow => ({
          key: r.curatorId,
          label: <Link href={`/curators/${r.curatorId}`} className="hover:text-accent">{r.name}</Link>,
          cells: ECON_COLS.map((c, ci): HeatCell => ({ key: c.key, content: c.fmt(r), intensity: intens[ci]![ri]!, tooltip: <div><div className="uppercase tracking-header-medium text-text-primary">{r.name} · {c.label}</div><div className="mt-1 tabular-nums">{c.fmt(r)}</div></div> })),
        }))} />
    </section>
  );
}

// ---------- Structural identity heatmap ----------
function StructuralHeatmap({ rows }: { rows: CuratorStructuralRow[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Curator Structural Identity</h2>
        <MethodologyTooltip text="What each curator's book is composed of, by asset class (% of AUM). Inferred from vault.asset_symbol. This is the loan-asset side, not collateral (true allocation lives in vault_allocations_daily, currently empty). Shaded by intensity within each row." source="morpho_.vaults × morpho_.vault_state_daily" />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">What each curator&apos;s book is composed of (by loan asset)</p>
      <HeatmapGrid cornerLabel="Curator"
        columns={ASSET_CLASS_ORDER.map((c): HeatColumn => ({ key: c, label: ASSET_CLASS_SHORT[c], color: ASSET_CLASS_COLOR[c] }))}
        rows={rows.map((r): HeatRow => {
          const maxPct = Math.max(...ASSET_CLASS_ORDER.map((c) => r.byClass[c].pct), 0.0001);
          return {
            key: r.curatorId,
            label: <Link href={`/curators/${r.curatorId}`} className="hover:text-accent">{r.name}</Link>,
            cells: ASSET_CLASS_ORDER.map((c): HeatCell => {
              const cell = r.byClass[c];
              return { key: c, content: cell.pct > 0 ? `${(cell.pct * 100).toFixed(0)}%` : '·', intensity: cell.pct > 0 ? cell.pct / maxPct : null, dimText: cell.pct === 0,
                tooltip: <div><div className="uppercase tracking-header-medium text-text-primary">{r.name} · {ASSET_CLASS_LABEL[c]}</div><div className="mt-1 tabular-nums">{(cell.pct * 100).toFixed(1)}% · {usdC(cell.usd)}</div></div> };
            }),
          };
        })} />
    </section>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>;
}

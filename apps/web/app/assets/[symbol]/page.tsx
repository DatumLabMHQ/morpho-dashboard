import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AssetFlowsChart } from '@/components/assets/asset-flows-chart';
import { ChartFrame } from '@/components/chains/chart-frame';
import { CuratorTvlChainChart } from '@/components/curators/curator-tvl-chain-chart';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { ASSET_CLASS_LABEL, type AssetClass } from '@/lib/assets/asset-class';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  getAssetChainBreakdown,
  getAssetCuratorsHolding,
  getAssetHeader,
  getAssetKpis,
  getAssetMarketsBothSides,
  getAssetSupplyAndCollateralByChainSeries,
  getAssetWeeklyFlows,
} from '@/lib/queries/asset-detail';

interface Props { params: Promise<{ symbol: string }> }
export const revalidate = 900;

const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(2)}%`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const doublingDisplay = (d: number | null) => (d == null ? 'N/A' : d > 1000 ? '1000+' : `${Math.round(d)}d`);
const csv = (head: string, rows: (string | number | null)[][]) => [head, ...rows.map((r) => r.map((c) => (c == null ? '' : c)).join(','))].join('\n');

export default async function AssetDetailPage({ params }: Props) {
  const { symbol: slug } = await params;
  if (!hasDatabaseUrl()) return <EmptyState title="Database not configured" message="Local: apps/web/.env.local." />;

  const header = await getAssetHeader(decodeURIComponent(slug));
  if (!header) notFound();
  const sym = header.symbol;

  const [kpis, series, markets, curators, chainBreakdown, flows] = await Promise.all([
    getAssetKpis(sym),
    getAssetSupplyAndCollateralByChainSeries(sym, 365),
    getAssetMarketsBothSides(sym),
    getAssetCuratorsHolding(sym),
    getAssetChainBreakdown(sym),
    getAssetWeeklyFlows(sym, 13),
  ]);

  const lastWk = flows.points.length ? Object.entries(flows.points[flows.points.length - 1]!).filter(([k]) => k !== 'weekStart').reduce((s, [, v]) => s + Number(v), 0) : null;
  const run4 = flows.points.slice(-4).reduce((s, p) => s + Object.entries(p).filter(([k]) => k !== 'weekStart').reduce((a, [, v]) => a + Number(v), 0), 0);
  const sgn = (v: number) => (v >= 0 ? '+' : '−');
  const flowSubtitle = lastWk != null ? `Net flow last week: ${sgn(lastWk)}${usdC(Math.abs(lastWk))} · 4-week running: ${sgn(run4)}${usdC(Math.abs(run4))}` : undefined;

  return (
    <div className="space-y-6">
      <Link href="/assets" className="inline-block text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary">← Assets</Link>

      {/* 1. HEADER */}
      <header className="border-b border-border pb-5">
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">{sym}</h1>
        <p className="mt-2 text-small text-text-secondary">
          {header.name ? `${header.name} · ` : ''}class: <span className="text-text-primary">{ASSET_CLASS_LABEL[header.assetClass as AssetClass] ?? header.assetClass}</span> · {header.chainCount} chains · loan asset in {fmtNumber(header.loanMarketCount)} markets, collateral in {fmtNumber(header.collateralMarketCount)} markets
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <KpiCard label="Total Supply" value={usdC(kpis.totalSupply)} subtext={kpis.supply30dDeltaPct != null ? `30d ${signedPct(kpis.supply30dDeltaPct)}` : 'loan side'} accent="chart-1" />
        <KpiCard label="Total Collateral" value={usdC(kpis.totalCollateral)} subtext="locked" accent="chart-4" />
        <KpiCard label="Borrow Interest Gen." value={usdC(kpis.borrowInterestGen)} subtext="annualized" accent="chart-3" />
        <KpiCard label="Lender Yield Delivered" value={usdC(kpis.lenderYieldDelivered)} subtext="annualized" accent="chart-2" />
        <KpiCard label="Wtd Avg Supply APY" value={pct2(kpis.weightedSupplyApy)} accent="chart-5" />
        <KpiCard label="Wtd Avg Utilization" value={pct1(kpis.weightedUtilization)} accent="chart-6" />
        <KpiCard label="Supply Doubling Time" value={doublingDisplay(kpis.doublingTimeDays)} subtext="at 30d rate" accent="chart-7" />
      </div>

      {/* 3. DUAL CHART */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame title={`${sym} Supply by Chain`} csvFilename={`asset-supply-${sym}.csv`}
          csvContent={csv(['date', ...series.chains.map((c) => c.slug)].join(','), series.supply.map((p) => ['date', ...series.chains.map((c) => c.slug)].map((k) => p[k] ?? '')))}
          methodologyText="Σ supply_assets_usd where this asset is the loan asset, stacked by chain over 365 days.">
          <CuratorTvlChainChart data={series.supply} chains={series.chains} />
        </ChartFrame>
        <ChartFrame title={`${sym} Collateral by Chain`} csvFilename={`asset-collateral-${sym}.csv`}
          csvContent={csv(['date', ...series.chains.map((c) => c.slug)].join(','), series.collateral.map((p) => ['date', ...series.chains.map((c) => c.slug)].map((k) => p[k] ?? '')))}
          methodologyText="Σ collateral_assets_usd where this asset is the collateral, stacked by chain over 365 days.">
          <CuratorTvlChainChart data={series.collateral} chains={series.chains} />
        </ChartFrame>
      </div>

      {/* 4. MARKETS BOTH SIDES */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-small uppercase tracking-header-wide text-accent">As Loan Asset (top markets)</h2>
          {markets.loanSide.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">Not used as a loan asset</div> : (
            <div className="overflow-x-auto"><table className="w-full text-body"><thead><tr className="border-b border-border text-left"><Th>Market</Th><Th>Chain</Th><Th r>Supply</Th><Th r>Borrow</Th><Th r>Util</Th><Th r>Sup APY</Th><Th r>Bor APY</Th></tr></thead>
              <tbody>{markets.loanSide.map((m) => (<tr key={m.uniqueKey} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                <td className="py-2 uppercase tracking-header-medium text-text-primary whitespace-nowrap">{sym} / {m.collateralSymbol ?? 'N/A'}</td>
                <td className="py-2 uppercase tracking-header-medium text-text-secondary">{m.chainSlug ?? 'N/A'}</td>
                <td className="py-2 text-right tabular-nums text-text-primary">{usdC(m.supplyUsd)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(m.borrowUsd)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(m.utilization)}</td>
                <td className="py-2 text-right tabular-nums text-positive">{pct2(m.supplyApy)}</td>
                <td className="py-2 text-right tabular-nums text-accent">{pct2(m.borrowApy)}</td></tr>))}</tbody></table></div>
          )}
        </section>
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-small uppercase tracking-header-wide text-accent">As Collateral (top markets)</h2>
          {markets.collateralSide.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">Not used as collateral</div> : (
            <div className="overflow-x-auto"><table className="w-full text-body"><thead><tr className="border-b border-border text-left"><Th>Market</Th><Th>Chain</Th><Th r>Collateral</Th><Th r>LLTV</Th><Th r>Util</Th></tr></thead>
              <tbody>{markets.collateralSide.map((m) => (<tr key={m.uniqueKey} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                <td className="py-2 uppercase tracking-header-medium text-text-primary whitespace-nowrap">{sym} / {m.loanSymbol}</td>
                <td className="py-2 uppercase tracking-header-medium text-text-secondary">{m.chainSlug ?? 'N/A'}</td>
                <td className="py-2 text-right tabular-nums text-text-primary">{usdC(m.collateralUsd)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{m.lltvPct == null ? 'N/A' : `${m.lltvPct.toFixed(0)}%`}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(m.utilization)}</td></tr>))}</tbody></table></div>
          )}
        </section>
      </div>

      {/* 5. CURATORS HOLDING */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-accent">Curators Running {sym} Vaults</h2>
        {curators.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">No curated vaults denominated in {sym}</div> : (
          <table className="w-full text-body"><thead><tr className="border-b border-border text-left"><Th>Curator</Th><Th r># Vaults</Th><Th r>AUM in {sym}</Th><Th r>Wtd Net APY</Th><Th r>Fee Take Rate</Th></tr></thead>
            <tbody>{curators.map((c) => (<tr key={c.curatorId} className="border-b border-border last:border-0 hover:bg-hover-overlay">
              <td className="py-2 uppercase tracking-header-medium text-text-primary"><Link href={`/curators/${c.curatorId}`} className="hover:text-accent">{c.curatorName}</Link></td>
              <td className="py-2 text-right tabular-nums text-text-secondary">{c.vaultCount}</td>
              <td className="py-2 text-right tabular-nums text-text-primary">{usdC(c.aumInAssetUsd)}</td>
              <td className="py-2 text-right tabular-nums text-positive">{pct2(c.weightedNetApy)}</td>
              <td className="py-2 text-right tabular-nums text-accent">{pct1(c.feeTakeRate)}</td></tr>))}</tbody></table>
        )}
      </section>

      {/* 6. CHAIN BREAKDOWN */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-accent">Chain Breakdown</h2>
        <table className="w-full text-body"><thead><tr className="border-b border-border text-left"><Th>Chain</Th><Th r>Supply</Th><Th r>Collateral</Th><Th r># Markets</Th><Th r>Borrow Interest</Th><Th r>Rank</Th></tr></thead>
          <tbody>{chainBreakdown.map((r) => (<tr key={r.chainSlug} className="border-b border-border last:border-0 hover:bg-hover-overlay">
            <td className="py-2 uppercase tracking-header-medium text-text-primary"><Link href={`/chains/${r.chainSlug.toLowerCase()}`} className="hover:text-accent">{r.chainName}</Link></td>
            <td className="py-2 text-right tabular-nums text-text-primary">{usdC(r.supplyUsd)}</td>
            <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.collateralUsd)}</td>
            <td className="py-2 text-right tabular-nums text-text-secondary">{r.marketCount}</td>
            <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.borrowInterestGen)}</td>
            <td className="py-2 text-right tabular-nums text-text-muted">#{r.rankOnChain}</td></tr>))}</tbody></table>
        <p className="mt-3 text-tiny text-text-muted">Rank = this asset&apos;s position among the chain&apos;s assets by combined supply + collateral.</p>
      </section>

      {/* 7. ASSET FLOWS */}
      <ChartFrame title={`${sym} Weekly Net Supply Flows`} subtitle={flowSubtitle}
        csvFilename={`asset-flows-${sym}.csv`} csvContent={csv(['week', ...flows.chains].join(','), flows.points.map((p) => ['week', ...flows.chains].map((k) => (k === 'week' ? p.weekStart : p[k] ?? 0))))}
        methodologyText="Weekly net change in supply (this asset as loan asset), broken down by chain, over the last 13 weeks from end-of-week snapshots.">
        <AssetFlowsChart chains={series.chains.filter((c) => flows.chains.includes(c.slug))} points={flows.points} />
      </ChartFrame>

      {/* 8. METHODOLOGY */}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3 text-small text-text-secondary leading-relaxed">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Methodology</h2>
        <p>{sym} measured on both balance-sheet sides. Supply side: Σ supply_assets_usd where {sym} is the loan asset; Borrow Interest = Σ borrow × LEAST(borrow_apy,1.0). Collateral side: Σ collateral_assets_usd where {sym} is the collateral. APYs clamped at 100%, degenerate-IRM markets excluded. Asset class inferred from symbol.</p>
      </section>
    </div>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>;
}

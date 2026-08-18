import { ChartFrame } from '@/components/chains/chart-frame';
import { AssetClassAsymmetryChart } from '@/components/overview/asset-class-asymmetry-chart';
import { KpiCardMultiDelta } from '@/components/overview/kpi-card-multi-delta';
import { LendingEfficiencyTable } from '@/components/overview/lending-efficiency-table';
import { MarketShareChart } from '@/components/overview/market-share-chart';
import { MixDonuts } from '@/components/overview/mix-donuts';
import { NetSupplyFlowsSankey } from '@/components/overview/net-supply-flows-sankey';
import { PerChainCardTile } from '@/components/overview/per-chain-card';
import { ProtocolComparisonLine } from '@/components/overview/protocol-comparison-line';
import { RiskPulsePanels } from '@/components/overview/risk-pulse';
import { TopMarketsTable } from '@/components/overview/top-markets-table';
import { CiteThisPage } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import {
  getAssetClassAsymmetry,
  getLendingEfficiencyTable,
  getMarketShareByChain,
  getMorphoMixDonuts,
  getMorphoWideKpis,
  getNetSupplyFlows,
  getOverviewMarketsByPeriod,
  getPerChainCardData,
  getProtocolTvlComparison,
  getRiskPulse,
  type LendingEfficiencyTable as LendingEfficiencyTableData,
  type MarketShareByChain,
  type MixDonuts as MixDonutsData,
  type MixPeriod,
  type NetSupplyFlows,
  type ShareMetric,
  type TopMarketsPeriod,
  type TopMarketRow,
} from '@/lib/queries/overview';

export const revalidate = 900;

const SHARE_METRICS: ShareMetric[] = ['deposits', 'borrows', 'liquidity', 'tvl', 'utilization'];
const FLOW_VIEWS = ['chain', 'curator'] as const;
const FLOW_PERIODS = ['W', 'M', 'Q'] as const;
const MARKET_PERIODS: TopMarketsPeriod[] = ['current', 'week', 'month', 'quarter'];
const MIX_PERIODS: MixPeriod[] = ['current', 'week', 'month', 'quarter'];
const EFFICIENCY_CHAINS = ['ethereum', 'base', 'arbitrum', 'polygon'] as const;

export default async function OverviewPage() {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  // All overview data in ONE parallel wave. None of these queries depend on
  // each other, so running them together makes a cold render (right after a
  // deploy or cache revalidation) cost the slowest single query rather than
  // the sum of three sequential waves.
  const [
    kpis, shareSeries, comparison,
    perChain, donutsArr, marketsByPeriodArr, flowsArr,
    efficiencyArr, riskPulse, asymmetry,
  ] = await Promise.all([
    getMorphoWideKpis(),
    Promise.all(SHARE_METRICS.map((m) => getMarketShareByChain(m, 730))),
    getProtocolTvlComparison({ days: 730, includeCdp: false }),
    getPerChainCardData(),
    Promise.all(MIX_PERIODS.map((p) => getMorphoMixDonuts(p))),
    Promise.all(MARKET_PERIODS.map((p) => getOverviewMarketsByPeriod(p))),
    Promise.all(FLOW_VIEWS.flatMap((v) => FLOW_PERIODS.map((p) => getNetSupplyFlows(p, v)))),
    Promise.all(EFFICIENCY_CHAINS.map((c) => getLendingEfficiencyTable(c))),
    getRiskPulse(),
    getAssetClassAsymmetry(),
  ]);

  const byMetric = Object.fromEntries(
    SHARE_METRICS.map((m, i) => [m, shareSeries[i]!]),
  ) as Record<ShareMetric, MarketShareByChain>;

  const donutsByPeriod = Object.fromEntries(
    MIX_PERIODS.map((p, i) => [p, donutsArr[i]!]),
  ) as Record<MixPeriod, MixDonutsData>;

  const marketsByPeriod = Object.fromEntries(
    MARKET_PERIODS.map((p, i) => [p, marketsByPeriodArr[i]!]),
  ) as Record<TopMarketsPeriod, TopMarketRow[]>;

  const flowsByKey: Record<string, NetSupplyFlows> = {};
  let fi = 0;
  for (const v of FLOW_VIEWS) for (const p of FLOW_PERIODS) flowsByKey[`${v}:${p}`] = flowsArr[fi++]!;

  const efficiencyByChain = Object.fromEntries(
    EFFICIENCY_CHAINS.map((c, i) => [c, efficiencyArr[i]!]),
  ) as Record<string, LendingEfficiencyTableData>;

  // Chain → palette index, shared across market-share legend, per-chain cards
  // and the top-markets dots so a chain is always the same color.
  const chainColorIndex: Record<string, number> = {};
  byMetric.deposits.chains.forEach((c, i) => { chainColorIndex[c.slug] = i; });
  perChain.forEach((c, i) => { if (!(c.slug in chainColorIndex)) chainColorIndex[c.slug] = i; });

  return (
    <div className="space-y-6">
      {/* SECTION 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Morpho Sector Overview
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          Aggregate metrics across{' '}
          <span className="text-text-primary">{kpis.chainCount}</span> chains,{' '}
          <span className="text-text-primary">{kpis.curatorCount}</span> curators,{' '}
          <span className="text-text-primary">{kpis.marketCount}</span> markets
        </p>
        <p className="mt-1 text-tiny uppercase tracking-header-medium text-text-muted">
          Source: Morpho GraphQL API · DefiLlama
        </p>
      </header>

      {/* SECTION 2. KPI STRIP. Metric hierarchy: Active Loans leads, then the
          interest flows it generates (Borrow Interest, NIM), then who captures
          them (Curator Fees), with the deposit base + utilization that backs it.
          TVL is intentionally NOT a headline KPI (lives in Section 3). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCardMultiDelta label="Active Loans"               data={kpis.activeBorrows}   accent="chart-7"          icon="trending-down" />
        <KpiCardMultiDelta label="Borrow Interest (Annualized)" data={kpis.borrowInterest} accent="accent"           icon="dollar" />
        <KpiCardMultiDelta label="Net Interest Margin"        data={kpis.nim}             accent="accent-blue"      icon="activity" />
        <KpiCardMultiDelta label="Curator Fees (Annualized)"  data={kpis.curatorFees}     accent="accent-secondary" icon="dollar" />
        <KpiCardMultiDelta label="Total Deposits"             data={kpis.totalDeposits}   accent="positive"         icon="trending-up" />
        <KpiCardMultiDelta label="Weighted Utilization"       data={kpis.utilization}     accent="accent"           icon="percent" />
      </div>

      {/* SECTION 3. LENDING SECTOR POSITION (moved up: where Morpho sits in
          the sector is the headline framing, so it leads above the by-chain
          breakdown). */}
      <ChartFrame
        title="Morpho in the lending sector"
        subtitle="Deposits, active loans (borrows), and TVL across the overcollateralized lending sector. Toggle the metric. TVL alone understates lending size; deposits and active loans are the truer yardsticks. Source: DefiLlama."
        csvFilename="overview-sector-position.csv"
        csvContent={['protocol,day,deposits_usd,active_loans_usd,tvl_usd',
          ...comparison.lending.flatMap((s) => s.points.map((p) => [s.label.replace(/,/g, ' '), p.day, p.deposits, p.borrows, p.tvl].join(',')))
        ].join('\n')}
      >
        <ProtocolComparisonLine data={comparison} showCdp={false} />
      </ChartFrame>

      {/* SECTION 4. MARKET SHARE (anchor) */}
      <ChartFrame
        title="Morpho by chain"
        subtitle="Share of Morpho's selected metric across chains over time. Top 10 chains; rest aggregated as Other."
        csvFilename="overview-market-share-by-chain.csv"
        csvContent={['day,' + byMetric.deposits.chains.map((c) => c.slug).join(','),
          ...byMetric.deposits.points.map((p) => [p.day, ...byMetric.deposits.chains.map((c) => p[c.slug] ?? 0)].join(','))
        ].join('\n')}
      >
        <MarketShareChart byMetric={byMetric} />
      </ChartFrame>

      {/* SECTION 4. PER-CHAIN CARDS */}
      <section className="space-y-3">
        <h2 className="text-small uppercase tracking-header-wide text-text-muted">By chain. Top 8 by TVL</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {perChain.map((card) => (
            <PerChainCardTile key={card.slug} card={card} colorIndex={chainColorIndex[card.slug] ?? 0} />
          ))}
        </div>
      </section>

      {/* SECTION 5. NET SUPPLY FLOWS SANKEY */}
      <ChartFrame
        title="Net supply flows"
        subtitle="Net change in deposit base over the period · inflows ▲ left, outflows ▼ right, components in the middle."
        csvFilename="overview-net-supply-flows.csv"
        csvContent={(() => {
          const f = flowsByKey['chain:W']!;
          return ['node_from,node_to,net_usd',
            ...f.links.map((l) => [f.nodes[l.source]?.name ?? '', f.nodes[l.target]?.name ?? '', l.value].join(','))
          ].join('\n');
        })()}
      >
        <NetSupplyFlowsSankey byKey={flowsByKey} />
      </ChartFrame>

      {/* SECTION 6. MIX DONUTS: collateral + borrow as two side-by-side cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame
          title="Collateral mix"
          subtitle="Deposit base by asset. Top 7 shown individually; rest as Other."
          csvFilename="overview-collateral-mix.csv"
          csvContent={['symbol,usd',
            ...donutsByPeriod.current.collateralMix.map((s) => [s.symbol, s.usd].join(',')),
          ].join('\n')}
        >
          <MixDonuts byPeriod={donutsByPeriod} only="collateral" />
        </ChartFrame>
        <ChartFrame
          title="Borrow mix"
          subtitle="Debt by asset. Top 7 shown individually; rest as Other."
          csvFilename="overview-borrow-mix.csv"
          csvContent={['symbol,usd',
            ...donutsByPeriod.current.borrowMix.map((s) => [s.symbol, s.usd].join(',')),
          ].join('\n')}
        >
          <MixDonuts byPeriod={donutsByPeriod} only="borrow" />
        </ChartFrame>
      </div>

      {/* SECTION 6b. ASSET CLASS ASYMMETRY */}
      <ChartFrame
        anchorId="asset-class-asymmetry"
        title="Asset class asymmetry. Deposits vs borrow interest"
        subtitle={(() => {
          const sc = asymmetry.rows.find((r) => r.key === 'stablecoin');
          const btc = asymmetry.rows.find((r) => r.key === 'btc');
          return `Where capital sits versus where economic activity concentrates. Stablecoins are ${sc ? Math.round(sc.depositsPct * 100) : 0}% of deposits but ${sc ? Math.round(sc.interestPct * 100) : 0}% of borrow interest; BTC is ${btc ? Math.round(btc.depositsPct * 100) : 0}% of deposits but ${btc ? (btc.interestPct * 100).toFixed(1) : 0}% as a borrowed asset. As of ${asymmetry.asOfDate}.`;
        })()}
        csvFilename="overview-asset-class-asymmetry.csv"
        csvContent={['asset_class,deposits_usd,borrow_interest_annualized_usd,deposits_share_pct,borrow_interest_share_pct',
          ...asymmetry.rows.map((r) => [r.label, Math.round(r.depositsUsd), Math.round(r.interestUsd), (r.depositsPct * 100).toFixed(2), (r.interestPct * 100).toFixed(2)].join(','))].join('\n')}
        methodologyText="Deposits = Σ supply_assets_usd + Σ collateral_assets_usd, classified by asset (latest snapshot, all chains). Borrow interest = Σ borrow_assets_usd × min(borrow_apy, 1.0), attributed to the borrowed (loan) asset. Bad-oracle markets (APY > 100%) are excluded from both."
        methodologySource="morpho_.market_state_daily + morpho_.markets"
      >
        <AssetClassAsymmetryChart rows={asymmetry.rows} />
      </ChartFrame>

      {/* SECTION 7. TOP MARKETS */}
      <ChartFrame
        title="Top markets across Morpho"
        subtitle="Period / view / sort toggles. Supply & borrow APY clamped at 100% (saturated-util IRM artifacts shown as . ). Click a row to copy its market key."
        csvFilename="overview-top-markets.csv"
        csvContent={['rank,pair,chain,supply_usd,available_liq,borrowed,util,supply_apy,borrow_apy',
          ...marketsByPeriod.current.slice(0, 50).map((m, i) =>
            [i + 1, m.pair.replace(/,/g, ' '), m.chainSlug ?? '', m.supplyUsd, m.liquidityUsd, m.borrowUsd, m.utilization ?? '', m.supplyApy ?? '', m.borrowApy ?? ''].join(','))
        ].join('\n')}
      >
        <TopMarketsTable byPeriod={marketsByPeriod} chainColorIndex={chainColorIndex} />
      </ChartFrame>

      {/* SECTION 8. LENDING EFFICIENCY (Morpho vs sector supply APY) */}
      <ChartFrame
        title="Morpho vs sector supply APY"
        subtitle="Depositor yield on Morpho vs the lending sector (Aave V3, Compound V3, Fluid, Euler V2), by asset. Positive spread = Morpho is the more efficient venue for lenders. Toggle chain."
        csvFilename="overview-lending-efficiency.csv"
        csvContent={['chain,asset,morpho_apy,sector_avg_apy,spread_bps',
          ...EFFICIENCY_CHAINS.flatMap((c) =>
            (efficiencyByChain[c]?.rows ?? []).map((r) =>
              [c, r.asset, r.morphoApy ?? '', r.sectorAvgApy ?? '', r.spreadVsSectorBps ?? ''].join(',')))
        ].join('\n')}
      >
        <LendingEfficiencyTable byChain={efficiencyByChain} />
      </ChartFrame>

      {/* SECTION 9. RISK PULSE */}
      <section className="space-y-3">
        <div>
          <h2 className="text-small uppercase tracking-header-wide text-text-muted">Risk pulse</h2>
          <p className="mt-1 text-tiny text-text-muted">
            Bad debt is Morpho&apos;s stored unrealized figure. Stressed = utilization &gt; 90%. LLTV is supply-weighted (stored as a fraction).
          </p>
        </div>
        <RiskPulsePanels data={riskPulse} />
      </section>

      {/* SECTION 10. METHODOLOGY + CITE */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-tiny uppercase tracking-header-medium text-text-muted space-y-1">
        <p>Data sources: Morpho GraphQL API · DefiLlama. Updated every 6 hours.</p>
        <p>TVL definition matches Morpho&apos;s published dashboard: deposits − active loans.</p>
        <p>Saturated-utilization IRM blow-ups (supply APY ≥ 100%) are excluded from every aggregate as data artifacts.</p>
        <p>Full methodology: <a href="/methodology" className="text-accent hover:underline">/methodology</a></p>
      </div>
      <CiteThisPage pageTitle="Morpho Sector Overview" pageUrl="/" />
    </div>
  );
}

import { ChartFrame } from '@/components/chains/chart-frame';
import { KpiCardMultiDelta } from '@/components/overview/kpi-card-multi-delta';
import { MarketShareChart } from '@/components/overview/market-share-chart';
import { MixDonuts } from '@/components/overview/mix-donuts';
import { NetSupplyFlowsSankey } from '@/components/overview/net-supply-flows-sankey';
import { PerChainCardTile } from '@/components/overview/per-chain-card';
import { ProtocolComparisonLine } from '@/components/overview/protocol-comparison-line';
import { TopMarketsTable } from '@/components/overview/top-markets-table';
import { CiteThisPage } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtUsd } from '@/lib/format';
import {
  getMarketShareByChain,
  getMorphoMixDonuts,
  getMorphoWideKpis,
  getNetSupplyFlows,
  getOverviewMarketsByPeriod,
  getPerChainCardData,
  getProtocolRanking,
  getProtocolTvlComparison,
  type MarketShareByChain,
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

export default async function OverviewPage() {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  // ─── Eager (above-the-fold): KPIs + market-share anchor ─────────────
  const [kpis, shareSeries, ranking, comparison] = await Promise.all([
    getMorphoWideKpis(),
    Promise.all(SHARE_METRICS.map((m) => getMarketShareByChain(m, 730))),
    getProtocolRanking(),
    getProtocolTvlComparison({ days: 730, includeCdp: false }),
  ]);
  const byMetric = Object.fromEntries(
    SHARE_METRICS.map((m, i) => [m, shareSeries[i]!]),
  ) as Record<ShareMetric, MarketShareByChain>;

  // ─── Below-the-fold data ────────────────────────────────────────────
  const [perChain, donuts, marketsByPeriodArr, ...flowsArr] = await Promise.all([
    getPerChainCardData(),
    getMorphoMixDonuts('current'),
    Promise.all(MARKET_PERIODS.map((p) => getOverviewMarketsByPeriod(p))),
    ...FLOW_VIEWS.flatMap((v) => FLOW_PERIODS.map((p) => getNetSupplyFlows(p, v))),
  ]);

  const marketsByPeriod = Object.fromEntries(
    MARKET_PERIODS.map((p, i) => [p, marketsByPeriodArr[i]!]),
  ) as Record<TopMarketsPeriod, TopMarketRow[]>;

  const flowsByKey: Record<string, NetSupplyFlows> = {};
  let fi = 0;
  for (const v of FLOW_VIEWS) for (const p of FLOW_PERIODS) flowsByKey[`${v}:${p}`] = flowsArr[fi++]!;

  // Chain → palette index, shared across market-share legend, per-chain cards
  // and the top-markets dots so a chain is always the same color.
  const chainColorIndex: Record<string, number> = {};
  byMetric.deposits.chains.forEach((c, i) => { chainColorIndex[c.slug] = i; });
  perChain.forEach((c, i) => { if (!(c.slug in chainColorIndex)) chainColorIndex[c.slug] = i; });

  // Section 8 auto-subtitle.
  const sectorSub = ranking.oneAbove && ranking.gapToOneAboveUsd != null
    ? `Morpho ranks #${ranking.morphoRank} of ${ranking.totalLendingProtocols} overcollateralized lending protocols by TVL. Gap to ${ranking.oneAbove.label}: ${fmtUsd(ranking.gapToOneAboveUsd, { compact: true })}.`
    : `Morpho ranks #${ranking.morphoRank} of ${ranking.totalLendingProtocols} overcollateralized lending protocols by TVL.`;

  return (
    <div className="space-y-6">
      {/* SECTION 1 — HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Morpho Sector Overview
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          Aggregate metrics across{' '}
          <span className="text-text-primary">{kpis.chainCount}</span> chains,{' '}
          <span className="text-text-primary">{kpis.curatorCount}</span> curators,{' '}
          <span className="text-text-primary">{kpis.marketCount}</span> markets
          <span className="text-text-muted"> · as of {kpis.asOfDate}</span>
        </p>
        <p className="mt-1 text-tiny uppercase tracking-header-medium text-text-muted">
          Source: Morpho GraphQL API · DefiLlama · FRED (T-bill rates)
        </p>
      </header>

      {/* SECTION 2 — KPI STRIP (3-by-3, two rows; per-card colors + left
          stripe mirror the Lending Intelligence Terminal) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCardMultiDelta label="Total Deposits"        data={kpis.totalDeposits}      accent="positive"         icon="trending-up" />
        <KpiCardMultiDelta label="Active Borrows"        data={kpis.activeBorrows}      accent="chart-7"          icon="trending-down" />
        <KpiCardMultiDelta label="Available Liquidity"   data={kpis.availableLiquidity} accent="accent-secondary" icon="wallet" />
        <KpiCardMultiDelta label="Morpho Utilization"    data={kpis.utilization}        accent="accent"           icon="activity" />
        <KpiCardMultiDelta label="% Real Yield Spread"   data={kpis.realYieldSpread}    accent="positive"         icon="percent" />
        <KpiCardMultiDelta label="Curator-Fee Take Rate" data={kpis.curatorFeeTakeRate} accent="accent-blue"      icon="dollar" />
      </div>
      {!kpis.tbillAvailable && (
        <p className="text-tiny uppercase tracking-header-medium text-text-muted">
          Real-yield spread shows &quot;—&quot; until a FRED_API_KEY is configured on the worker (free; series DTB3).
        </p>
      )}

      {/* SECTION 3 — MARKET SHARE (anchor) */}
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

      {/* SECTION 4 — PER-CHAIN CARDS */}
      <section className="space-y-3">
        <h2 className="text-small uppercase tracking-header-wide text-text-muted">By chain — top 8 by TVL</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {perChain.map((card) => (
            <PerChainCardTile key={card.slug} card={card} colorIndex={chainColorIndex[card.slug] ?? 0} />
          ))}
        </div>
      </section>

      {/* SECTION 5 — NET SUPPLY FLOWS SANKEY */}
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

      {/* SECTION 6 — MIX DONUTS */}
      <ChartFrame
        title="Collateral mix + borrow mix"
        subtitle={`Deposit base and debt by asset · as of ${donuts.asOfDate}. Top 7 assets shown individually; rest as Other.`}
        csvFilename="overview-mix.csv"
        csvContent={['side,symbol,usd',
          ...donuts.collateralMix.map((s) => ['collateral', s.symbol, s.usd].join(',')),
          ...donuts.borrowMix.map((s) => ['borrow', s.symbol, s.usd].join(',')),
        ].join('\n')}
      >
        <MixDonuts
          collateralMix={donuts.collateralMix}
          collateralTotal={donuts.collateralTotal}
          borrowMix={donuts.borrowMix}
          borrowTotal={donuts.borrowTotal}
        />
      </ChartFrame>

      {/* SECTION 7 — TOP MARKETS */}
      <ChartFrame
        title="Top markets across Morpho"
        subtitle="Period / view / sort toggles. Supply & borrow APY clamped at 100% (saturated-util IRM artifacts shown as —). Click a row to copy its market key."
        csvFilename="overview-top-markets.csv"
        csvContent={['rank,pair,chain,supply_usd,available_liq,borrowed,util,supply_apy,borrow_apy',
          ...marketsByPeriod.current.slice(0, 50).map((m, i) =>
            [i + 1, m.pair.replace(/,/g, ' '), m.chainSlug ?? '', m.supplyUsd, m.liquidityUsd, m.borrowUsd, m.utilization ?? '', m.supplyApy ?? '', m.borrowApy ?? ''].join(','))
        ].join('\n')}
      >
        <TopMarketsTable byPeriod={marketsByPeriod} chainColorIndex={chainColorIndex} />
      </ChartFrame>

      {/* SECTION 8 — LENDING SECTOR POSITION (compact) */}
      <ChartFrame
        title="Morpho in the lending sector"
        subtitle={sectorSub}
        csvFilename="overview-sector-position.csv"
        csvContent={['protocol,day,tvl_usd',
          ...comparison.lending.flatMap((s) => s.points.map((p) => [s.label.replace(/,/g, ' '), p.day, p.tvl].join(',')))
        ].join('\n')}
      >
        <ProtocolComparisonLine data={comparison} showCdp={false} />
      </ChartFrame>

      {/* SECTION 9 — METHODOLOGY + CITE */}
      <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-tiny uppercase tracking-header-medium text-text-muted space-y-1">
        <p>Data sources: Morpho GraphQL API · DefiLlama · FRED (T-bill rates). Updated every 6 hours.</p>
        <p>TVL definition matches Morpho&apos;s published dashboard: deposits − active loans.</p>
        <p>Saturated-utilization IRM blow-ups (supply APY ≥ 100%) are excluded from every aggregate as data artifacts.</p>
      </div>
      <CiteThisPage pageTitle="Morpho Sector Overview" pageUrl="/" />
    </div>
  );
}

import { ChartFrame } from '@/components/chains/chart-frame';
import { PageProvenance } from '@/components/provenance';
import { BadDebtWatch } from '@/components/rates/bad-debt-watch';
import { MorphoVsAaveSpreadChart } from '@/components/rates/spread-chart';
import { RateHistogram } from '@/components/rates/rate-histogram';
import { RiskSurfaceTable } from '@/components/rates/risk-table';
import { UtilRateScatter } from '@/components/rates/util-rate-scatter';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtUsd } from '@/lib/format';
import {
  getBadDebtEvents,
  getMorphoVsAaveSpread,
  getRatesKpis,
  getRiskSurface,
  getSupplyApyHistogram,
  getUtilizationHistogram,
  getUtilizationVsRateScatter,
} from '@/lib/queries/rates';

export const revalidate = 900;

// Auto-generates the spread-chart subtitle from the USDC/Ethereum tail of
// the time series — the asset operators benchmark first.
function spreadSubtitle(series: Awaited<ReturnType<typeof getMorphoVsAaveSpread>>): string {
  const usdcEth = series.find((s) => s.asset === 'USDC' && s.chainId === 1);
  if (!usdcEth) return 'Insufficient Morpho-vs-Aave overlap to compute headline spread.';
  const tail = usdcEth.points.slice(-14).filter((p) => p.spreadBps != null);
  if (tail.length === 0) return 'No spread data in the last 14 days for USDC · Ethereum.';
  const avg = tail.reduce((s, p) => s + (p.spreadBps ?? 0), 0) / tail.length;
  const word = avg >= 0 ? 'pays' : 'pays less than';
  const abs = Math.abs(avg).toFixed(0);
  return `Headline: Morpho ${word} Aave V3 on USDC · Ethereum by an avg of ${abs} bps over the last 14 days.`;
}

export default async function RatesPage() {
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }

  const [kpis, apyHist, utilHist, spreadSeries, scatter, risk, badDebt] = await Promise.all([
    getRatesKpis(),
    getSupplyApyHistogram(),
    getUtilizationHistogram(),
    getMorphoVsAaveSpread(180),
    getUtilizationVsRateScatter(),
    getRiskSurface(20),
    getBadDebtEvents(90, 25),
  ]);

  if (!kpis.asOfDate) {
    return (
      <EmptyState
        title="No rate data yet"
        message="Wait for the next backfill tick or trigger /sync/markets and /sync/aave-rates manually."
      />
    );
  }

  // CSV builders — server-side strings ChartFrame ships to the client.
  const csvApyHist = ['bucket,bucket_low_pct,bucket_high_pct,market_count,supply_usd',
    ...apyHist.map((b) => [b.bucketLabel, b.bucketLow, b.bucketHigh ?? '', b.marketCount, b.supplyUsd].join(','))
  ].join('\n');
  const csvUtilHist = ['bucket,bucket_low_pct,bucket_high_pct,market_count,supply_usd',
    ...utilHist.map((b) => [b.bucketLabel, b.bucketLow, b.bucketHigh ?? '', b.marketCount, b.supplyUsd].join(','))
  ].join('\n');
  const csvSpread = ['asset,chain,date,morpho_apy,aave_apy,spread_bps',
    ...spreadSeries.flatMap((s) =>
      s.points.map((p) => [s.asset, s.chainName, p.date, p.morphoApy ?? '', p.aaveApy ?? '', p.spreadBps ?? ''].join(',')),
    ),
  ].join('\n');
  const csvScatter = ['market,chain,collateral,loan,category,utilization,supply_apy,supply_usd,lltv',
    ...scatter.map((p) => [
      p.marketKey, p.chainSlug, p.collateralSymbol ?? '', p.loanSymbol, p.category,
      p.utilization, p.supplyApy, p.supplyUsd, p.lltv ?? '',
    ].join(',')),
  ].join('\n');
  const csvRisk = ['market,chain,pair,supply_usd,utilization,lltv,borrow_apy,risk_score,collateral_class',
    ...risk.map((r) => [
      r.marketKey, r.chainSlug, r.pair, r.supplyUsd, r.utilization, r.lltv,
      r.borrowApy ?? '', r.riskScore, r.collateralCategory,
    ].join(',')),
  ].join('\n');
  const csvBadDebt = ['date,market,chain,pair,prior_bad_debt,bad_debt,delta',
    ...badDebt.map((r) => [r.date, r.marketKey, r.chainSlug, r.pair, r.priorBadDebtUsd, r.badDebtUsd, r.deltaUsd].join(',')),
  ].join('\n');

  const spreadSub = spreadSubtitle(spreadSeries);
  const apyHistTop = apyHist.length > 0
    ? apyHist.reduce((m, b) => (b.supplyUsd > m.supplyUsd ? b : m))
    : null;
  const utilHistTop = utilHist.length > 0
    ? utilHist.reduce((m, b) => (b.supplyUsd > m.supplyUsd ? b : m))
    : null;

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Rates
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          Where the cost of capital actually sits on Morpho, and how it compares to Aave V3 across the four
          assets that dominate stablecoin and ETH lending —{' '}
          <span className="text-text-primary">USDC · USDT · DAI · WETH</span>{' '}
          on Ethereum, Base, Arbitrum, Polygon. Snapshot as of{' '}
          <span className="text-text-primary">{kpis.asOfDate ?? '—'}</span>.
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Morpho Weighted Supply APY"
          value={kpis.morphoSupplyApyWeighted == null ? '—' : `${(kpis.morphoSupplyApyWeighted * 100).toFixed(2)}%`}
          subtext="across USDC·USDT·DAI·WETH"
          accent="chart-6"
        />
        <KpiCard
          label="Aave V3 Weighted Supply APY"
          value={kpis.aaveSupplyApyWeighted == null ? '—' : `${(kpis.aaveSupplyApyWeighted * 100).toFixed(2)}%`}
          subtext="same 4 assets, latest day"
          accent="chart-1"
        />
        <KpiCard
          label="USDC·ETH Spread"
          value={kpis.spreadHeadlineBps == null ? '—' : `${kpis.spreadHeadlineBps >= 0 ? '+' : ''}${kpis.spreadHeadlineBps.toFixed(0)} bps`}
          subtext={`Morpho ${kpis.morphoUsdcEthUtil == null ? '' : `${(kpis.morphoUsdcEthUtil * 100).toFixed(0)}% util`} · Aave ${kpis.aaveUsdcEthUtil == null ? '' : `${(kpis.aaveUsdcEthUtil * 100).toFixed(0)}% util`}`}
          accent="chart-2"
        />
        <KpiCard
          label="Bad-Debt Events (30d)"
          value={String(kpis.badDebtEvents30d)}
          subtext={`mkt-days w/ +5% bad debt growth`}
          accent="chart-4"
        />
        <KpiCard
          label="Total Bad Debt"
          value={fmtUsd(kpis.totalBadDebtUsd, { compact: true })}
          subtext="latest snapshot, all markets"
          accent="chart-5"
        />
      </div>

      {/* 3. HISTOGRAMS PAIR */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Supply APY distribution"
          subtitle={apyHistTop ? `Most supply USD sits in the ${apyHistTop.bucketLabel} bucket (${apyHistTop.marketCount} markets, ${fmtUsd(apyHistTop.supplyUsd, { compact: true })}).` : undefined}
          csvFilename="rates-supply-apy-hist.csv"
          csvContent={csvApyHist}
          methodologyKey="rates-supply-apy-hist"
        >
          <RateHistogram data={apyHist} mode="supply" />
        </ChartFrame>
        <ChartFrame
          title="Utilization distribution"
          subtitle={utilHistTop ? `Most supply USD sits in the ${utilHistTop.bucketLabel} utilization band (${utilHistTop.marketCount} markets, ${fmtUsd(utilHistTop.supplyUsd, { compact: true })}).` : undefined}
          csvFilename="rates-utilization-hist.csv"
          csvContent={csvUtilHist}
          methodologyKey="rates-util-hist"
        >
          <RateHistogram data={utilHist} mode="supply" />
        </ChartFrame>
      </div>

      {/* 4. MORPHO vs AAVE — centerpiece */}
      <ChartFrame
        title="Morpho vs Aave V3 — supply-APY spread"
        subtitle={spreadSub}
        csvFilename="rates-morpho-vs-aave.csv"
        csvContent={csvSpread}
        methodologyKey="rates-morpho-vs-aave"
      >
        <MorphoVsAaveSpreadChart series={spreadSeries} />
      </ChartFrame>

      {/* 5. UTIL × RATE SCATTER */}
      <ChartFrame
        title="Utilization × Supply APY — by market"
        subtitle="One bubble per Morpho market with >$1M supply. Bubble area = supply USD; color = collateral asset class."
        csvFilename="rates-util-vs-apy.csv"
        csvContent={csvScatter}
        methodologyKey="rates-util-apy-scatter"
      >
        <UtilRateScatter data={scatter} />
      </ChartFrame>

      {/* 6. RISK SURFACE TABLE */}
      <ChartFrame
        title="Risk surface — top 20 by blast radius"
        subtitle="risk_score = supply × utilization × LLTV. The markets where a liquidation cascade has the largest dollar impact."
        csvFilename="rates-risk-surface.csv"
        csvContent={csvRisk}
        methodologyKey="rates-risk-surface"
      >
        <RiskSurfaceTable data={risk} />
      </ChartFrame>

      {/* 7. BAD DEBT WATCH */}
      <ChartFrame
        title="Bad-debt watch (90d)"
        subtitle="Market-days where unrealized bad debt rose >5% over the prior day and exceeds $1k absolute."
        csvFilename="rates-bad-debt.csv"
        csvContent={csvBadDebt}
        methodologyKey="rates-bad-debt"
      >
        <BadDebtWatch data={badDebt} />
      </ChartFrame>

      <PageProvenance
        pageTitle="Rates"
        pageUrl="/rates"
        fetchedAt={kpis.asOfDate ?? new Date().toISOString()}
        source="Morpho Blue GraphQL + DefiLlama Yields (Aave V3 reserves)"
        methodology={{
          text: "Aave V3 rates sourced from DefiLlama yields (yields.llama.fi). Morpho rates are supply-weighted across all markets whose loan_asset matches the comparison universe; LLTV uses Morpho's market parameter, not a chain-wide LTV cap.\nSaturated-util IRM blow-ups — Morpho markets stuck at 100% utilization with degenerate oracles (BONDUSD/USR, K/USDC on Arbitrum, the HERMES/USDC family on Base, sdeUSD/USDC) — produce 418%-2980% supply APYs that are data artifacts, not rates anyone earns. Any market with supply_apy >= 100% is excluded from the histograms, scatter, KPI strip, and Morpho-vs-Aave spread series. Those markets stay visible in the risk-surface table since they are the largest blast-radius positions.",
          source: 'aave_rates_daily refreshed every 6h by the worker · market_state_daily latest snapshot per market',
        }}
      />
    </div>
  );
}

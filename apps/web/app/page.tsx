import Link from 'next/link';

import { ChartFrame } from '@/components/chains/chart-frame';
import { DualAreaChart } from '@/components/overview/dual-area-chart';
import { KpiCardWithSparkline } from '@/components/overview/kpi-card-with-sparkline';
import { ProtocolComparisonLine } from '@/components/overview/protocol-comparison-line';
import { RecentLaunchesFeed } from '@/components/overview/recent-launches-feed';
import { StackedAreaByChain } from '@/components/overview/stacked-area-by-chain';
import { StackedBarWeeklyByChain } from '@/components/overview/stacked-bar-weekly-by-chain';
import { TopFivePanel } from '@/components/overview/top-five-panel';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtUsd } from '@/lib/format';
import {
  getDepositsAndLoansSeries,
  getMetricByChainSeries,
  getProtocolKpis,
  getProtocolRanking,
  getProtocolTvlComparison,
  getRecentLaunches,
  getTopFiveSnapshots,
  getWeeklyBorrowInterestByChain,
  getWeeklyCurationFeesByChain,
} from '@/lib/queries/overview';

export const revalidate = 900;

interface SP {
  cdp?: string;       // '0' to hide
  legacy?: string;    // '1' to collapse
}

interface Props { searchParams: Promise<SP> }

const pct = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`;

export default async function OverviewPage({ searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  const sp = await searchParams;
  const showCdp = sp.cdp !== '0';
  const collapseLegacy = sp.legacy === '1';

  const [
    kpis, hero,
    depositsByChain, loansByChain,
    weeklyBorrow, weeklyFees,
    comparison, ranking,
    topFive, launches,
  ] = await Promise.all([
    getProtocolKpis(),
    getDepositsAndLoansSeries(730),
    getMetricByChainSeries('deposits', 730),
    getMetricByChainSeries('loans', 730),
    getWeeklyBorrowInterestByChain(104),
    getWeeklyCurationFeesByChain(104),
    getProtocolTvlComparison({ days: 730, includeCdp: true, collapseLegacy }),
    getProtocolRanking(),
    getTopFiveSnapshots(),
    getRecentLaunches(30),
  ]);

  // ─── Hero auto-subtitle ────────────────────────────────────────────
  const lastHero = hero[hero.length - 1];
  const heroLine = lastHero
    ? `Total Deposits ${fmtUsd(lastHero.totalDeposits, { compact: true })} · Active Loans ${fmtUsd(lastHero.activeLoans, { compact: true })} · TVL ${fmtUsd(lastHero.tvl, { compact: true })}. Loans are ${pct(lastHero.totalDeposits > 0 ? lastHero.activeLoans / lastHero.totalDeposits : null)} of deposits.`
    : 'Awaiting first sync.';

  // ─── Chain stack subtitles ─────────────────────────────────────────
  const topChainName = (slug: string | null, series: typeof depositsByChain) =>
    series.chains.find((c) => c.slug === slug)?.name ?? slug ?? '—';

  const depositsSub = `${topChainName(depositsByChain.topChainSlug, depositsByChain)} is ${pct(depositsByChain.topChainShareLatest)} of total deposits as of ${kpis.asOfDate} — up from ${pct(depositsByChain.topChainShare12moAgo)} 12 months ago.`;
  const loansSub = `${topChainName(loansByChain.topChainSlug, loansByChain)} accounts for ${pct(loansByChain.topChainShareLatest)} of active loans. Borrow/deposit ratio across the protocol: ${pct(lastHero && lastHero.totalDeposits > 0 ? lastHero.activeLoans / lastHero.totalDeposits : null)}.`;

  // ─── Weekly subtitles ──────────────────────────────────────────────
  const borrowTopName = topChainName(weeklyBorrow.lastWeekTopChain, weeklyBorrow as unknown as typeof depositsByChain);
  const feesTopName = topChainName(weeklyFees.lastWeekTopChain, weeklyFees as unknown as typeof depositsByChain);
  const weeklyBorrowSub = `Last week: ${fmtUsd(weeklyBorrow.lastWeekTotalUsd, { compact: true })} in borrow interest paid · ${pct(weeklyBorrow.lastWeekTopChainSharePct)} from ${borrowTopName}. Annual run-rate: ${fmtUsd(weeklyBorrow.annualRunRateUsd, { compact: true })}.`;
  const weeklyFeesSub = `Last week: ${fmtUsd(weeklyFees.lastWeekTotalUsd, { compact: true })} to curators · ${pct(weeklyFees.lastWeekTopChainSharePct)} on ${feesTopName}. Annual run-rate: ${fmtUsd(weeklyFees.annualRunRateUsd, { compact: true })}.`;

  // ─── Sector comparison subtitle ────────────────────────────────────
  const compSub = (() => {
    const cur = ranking.morphoVsAaveV3Pct;
    const old = ranking.morphoVsAaveV3Pct12moAgo;
    const rankLine = `Morpho ranks #${ranking.morphoRank} of ${ranking.totalLendingProtocols} overcollateralized lending protocols`;
    const gap = ranking.gapToOneAboveUsd != null && ranking.oneAbove
      ? ` — ${fmtUsd(ranking.gapToOneAboveUsd, { compact: true })} behind ${ranking.oneAbove.label}.`
      : '.';
    const share = cur != null ? `Morpho TVL is ${pct(cur)} of Aave V3's globally` : 'Morpho TVL vs Aave V3 unavailable';
    const sharePrior = old != null ? `, vs ${pct(old)} one year ago` : '';
    return `${share}${sharePrior}. ${rankLine}${gap}`;
  })();

  // ─── CSV builders (server-side) ────────────────────────────────────
  const csvHero = ['day,total_deposits,active_loans,tvl',
    ...hero.map((p) => [p.day, p.totalDeposits, p.activeLoans, p.tvl].join(','))
  ].join('\n');
  const csvDepositsByChain = ['day,' + depositsByChain.chains.map((c) => c.slug).join(','),
    ...depositsByChain.points.map((p) =>
      [p.day, ...depositsByChain.chains.map((c) => p[c.slug] ?? 0)].join(','))
  ].join('\n');
  const csvLoansByChain = ['day,' + loansByChain.chains.map((c) => c.slug).join(','),
    ...loansByChain.points.map((p) =>
      [p.day, ...loansByChain.chains.map((c) => p[c.slug] ?? 0)].join(','))
  ].join('\n');
  const csvWeeklyBorrow = ['week_start,' + weeklyBorrow.chains.map((c) => c.slug).join(','),
    ...weeklyBorrow.buckets.map((b) =>
      [b.weekStart, ...weeklyBorrow.chains.map((c) => b.byChain[c.slug] ?? 0)].join(','))
  ].join('\n');
  const csvWeeklyFees = ['week_start,' + weeklyFees.chains.map((c) => c.slug).join(','),
    ...weeklyFees.buckets.map((b) =>
      [b.weekStart, ...weeklyFees.chains.map((c) => b.byChain[c.slug] ?? 0)].join(','))
  ].join('\n');
  const csvComparison = ['protocol,day,tvl_usd',
    ...comparison.lending.flatMap((s) => s.points.map((p) => [s.label.replace(/,/g, ' '), p.day, p.tvl].join(','))),
    ...comparison.cdp.flatMap((s) => s.points.map((p) => [s.label.replace(/,/g, ' '), p.day, p.tvl].join(','))),
  ].join('\n');

  // ─── Toggle hrefs for the comparison chart ─────────────────────────
  const toggleUrl = (next: { cdp?: string; legacy?: string }): string => {
    const params = new URLSearchParams();
    const cdp = next.cdp ?? sp.cdp;
    const legacy = next.legacy ?? sp.legacy;
    if (cdp === '0') params.set('cdp', '0');
    if (legacy === '1') params.set('legacy', '1');
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1 — HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Sector Overview
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          Morpho across all chains
          {kpis.asOfDate ? <span className="text-text-muted"> · as of {kpis.asOfDate}</span> : null}
        </p>
      </header>

      {/* SECTION 2 — KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <KpiCardWithSparkline label="Total Deposits"          value={fmtUsd(kpis.totalDeposits.value, { compact: true })}        deltaPct={kpis.totalDeposits.delta30dPct}        accent="chart-1" sparkline={kpis.totalDeposits.sparkline} />
        <KpiCardWithSparkline label="Active Loans"            value={fmtUsd(kpis.activeLoans.value, { compact: true })}          deltaPct={kpis.activeLoans.delta30dPct}          accent="chart-3" sparkline={kpis.activeLoans.sparkline} />
        <KpiCardWithSparkline label="TVL"                     value={fmtUsd(kpis.tvl.value, { compact: true })}                  deltaPct={kpis.tvl.delta30dPct}                  accent="chart-2" sparkline={kpis.tvl.sparkline} />
        <KpiCardWithSparkline label="Total Supply"            value={fmtUsd(kpis.totalSupply.value, { compact: true })}          deltaPct={kpis.totalSupply.delta30dPct}          accent="chart-5" sparkline={kpis.totalSupply.sparkline} />
        <KpiCardWithSparkline label="Annual Borrow Interest"  value={fmtUsd(kpis.annualBorrowInterest.value, { compact: true })} deltaPct={kpis.annualBorrowInterest.delta30dPct} accent="chart-6" sparkline={kpis.annualBorrowInterest.sparkline} />
        <KpiCardWithSparkline label="Annual Curation Fees"    value={fmtUsd(kpis.annualCurationFees.value, { compact: true })}   deltaPct={kpis.annualCurationFees.delta30dPct}   accent="chart-7" sparkline={kpis.annualCurationFees.sparkline} />
        <KpiCardWithSparkline label="Assets Under Curation"   value={fmtUsd(kpis.assetsUnderCuration.value, { compact: true })}  deltaPct={kpis.assetsUnderCuration.delta30dPct}  accent="chart-4" sparkline={kpis.assetsUnderCuration.sparkline} />
      </div>

      {/* SECTION 3 — HERO */}
      <ChartFrame
        title="Deposits & Active Loans — all chains, all time"
        subtitle={heroLine}
        csvFilename="overview-deposits-loans.csv"
        csvContent={csvHero}
      >
        <DualAreaChart data={hero} />
      </ChartFrame>

      {/* SECTION 4 — Deposits by chain */}
      <ChartFrame
        title="Deposits by chain"
        subtitle={depositsSub}
        csvFilename="overview-deposits-by-chain.csv"
        csvContent={csvDepositsByChain}
      >
        <StackedAreaByChain data={depositsByChain} />
      </ChartFrame>

      {/* SECTION 5 — Active loans by chain */}
      <ChartFrame
        title="Active loans by chain"
        subtitle={loansSub}
        csvFilename="overview-loans-by-chain.csv"
        csvContent={csvLoansByChain}
      >
        <StackedAreaByChain data={loansByChain} />
      </ChartFrame>

      {/* SECTION 6 — Weekly borrow interest by chain */}
      <ChartFrame
        title="Weekly borrow interest paid — by chain"
        subtitle={weeklyBorrowSub}
        csvFilename="overview-weekly-borrow-interest.csv"
        csvContent={csvWeeklyBorrow}
      >
        <StackedBarWeeklyByChain data={weeklyBorrow} />
      </ChartFrame>

      {/* SECTION 7 — Weekly curation fees by chain */}
      <ChartFrame
        title="Weekly curation fees — by chain"
        subtitle={weeklyFeesSub}
        csvFilename="overview-weekly-curation-fees.csv"
        csvContent={csvWeeklyFees}
      >
        <StackedBarWeeklyByChain data={weeklyFees} />
      </ChartFrame>

      {/* SECTION 8 — Sector TVL comparison */}
      <ChartFrame
        title="Lending TVL comparison — top protocols, all time"
        subtitle={compSub}
        csvFilename="overview-sector-tvl-comparison.csv"
        csvContent={csvComparison}
      >
        <div className="space-y-3">
          {/* Toggle row */}
          <div className="flex flex-wrap items-center gap-2 text-tiny uppercase tracking-header-medium">
            <ToggleLink
              label={showCdp ? 'Hide CDPs' : 'Show CDPs'}
              active={showCdp}
              href={toggleUrl({ cdp: showCdp ? '0' : '' })}
            />
            <ToggleLink
              label={collapseLegacy ? 'Show v2 + v3 separately' : 'Collapse legacy versions'}
              active={collapseLegacy}
              href={toggleUrl({ legacy: collapseLegacy ? '' : '1' })}
            />
          </div>
          <ProtocolComparisonLine data={comparison} showCdp={showCdp} />
        </div>
      </ChartFrame>

      {/* SECTION 9 — Entity growth — placeholder note (the series is fetched
          for the next chart-density pass; keeping it light here so the
          Overview ships without re-introducing dual-axis complexity until
          we have the chart-card story for it dialed). */}

      {/* SECTION 10 — Top-5 trio */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopFivePanel
          title="Top 5 markets · supply USD"
          viewAllHref="/markets"
          rows={topFive.topMarkets.map((m) => ({
            label: m.pair,
            sub: m.chainSlug ?? undefined,
            valueUsd: m.supplyUsd,
          }))}
        />
        <TopFivePanel
          title="Top 5 vaults · TVL"
          viewAllHref="/vaults"
          rows={topFive.topVaults.map((v) => ({
            label: v.name ?? v.address.slice(0, 10),
            sub: v.chainSlug ?? undefined,
            valueUsd: v.tvlUsd,
          }))}
        />
        <TopFivePanel
          title="Top 5 curators · TVL"
          viewAllHref="/curators"
          rows={topFive.topCurators.map((c) => ({
            label: c.name,
            valueUsd: c.tvlUsd,
            href: `/curators/${c.id}`,
          }))}
        />
      </div>

      {/* SECTION 11 — Recent launches */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentLaunchesFeed
          title="Launched in last 30 days — markets"
          rows={launches.markets.map((m) => ({
            date: m.createdAt,
            label: m.pair,
            chainName: m.chainName,
          }))}
        />
        <RecentLaunchesFeed
          title="Launched in last 30 days — vaults"
          rows={launches.vaults.map((v) => ({
            date: v.createdAt,
            label: v.name,
            chainName: v.chainName,
          }))}
        />
      </div>

      {/* SECTION 12 — Provenance footer */}
      <PageProvenance
        pageTitle="Sector Overview"
        pageUrl="/"
        fetchedAt={kpis.asOfDate ?? new Date().toISOString()}
        source="Morpho Blue GraphQL + DefiLlama TVL + overview_weekly_chain_metrics"
        methodology={{
          text:
            'Every KPI is built from one of seven distinct lenses: Total Deposits (supply + collateral), Active Loans (borrow), TVL (deposits − loans), Total Supply (loan-side only), Annual Borrow Interest (Σ borrow_usd × borrow_apy, annualized), Annual Curation Fees (Σ vault TVL × pre-fee APY × fee, annualized), and Assets Under Curation (Σ vault TVL).\nWeekly bar charts read from morpho_.overview_weekly_chain_metrics, a daily-rebuilt aggregation. All other charts compute on the fly with unstable_cache(900). Sector TVL comparison uses LENDING_PROTOCOLS — eight overcollateralized lending protocols and three CDPs from lib/protocols/comparison-set.ts.\nSaturated-util IRM blow-ups (supply_apy ≥ 100%) are excluded from every aggregate as data artifacts. They still appear in /markets and /rates so the operator can see them.',
          source: 'morpho_.market_state_daily · vault_state_daily · protocol_tvl_daily · overview_weekly_chain_metrics',
        }}
      />
    </div>
  );
}

/** Small toggle pill used in the sector-comparison chart header. */
function ToggleLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border px-2.5 py-1 transition-colors"
      style={{
        borderColor: active ? 'rgb(var(--accent-rgb) / 0.4)' : 'var(--card-border)',
        background: active ? 'rgb(var(--accent-rgb) / 0.1)' : 'transparent',
        color: active ? 'var(--accent-orange)' : 'var(--text-muted)',
      }}
    >
      {label}
    </Link>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChainAssetMix } from '@/components/chains/chain-asset-mix';
import { ChartFrame } from '@/components/chains/chart-frame';
import { CuratorFeeScatter } from '@/components/curators/curator-fee-scatter';
import { CuratorInflowsChart } from '@/components/curators/curator-inflows-chart';
import { CuratorPerfChart } from '@/components/curators/curator-perf-chart';
import { CuratorTvlChainChart } from '@/components/curators/curator-tvl-chain-chart';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  getCuratorAllocationByAssetClass,
  getCuratorDetail,
  getCuratorFeeStructure,
  getCuratorKpis,
  getCuratorLoanBookComposition,
  getCuratorPerformanceVsMarket,
  getCuratorTvlByChain,
  getCuratorVaultPerformance,
  getCuratorVsSectorBenchmark,
  getCuratorWeeklyNetInflows,
} from '@/lib/queries/curators';

interface Props { params: Promise<{ slug: string }> }
export const revalidate = 900;

const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(2)}%`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const deltaCls = (v: number | null) => (v == null ? 'text-text-muted' : v >= 0 ? 'text-positive' : 'text-negative');

export default async function CuratorDetailPage({ params }: Props) {
  const { slug } = await params;
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }
  const detail = await getCuratorDetail(slug);
  if (!detail) notFound();

  const [kpis, tvlChain, vaults, assetMix, perf, loanBook, feeStructure, vsSector, weekly] = await Promise.all([
    getCuratorKpis(detail.curatorId),
    getCuratorTvlByChain(detail.curatorId, 365),
    getCuratorVaultPerformance(detail.curatorId),
    getCuratorAllocationByAssetClass(detail.curatorId),
    getCuratorPerformanceVsMarket(detail.curatorId, 90),
    getCuratorLoanBookComposition(detail.curatorId),
    getCuratorFeeStructure(detail.curatorId),
    getCuratorVsSectorBenchmark(detail.curatorId),
    getCuratorWeeklyNetInflows(detail.curatorId, 13),
  ]);
  if (!kpis) notFound();

  const aum = kpis.totalTvlUsd;
  const aum30dDelta = kpis.tvl30dAgoUsd && kpis.tvl30dAgoUsd > 0 ? (aum - kpis.tvl30dAgoUsd) / kpis.tvl30dAgoUsd : null;

  // perf subtitle
  const recent = perf.slice(-14);
  const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const curAvg = avg(recent.map((p) => p.curatorNetApy));
  const mktAvg = avg(recent.map((p) => p.morphoNetApy));
  const perfSubtitle = curAvg != null && mktAvg != null
    ? `${curAvg >= mktAvg ? 'Outperforms' : 'Underperforms'} Morpho-wide weighted avg net APY by ${Math.abs((curAvg - mktAvg) * 10000).toFixed(0)} bps over the last 14 days`
    : 'Not enough overlap with the Morpho-wide series to compute';

  // weekly inflow subtitle
  const lastWk = weekly.length ? weekly[weekly.length - 1]!.netChangeUsd : null;
  const run4 = weekly.slice(-4).reduce((s, w) => s + w.netChangeUsd, 0);
  const sgn = (v: number) => (v >= 0 ? '+' : '−');
  const inflowSubtitle = lastWk != null
    ? `Net flow last week: ${sgn(lastWk)}${fmtUsd(Math.abs(lastWk), { compact: true })} · 4-week running: ${sgn(run4)}${fmtUsd(Math.abs(run4), { compact: true })}`
    : undefined;

  const maxLoanAum = Math.max(...loanBook.map((l) => l.aumUsd), 1);
  const csv = (head: string, rows: (string | number | null)[][]) => [head, ...rows.map((r) => r.map((c) => (c == null ? '' : c)).join(','))].join('\n');

  return (
    <div className="space-y-6">
      <Link href="/curators" className="inline-block text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary">← Curators</Link>

      {/* 1. HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          {detail.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.imageUrl} alt="" width={56} height={56} className="rounded-md border border-border bg-surface" />
          ) : (<div className="size-14 rounded-md border border-border bg-surface" />)}
          <div>
            <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
              {detail.curatorName}{detail.verified && <span className="ml-2 align-middle text-accent text-body">●</span>}
            </h1>
            <p className="mt-2 text-body text-text-secondary">
              {fmtNumber(detail.vaultCount)} vaults · {fmtNumber(detail.chainCount)} chains ·{' '}
              <span className="text-text-primary">{usdC(aum)}</span> AUM ·{' '}
              <span className="text-accent">#{detail.rank}</span><span className="text-text-muted"> of {fmtNumber(detail.totalCurators)} curators</span>
            </p>
          </div>
        </div>
      </header>

      {/* 2. KPI STRIP. Asset-manager hierarchy */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="AUM" value={usdC(aum)} subtext={aum30dDelta != null ? `30d ${signedPct(aum30dDelta)}` : 'no baseline'} accent="chart-1" />
        <KpiCard label="Borrow Interest Captured" value={usdC(kpis.borrowInterestCapturedUsd)} subtext="annualized" accent="chart-3" />
        <KpiCard label="Curator Fees" value={usdC(kpis.estAnnualRevenueUsd)} subtext="annualized" accent="chart-6" />
        <KpiCard label="Fee Take Rate" value={pct1(kpis.feeTakeRate)} subtext="fees ÷ interest" accent="chart-2" />
        <KpiCard label="Net APY Delivered" value={pct2(kpis.weightedNetApy)} subtext="to depositors" accent="chart-5" />
        <KpiCard label="AUM 30d Δ" value={signedPct(aum30dDelta)} subtext="vs 30 days ago" accent="chart-7" />
      </div>

      {/* 3. TVL BY CHAIN */}
      <ChartFrame title={`AUM by Chain: ${detail.curatorName}`} csvFilename={`curator-tvl-chain-${detail.curatorId}.csv`}
        csvContent={csv(['date', ...tvlChain.chains.map((c) => c.slug)].join(','), tvlChain.series.map((p) => ['date', ...tvlChain.chains.map((c) => c.slug)].map((k) => p[k] ?? '')))}
        methodologyText="Curator AUM (Σ vault TVL) stacked by chain over the last 365 days.">
        <CuratorTvlChainChart data={tvlChain.series} chains={tvlChain.chains} />
      </ChartFrame>

      {/* 5/6. ASSET CLASS MIX + PERF (kept) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame title={`Asset Class Mix: ${detail.curatorName}`} subtitle="By vault asset symbol (proxy for allocation)"
          csvFilename={`curator-asset-mix-${detail.curatorId}.csv`} csvContent={csv('category,tvl_usd,top_symbol', assetMix.map((s) => [s.category, s.tvlUsd, s.topSymbol ?? '']))}
          methodologyText="Curator AUM by asset class, bucketed from vault.asset_symbol (the loan-asset side). A proxy; true collateral allocation lives in vault_allocations_daily (empty).">
          <ChainAssetMix data={assetMix.map((s) => ({ category: s.category, supplyUsd: s.tvlUsd, topSymbol: s.topSymbol, topSymbolUsd: s.tvlUsd }))} />
        </ChartFrame>
        <ChartFrame title="Curator vs Morpho-Wide. Net APY (90d)" subtitle={perfSubtitle}
          csvFilename={`curator-perf-${detail.curatorId}.csv`} csvContent={csv('date,curator_net_apy,morpho_net_apy', perf.map((p) => [p.date, p.curatorNetApy ?? '', p.morphoNetApy ?? '']))}
          methodologyText="AUM-weighted net APY this curator delivers vs the Morpho-wide AUM-weighted net APY across all curators. Degenerate vaults excluded.">
          <CuratorPerfChart data={perf} />
        </ChartFrame>
      </div>

      {/* 7. LOAN BOOK COMPOSITION */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Loan Book Composition</h2>
          <MethodologyTooltip text="Curator AUM by loan asset (vault.asset_symbol). Inferred from vault asset symbol. True market-level allocation lives in vault_allocations_daily, currently empty." source="morpho_.vaults × morpho_.vault_state_daily" />
        </div>
        <p className="mt-0.5 mb-4 text-tiny text-text-secondary">What loan assets is this curator exposed to?</p>
        {loanBook.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">No vaults</div> : (
          <div className="space-y-2">
            {loanBook.slice(0, 8).map((l) => (
              <div key={l.assetSymbol} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                <span className="text-tiny uppercase tracking-header-medium text-text-secondary">{l.assetSymbol}</span>
                <div className="relative h-5 rounded-sm bg-background">
                  <div className="absolute inset-y-0 left-0 rounded-sm bg-accent/70" style={{ width: `${Math.max(2, (l.aumUsd / maxLoanAum) * 100)}%` }} />
                  <span className="absolute inset-y-0 right-2 flex items-center text-[10px] tabular-nums text-text-primary">{usdC(l.aumUsd)}</span>
                </div>
                <span className="text-right text-[10px] text-text-muted whitespace-nowrap">{l.vaultCount} vault{l.vaultCount === 1 ? '' : 's'} · {l.chainCount} chain{l.chainCount === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-tiny text-text-muted">Inferred from vault asset symbol. True market-level allocation lives in vault_allocations_daily (empty).</p>
      </section>

      {/* 8. FEE STRUCTURE */}
      <ChartFrame title="Fee Structure Breakdown" subtitle="Performance fee vs vault TVL · bubble size = net APY"
        csvFilename={`curator-fee-structure-${detail.curatorId}.csv`} csvContent={csv('vault,fee_bps,tvl_usd,net_apy', feeStructure.map((f) => [f.name, f.feeBps ?? '', f.tvlUsd, f.netApy ?? '']))}
        methodologyText="Each bubble is one vault: X = performance fee, Y = vault TVL, size = net APY. Reveals whether the curator prices fees consistently or discriminates between vaults.">
        <CuratorFeeScatter points={feeStructure} />
      </ChartFrame>

      {/* 9. VS-SECTOR BENCHMARK */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Vs-Sector Benchmark</h2>
          <MethodologyTooltip text="Per chain: this curator's AUM-weighted net APY vs the Morpho-wide AUM-weighted net APY across all curators on that chain. Positive spread = delivering alpha." source="morpho_.vault_state_daily × morpho_.vaults" />
        </div>
        {vsSector.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">No chains</div> : (
          <table className="w-full text-body">
            <thead><tr className="border-b border-border text-left"><Th>Chain</Th><Th r>Curator Net APY</Th><Th r>Sector Net APY</Th><Th r>Spread</Th></tr></thead>
            <tbody>
              {vsSector.map((r) => (
                <tr key={r.chainSlug} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2 uppercase tracking-header-medium text-text-primary">{r.chainName}</td>
                  <td className="py-2 text-right tabular-nums text-positive">{pct2(r.curatorNetApy)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{pct2(r.sectorNetApy)}</td>
                  <td className={`py-2 text-right tabular-nums ${(r.spreadBps ?? 0) >= 0 ? 'text-positive' : 'text-negative'}`}>{r.spreadBps == null ? 'N/A' : `${r.spreadBps >= 0 ? '+' : ''}${r.spreadBps} bps`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 10. VAULT PERFORMANCE RANKING */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Vault Performance: {detail.curatorName}</h2>
          <MethodologyTooltip text="Every vault in the curator's book. Borrow Interest = TVL × pre-fee APY (annualized). Fee Take Rate per vault = the performance fee. APY clamped <100%; degenerate vaults excluded." source="morpho_.vault_state_daily × morpho_.vaults" />
        </div>
        {vaults.length === 0 ? <div className="text-small uppercase tracking-header-medium text-text-muted">No vaults yet</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead><tr className="border-b border-border text-left">
                <Th>Vault</Th><Th>Chain</Th><Th>Asset</Th><Th r>AUM</Th><Th r>Net APY</Th><Th r>Fee</Th><Th r>Borrow Int.</Th><Th r>Take Rate</Th><Th r>AUM 30d Δ</Th>
              </tr></thead>
              <tbody>
                {vaults.map((v) => (
                  <tr key={`${v.chainId}:${v.address}`} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                    <td className="py-2 uppercase tracking-header-medium text-text-primary">{v.name ?? <span className="text-text-muted">unnamed</span>}</td>
                    <td className="py-2 uppercase tracking-header-medium text-text-secondary">{v.chainSlug ?? v.chainId}</td>
                    <td className="py-2 uppercase tracking-header-medium text-text-secondary">{v.assetSymbol ?? 'N/A'}</td>
                    <td className="py-2 text-right tabular-nums text-text-primary">{usdC(v.aumUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-positive">{pct2(v.netApy)}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{v.feeBps == null ? 'N/A' : `${(v.feeBps / 100).toFixed(1)}%`}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(v.borrowInterestUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-accent">{pct1(v.feeTakeRate)}</td>
                    <td className={`py-2 text-right tabular-nums ${deltaCls(v.aum30dDeltaPct)}`}>{signedPct(v.aum30dDeltaPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 11. WEEKLY NET INFLOWS */}
      <ChartFrame title="Weekly Net Inflows" subtitle={inflowSubtitle}
        csvFilename={`curator-inflows-${detail.curatorId}.csv`} csvContent={csv('week_start,net_change_usd', weekly.map((w) => [w.weekStart, w.netChangeUsd]))}
        methodologyText="Weekly change in the curator's total AUM (inflows − outflows + market gains) over the last 13 weeks, from end-of-week AUM snapshots.">
        <CuratorInflowsChart points={weekly} />
      </ChartFrame>

      {/* 12. METHODOLOGY */}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3 text-small text-text-secondary leading-relaxed">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Methodology</h2>
        <p>AUM = Σ vault TVL. Borrow Interest Captured = Σ TVL × pre-fee APY (annualized). Curator Fees = × performance fee. Fee Take Rate = fees ÷ borrow interest captured. Net APY Delivered = AUM-weighted net_apy. APYs are clamped at 100% and vaults reporting &gt;100% APY are excluded (degenerate-IRM).</p>
        <p>Loan-book and asset-class views use vault.asset_symbol (loan-asset side) as a proxy. True market-level allocation lives in vault_allocations_daily, currently empty. Fees realize in vault shares, so USD-marked revenue varies with share price.</p>
      </section>
    </div>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>;
}

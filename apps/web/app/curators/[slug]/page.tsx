import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChainAssetMix } from '@/components/chains/chain-asset-mix';
import { ChartFrame } from '@/components/chains/chart-frame';
import { CuratorPerfChart } from '@/components/curators/curator-perf-chart';
import { CuratorTvlChainChart } from '@/components/curators/curator-tvl-chain-chart';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  getCuratorAllocationByAssetClass,
  getCuratorDetail,
  getCuratorKpis,
  getCuratorPerformanceVsMarket,
  getCuratorTvlByChain,
  getCuratorVaults,
} from '@/lib/queries/curators';

interface Props {
  params: Promise<{ slug: string }>;
}

export const revalidate = 900;

const fmtDeltaPct = (current: number | null, prior: number | null): string => {
  if (current == null || prior == null || prior === 0) return '—';
  const p = (current - prior) / prior;
  return `${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}%`;
};
const fmtDeltaPp = (current: number | null, prior: number | null): string => {
  if (current == null || prior == null) return '—';
  const pp = (current - prior) * 100;
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`;
};

export default async function CuratorDetailPage({ params }: Props) {
  const { slug } = await params;
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }
  const detail = await getCuratorDetail(slug);
  if (!detail) notFound();

  const [kpis, tvlChain, vaults, assetMix, perf] = await Promise.all([
    getCuratorKpis(detail.curatorId),
    getCuratorTvlByChain(detail.curatorId, 365),
    getCuratorVaults(detail.curatorId),
    getCuratorAllocationByAssetClass(detail.curatorId),
    getCuratorPerformanceVsMarket(detail.curatorId, 90),
  ]);

  if (!kpis) notFound();

  // CSV builders
  const csvVaults = () => {
    const head = 'chain,vault,asset,tvl_usd,net_apy,fee_bps';
    const rows = vaults.map((v) =>
      [v.chainSlug, v.name ?? v.address, v.assetSymbol ?? '', v.tvlUsd, v.netApy ?? '', v.feeBps ?? ''].join(','),
    );
    return [head, ...rows].join('\n');
  };
  const csvAssetMix = () => {
    const head = 'category,tvl_usd,top_symbol';
    return [head, ...assetMix.map((s) => [s.category, s.tvlUsd, s.topSymbol ?? ''].join(','))].join('\n');
  };
  const csvPerf = () => {
    const head = 'date,curator_net_apy,morpho_net_apy';
    return [head, ...perf.map((p) => [p.date, p.curatorNetApy ?? '', p.morphoNetApy ?? ''].join(','))].join('\n');
  };
  const csvTvlChain = () => {
    const cols = ['date', ...tvlChain.chains.map((c) => c.slug)];
    return [
      cols.join(','),
      ...tvlChain.series.map((p) => cols.map((c) => (p[c] == null ? '' : p[c])).join(',')),
    ].join('\n');
  };

  // Auto-generated perf subtitle (dominant asset framing)
  const recent = perf.slice(-14);
  const recentCur = recent
    .map((p) => p.curatorNetApy)
    .filter((x): x is number => x != null);
  const recentMkt = recent
    .map((p) => p.morphoNetApy)
    .filter((x): x is number => x != null);
  const curAvg = recentCur.length ? recentCur.reduce((s, x) => s + x, 0) / recentCur.length : null;
  const mktAvg = recentMkt.length ? recentMkt.reduce((s, x) => s + x, 0) / recentMkt.length : null;
  const perfSubtitle =
    curAvg != null && mktAvg != null
      ? (() => {
          const pp = (curAvg - mktAvg) * 10000;       // basis points
          const word = pp >= 0 ? 'Outperforms' : 'Underperforms';
          return `${word} Morpho-wide weighted avg net APY by ${Math.abs(pp).toFixed(0)} bps over the last 14 days`;
        })()
      : 'Not enough overlap with the Morpho-wide series to compute';

  const adopted30d = kpis.vaultsAdded30d > 0 ? `+${kpis.vaultsAdded30d} in 30d` : 'no new vaults in 30d';

  return (
    <div className="space-y-6">
      <Link
        href="/curators"
        className="inline-block text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary"
      >
        ← Curators
      </Link>

      {/* 1. HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          {detail.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={detail.imageUrl}
              alt=""
              width={56}
              height={56}
              className="rounded-md border border-border bg-surface"
            />
          ) : (
            <div className="size-14 rounded-md border border-border bg-surface" />
          )}
          <div>
            <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
              {detail.curatorName}
              {detail.verified && <span className="ml-2 align-middle text-accent text-body">●</span>}
            </h1>
            <p className="mt-2 text-body text-text-secondary">
              {fmtNumber(detail.vaultCount)} vaults · {fmtNumber(detail.chainCount)} chains ·{' '}
              <span className="text-text-primary">{fmtUsd(detail.totalTvlUsd, { compact: true })}</span> TVL ·{' '}
              <span className="text-accent">#{detail.rank}</span>
              <span className="text-text-muted"> of {fmtNumber(detail.totalCurators)} curators</span>
            </p>
            {detail.url && (
              <a
                href={detail.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-tiny uppercase tracking-header-medium text-text-muted hover:text-accent"
              >
                {detail.url} ↗
              </a>
            )}
          </div>
        </div>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total TVL"
          value={fmtUsd(kpis.totalTvlUsd, { compact: true })}
          subtext={`30d ${fmtDeltaPct(kpis.totalTvlUsd, kpis.tvl30dAgoUsd)}`}
          accent="chart-1"
        />
        <KpiCard
          label="Share of MetaMorpho"
          value={`${(kpis.share * 100).toFixed(2)}%`}
          subtext={`30d ${fmtDeltaPp(kpis.share, kpis.share30dAgo)}`}
          accent="chart-2"
        />
        <KpiCard
          label="Vaults"
          value={fmtNumber(kpis.vaultCount)}
          subtext={adopted30d}
          accent="chart-4"
        />
        <KpiCard
          label="Weighted Net APY"
          value={kpis.weightedNetApy == null ? '—' : `${(kpis.weightedNetApy * 100).toFixed(2)}%`}
          accent="chart-5"
        />
        <KpiCard
          label="Est. Annual Revenue"
          value={fmtUsd(kpis.estAnnualRevenueUsd, { compact: true })}
          accent="chart-6"
        />
      </div>

      {/* 3. TVL BY CHAIN */}
      <ChartFrame
        title={`TVL by Chain — ${detail.curatorName}`}
        csvFilename={`curator-tvl-chain-${detail.curatorId}.csv`}
        csvContent={csvTvlChain()}
      >
        <CuratorTvlChainChart data={tvlChain.series} chains={tvlChain.chains} />
      </ChartFrame>

      {/* 4. VAULTS TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Vaults Under {detail.curatorName}
        </h2>
        {vaults.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No vaults yet</div>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Vault</Th>
                <Th>Chain</Th>
                <Th>Asset</Th>
                <Th align="right">TVL</Th>
                <Th align="right">Net APY</Th>
                <Th align="right">Fee</Th>
                <Th align="right">Utilization</Th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={`${v.chainId}:${v.address}`} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2.5 text-text-primary uppercase tracking-header-medium">
                    {v.name ?? <span className="text-text-muted">unnamed</span>}
                  </td>
                  <td className="py-2.5 text-text-secondary uppercase tracking-header-medium">{v.chainSlug ?? v.chainId}</td>
                  <td className="py-2.5 text-text-secondary uppercase tracking-header-medium">{v.assetSymbol ?? '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-primary">{fmtUsd(v.tvlUsd, { compact: true })}</td>
                  <td className="py-2.5 text-right tabular-nums text-positive">{v.netApy == null ? '—' : `${(v.netApy * 100).toFixed(2)}%`}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-secondary">{v.feeBps == null ? '—' : `${(v.feeBps / 100).toFixed(1)}%`}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-muted">
                    {v.utilization == null ? '—' : `${(v.utilization * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-tiny uppercase tracking-header-medium text-text-muted">
          Allocation-level data (vault_allocations_daily) not yet backfilled — utilization shows &quot;—&quot;.
        </p>
      </section>

      {/* 5. ALLOCATION BY ASSET CLASS */}
      <ChartFrame
        title={`Asset Class Mix — ${detail.curatorName}`}
        subtitle="Aggregated by each vault's underlying asset (proxy for true allocation mix)"
        csvFilename={`curator-asset-mix-${detail.curatorId}.csv`}
        csvContent={csvAssetMix()}
      >
        <ChainAssetMix
          data={assetMix.map((s) => ({
            category: s.category,
            supplyUsd: s.tvlUsd,
            topSymbol: s.topSymbol,
            topSymbolUsd: s.tvlUsd,
          }))}
        />
      </ChartFrame>

      {/* 6. PERFORMANCE VS MARKET */}
      <ChartFrame
        title={`Curator vs Morpho-Wide — Weighted Net APY (90d)`}
        subtitle={perfSubtitle}
        csvFilename={`curator-perf-${detail.curatorId}.csv`}
        csvContent={csvPerf()}
      >
        <CuratorPerfChart data={perf} />
      </ChartFrame>

      {/* Footer caveat */}
      <p className="text-tiny uppercase tracking-header-medium text-text-muted">
        Revenue estimates: tvl × pre-fee APY × performance fee, annualized. Fees realized in vault shares —
        actual USD-marked revenue varies with share price.
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

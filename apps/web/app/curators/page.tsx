import { ConcentrationPanel } from '@/components/curators/concentration-panel';
import { CuratorShareBar } from '@/components/curators/curator-share-bars';
import { CuratorTable } from '@/components/curators/curator-table';
import { ReachMatrix } from '@/components/curators/reach-matrix';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  getConcentrationStats,
  getCuratorDirectoryHeader,
  getCuratorReachMatrix,
  getCuratorRevenueLeaderboard,
  getCuratorShareStack,
  getCuratorTable,
  getDirectoryKpis,
} from '@/lib/queries/curators';

export const revalidate = 900;

export default async function CuratorsDirectoryPage() {
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }

  const [header, concentration, kpis, table, allBar, ethBar, reach, revLeaderboard] = await Promise.all([
    getCuratorDirectoryHeader(),
    getConcentrationStats(),
    getDirectoryKpis(),
    getCuratorTable(),
    getCuratorShareStack('all'),
    getCuratorShareStack('ethereum'),
    getCuratorReachMatrix(10, 8),
    getCuratorRevenueLeaderboard(5),
  ]);

  if (!header.activeCurators) {
    return (
      <EmptyState
        title="No curators yet"
        message="The Morpho curators registry hasn't been synced. Trigger /sync/curators."
      />
    );
  }

  // Total revenue (incl. unattributed) — denominator for revenue leaderboard share.
  const totalRevenue = revLeaderboard.reduce((s, r) => s + r.estAnnualRevenueUsd, 0);

  return (
    <div className="space-y-6">
      {/* 1. HEADER BLOCK */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
            Curators
          </h1>
          <p className="mt-2 text-body text-text-secondary">
            {fmtNumber(header.activeCurators)} active curators managing{' '}
            <span className="text-text-primary">{fmtUsd(header.totalCuratedTvlUsd, { compact: true })}</span>{' '}
            across {fmtNumber(header.chainCount)} chains
          </p>
        </div>
        <ConcentrationPanel stats={concentration} />
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Active Curators"      value={fmtNumber(kpis.activeCurators)} accent="chart-1" />
        <KpiCard label="Multi-Chain Curators" value={fmtNumber(kpis.multiChainCurators)} subtext="≥ 2 chains" accent="chart-2" />
        <KpiCard
          label="Largest Curator"
          value={fmtUsd(kpis.largestTvlUsd, { compact: true })}
          subtext={kpis.largestCuratorName ? `${kpis.largestCuratorName.toUpperCase()} · ${(kpis.largestShare * 100).toFixed(1)}%` : undefined}
          accent="chart-6"
        />
        <KpiCard label="Est. Annual Revenue"  value={fmtUsd(kpis.totalRevenueUsd, { compact: true })} subtext="Σ tvl × apy × fee" accent="chart-3" />
        <KpiCard label="Curated Vaults"       value={fmtNumber(kpis.vaultCount)} accent="chart-4" />
      </div>

      {/* 3. TOP CURATORS TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Top Curators
        </h2>
        <CuratorTable rows={table} />
      </section>

      {/* 4. SHARE STACKED BARS */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-4 text-small uppercase tracking-header-wide text-text-muted">
          Curator Share — Visual Stack
        </h2>
        <div className="space-y-5">
          <CuratorShareBar label="All chains · top 10 + others" slices={allBar} />
          <CuratorShareBar label="Ethereum only · top 10 + others" slices={ethBar} />
        </div>
        <p className="mt-4 text-tiny uppercase tracking-header-medium text-text-muted">
          Hover for $ + %. Per-chain concentration tends to run higher than global.
        </p>
      </section>

      {/* 5. REACH MATRIX */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Curator Reach Matrix — Top 10 × Top 8 chains
        </h2>
        <ReachMatrix
          curators={reach.curators}
          chains={reach.chains}
          cells={reach.cells}
          maxTvl={reach.maxTvl}
        />
        <p className="mt-3 text-tiny uppercase tracking-header-medium text-text-muted">
          Cell intensity is per-cell TVL relative to the matrix max. Empty cells mean no live vault.
        </p>
      </section>

      {/* 6. REVENUE LEADERBOARD */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Estimated Annual Revenue — Top 5
        </h2>
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted">Curator</th>
              <th className="pb-2 text-right text-tiny font-normal uppercase tracking-header-medium text-text-muted">Est. Revenue</th>
              <th className="pb-2 text-right text-tiny font-normal uppercase tracking-header-medium text-text-muted">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {revLeaderboard.map((r) => (
              <tr key={r.curatorId ?? 'unattributed'} className="border-b border-border last:border-0">
                <td className="py-2.5">
                  <span className={`uppercase tracking-header-medium ${r.isUnattributed ? 'text-text-muted' : 'text-text-primary'}`}>
                    {r.curatorName}
                  </span>
                  {r.isUnattributed && (
                    <span
                      className="ml-2 text-tiny text-text-muted"
                      title="Revenue from vaults whose fee_recipient address doesn't match a known curator. Total is preserved but unattributable until we map the recipient."
                    >
                      (fee_recipient unmapped)
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right tabular-nums text-text-primary">{fmtUsd(r.estAnnualRevenueUsd, { compact: true })}</td>
                <td className="py-2.5 text-right tabular-nums text-text-secondary">
                  {totalRevenue > 0 ? `${(r.sharePct * 100).toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Footer caveat — the quotable disclosure */}
      <p className="text-tiny uppercase tracking-header-medium text-text-muted">
        Revenue estimates: tvl × pre-fee APY × performance fee, annualized. Fees realized in vault shares —
        actual USD-marked revenue varies with share price. As of {header.asOfDate}.
      </p>
    </div>
  );
}

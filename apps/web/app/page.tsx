import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import { getOverviewKpis } from '@/lib/queries/overview';

export const revalidate = 900;

export default async function OverviewPage() {
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }

  const kpis = await getOverviewKpis();
  if (!kpis.hasData) {
    return (
      <EmptyState
        title="Awaiting first sync"
        message="Trigger the worker's /sync/* endpoints to populate the database."
      />
    );
  }

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-body uppercase tracking-header-wide text-text-muted">
          Sector Overview
        </h1>
        <p className="mt-1 text-body text-text-secondary">
          Morpho across all chains
          {kpis.asOfDate ? (
            <>
              {' · '}
              <span className="text-text-muted">as of {kpis.asOfDate}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total Morpho TVL"
          value={fmtUsd(kpis.morphoTvlUsd, { compact: true })}
          subtext="Sum across chains"
          accent="chart-1"
        />
        <KpiCard label="Markets"        value={fmtNumber(kpis.marketCount)}    accent="chart-2" />
        <KpiCard label="Vaults"         value={fmtNumber(kpis.vaultCount)}     accent="chart-4" />
        <KpiCard label="Curators"       value={fmtNumber(kpis.curatorCount)}   accent="chart-5" />
        <KpiCard label="Chains Live On" value={fmtNumber(kpis.chainsLiveCount)} accent="chart-6" />
      </div>

      <p className="text-small text-text-muted">
        Headline chart →{' '}
        <a href="/chains" className="text-accent hover:text-accent-secondary">/chains</a>
      </p>

      <PageProvenance
        pageTitle="Sector Overview"
        pageUrl="/"
        fetchedAt={kpis.asOfDate ?? new Date().toISOString()}
        source="Morpho Blue GraphQL + DefiLlama TVL"
      />
    </div>
  );
}

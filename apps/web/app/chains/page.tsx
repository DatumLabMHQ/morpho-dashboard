import { ChainsLoanbookClient } from '@/components/chains/chains-loanbook-client';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import {
  getActiveLoanByChainSeries,
  getChainEconomicsMatrix,
  getChainsHeadlineKpis,
  getChainsTableExpanded,
  getCuratorChainMatrix,
  getLoanbookAsOf,
  getStructuralIdentityMatrix,
} from '@/lib/queries/chains';

// Outer revalidate matches the unstable_cache TTL in the queries.
export const revalidate = 900;

export default async function ChainsPage() {
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="DATABASE_URL not set"
        message="Local: apps/web/.env.local. Prod: Vercel env."
      />
    );
  }

  const [asOfDate, kpis, series, structural, economics, curatorMatrix, table] = await Promise.all([
    getLoanbookAsOf(),
    getChainsHeadlineKpis(),
    getActiveLoanByChainSeries('ACTIVE_LOANS', 730),
    getStructuralIdentityMatrix(),
    getChainEconomicsMatrix(),
    getCuratorChainMatrix(10, 8),
    getChainsTableExpanded(),
  ]);

  if (economics.length === 0) {
    return (
      <EmptyState
        title="No chains with active loans yet"
        message="Either the market-state sync hasn't run or no chain has live Morpho borrowing."
      />
    );
  }

  return (
    <div className="space-y-5">
      <ChainsLoanbookClient
        asOfDate={asOfDate}
        kpis={kpis}
        series={series}
        structural={structural}
        economics={economics}
        curatorMatrix={curatorMatrix}
        table={table}
      />
      <PageProvenance
        pageTitle="Chains. Loan book"
        pageUrl="/chains"
        fetchedAt={new Date().toISOString()}
        source="Morpho GraphQL market/vault state + DefiLlama per-chain TVL"
      />
    </div>
  );
}

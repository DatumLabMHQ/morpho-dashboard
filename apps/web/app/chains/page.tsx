import { ChainsPageClient } from '@/components/chains/chains-page-client';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import { getChainsPagePayload } from '@/lib/queries/chains';

// Outer revalidate matches the unstable_cache TTL in the query.
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

  const payload = await getChainsPagePayload();

  if (payload.chains.length === 0) {
    return (
      <EmptyState
        title="No eligible chains yet"
        message="Morpho needs ≥$50M TVL on a chain at some point for it to appear here. Either the sync hasn't run yet or no chain meets the threshold."
      />
    );
  }

  return (
    <div className="space-y-5">
      <ChainsPageClient payload={payload} />
      <PageProvenance
        pageTitle="Chain directory"
        pageUrl="/chains"
        fetchedAt={new Date().toISOString()}
        source="DefiLlama /protocol/morpho-blue chainTvls + Morpho GraphQL chain registry"
        methodology={{
          text: "Each row is a chain Morpho has live markets on. TVL per chain is morpho-blue's chainTvls value from DefiLlama's protocol detail endpoint. Lending share is Morpho's TVL on that chain divided by the total of every protocol DefiLlama categorizes as 'Lending' or 'CDP' on that chain. The 12-month-ago anchor on each chain card is the same TVL series from 365 days before today's snapshot.",
          source: 'morpho_.chain_lending_tvl_daily · morpho_.protocol_tvl_daily',
        }}
      />
    </div>
  );
}

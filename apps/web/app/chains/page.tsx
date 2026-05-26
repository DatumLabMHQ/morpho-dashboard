import { ChainsPageClient } from '@/components/chains/chains-page-client';
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

  return <ChainsPageClient payload={payload} />;
}

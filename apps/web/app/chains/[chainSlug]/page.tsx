import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChainDetailClient } from '@/components/chains/chain-detail-client';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import {
  getChainAssetMix,
  getChainCuratorPresence,
  getChainHeader,
  getChainKpis,
  getChainTopMarkets,
  getChainTopVaults,
  getChainTvlAndShareSeries,
  getTopProtocolsOnChain,
} from '@/lib/queries/chain-detail';

interface Props {
  params: Promise<{ chainSlug: string }>;
}

export const revalidate = 900;

export default async function ChainDetailPage({ params }: Props) {
  const { chainSlug } = await params;
  const slug = decodeURIComponent(chainSlug);

  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }

  const header = await getChainHeader(slug);
  if (!header) notFound();

  const [kpis, series, competitors, markets, vaults, curators, assetMix] = await Promise.all([
    getChainKpis(header.chainSlug),
    getChainTvlAndShareSeries(header.chainSlug),
    getTopProtocolsOnChain(header.chainSlug, 5),
    getChainTopMarkets(header.chainSlug, 10),
    getChainTopVaults(header.chainSlug, 10),
    getChainCuratorPresence(header.chainSlug),
    getChainAssetMix(header.chainSlug),
  ]);

  if (!kpis) notFound();

  return (
    <div className="space-y-6">
      <Link href="/chains" className="inline-block text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary">
        ← Chains
      </Link>
      <ChainDetailClient
        header={header}
        kpis={kpis}
        series={series}
        competitors={competitors}
        markets={markets}
        vaults={vaults}
        curators={curators}
        assetMix={assetMix}
      />
    </div>
  );
}

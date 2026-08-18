import { AssetsBalanceSheetClient } from '@/components/assets/assets-balancesheet-client';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import {
  getAssetClassCompositionSeries,
  getAssetClassEconomicsHeatmap,
  getAssetVelocityScatter,
  getAssetsHeaderStats,
  getAssetsHeadlineKpis,
  getAssetsKpis,
  getCollateralDeepDive,
  getPerChainAssetMixMatrix,
  getStablecoinDeepDive,
  getUncategorizedAssets,
} from '@/lib/queries/assets';

export const revalidate = 900;

export default async function AssetsPage() {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  const [header, kpiTotals, kpis, composition, classEcon, stablecoin, collateral, velocity, perChain, uncategorized] = await Promise.all([
    getAssetsHeaderStats(),
    getAssetsKpis(),
    getAssetsHeadlineKpis(),
    getAssetClassCompositionSeries(365),
    getAssetClassEconomicsHeatmap(),
    getStablecoinDeepDive(),
    getCollateralDeepDive(20),
    getAssetVelocityScatter(),
    getPerChainAssetMixMatrix(8),
    getUncategorizedAssets(10_000_000),
  ]);

  if (header.marketCount === 0) {
    return <EmptyState title="No markets yet" message="The Morpho market sync hasn't run." />;
  }

  return (
    <div className="space-y-5">
      <AssetsBalanceSheetClient
        header={header}
        totalSupply={kpiTotals.totalSupplyUsd}
        totalCollateral={kpiTotals.totalCollateralUsd}
        kpis={kpis}
        composition={composition}
        classEcon={classEcon}
        stablecoin={stablecoin}
        collateral={collateral}
        velocity={velocity}
        perChain={perChain}
        uncategorized={uncategorized}
      />
      <PageProvenance
        pageTitle="Assets. Balance sheet"
        pageUrl="/assets"
        fetchedAt={new Date().toISOString()}
        source="Morpho GraphQL · market_state_daily × markets"
        methodology={{
          text: "Assets analyzed on both sides of Morpho's balance sheet. Loan-asset (supply) side: Total Supply, Borrow Interest Generated (Σ borrow × LEAST(borrow_apy,1.0)), Net Lender Yield. Collateral side: Total Collateral, # markets, weighted LLTV. APYs clamped at 100% and degenerate-IRM markets (APY>100%) excluded. Asset class inferred from symbol.",
          source: 'morpho_.market_state_daily × morpho_.markets',
        }}
      />
    </div>
  );
}

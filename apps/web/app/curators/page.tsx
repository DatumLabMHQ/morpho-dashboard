import { CuratorsAssetMgrClient } from '@/components/curators/curators-assetmgr-client';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { hasDatabaseUrl } from '@/lib/db';
import {
  getConcentrationStats,
  getCuratorAumByCuratorSeries,
  getCuratorDirectoryHeader,
  getCuratorEconomics,
  getCuratorPerformanceScatter,
  getCuratorReachMatrix,
  getCuratorShareStack,
  getCuratorStructuralIdentityMatrix,
  getCuratorTableWithBorrowInterest,
  getCuratorsHeadlineKpis,
} from '@/lib/queries/curators';

export const revalidate = 900;

export default async function CuratorsDirectoryPage() {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  const [header, concentration, kpis, series, economics, structural, scatter, table, allBar, ethBar, reach] = await Promise.all([
    getCuratorDirectoryHeader(),
    getConcentrationStats(),
    getCuratorsHeadlineKpis(),
    getCuratorAumByCuratorSeries('AUM', 365),
    getCuratorEconomics(),
    getCuratorStructuralIdentityMatrix(15),
    getCuratorPerformanceScatter(),
    getCuratorTableWithBorrowInterest(),
    getCuratorShareStack('all'),
    getCuratorShareStack('ethereum'),
    getCuratorReachMatrix(10, 8),
  ]);

  if (economics.length === 0) {
    return <EmptyState title="No curators yet" message="The Morpho curators registry hasn't been synced. Trigger /sync/curators." />;
  }

  const totalAum = economics.reduce((s, e) => s + e.aum, 0);
  const totalBorrowInterest = economics.reduce((s, e) => s + e.borrowInterestCaptured, 0);
  const totalFees = economics.reduce((s, e) => s + e.curatorFees, 0);

  return (
    <div className="space-y-5">
      <CuratorsAssetMgrClient
        totalAum={totalAum}
        chainCount={header.chainCount}
        totalBorrowInterest={totalBorrowInterest}
        totalFees={totalFees}
        concentration={concentration}
        kpis={kpis}
        series={series}
        economics={economics}
        structural={structural}
        scatter={scatter}
        allBar={allBar}
        ethBar={ethBar}
        reach={reach}
        table={table}
      />
      <PageProvenance
        pageTitle="Curators. Asset managers"
        pageUrl="/curators"
        fetchedAt={header.asOfDate ?? new Date().toISOString()}
        source="Morpho GraphQL · vault_state_daily × vaults.fee_recipient_address"
        methodology={{
          text: "Curators analyzed as asset managers. AUM = Σ vault TVL; Borrow Interest Captured = Σ TVL × pre-fee APY; Curator Fees = × performance fee; Fee Take Rate = fees ÷ borrow interest captured; Net APY Delivered = AUM-weighted net_apy. APYs clamped at 100% and vaults reporting >100% APY are excluded (degenerate-IRM). The Curator Fees time series begins where per-vault fee capture becomes reliable; the source serves only the current fee, not a fee history.",
          source: 'morpho_.vaults × morpho_.curators × morpho_.vault_state_daily',
        }}
      />
    </div>
  );
}

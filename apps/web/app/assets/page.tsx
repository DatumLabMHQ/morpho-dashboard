import { ChainAssetMix } from '@/components/chains/chain-asset-mix';
import { ChartFrame } from '@/components/chains/chart-frame';
import { ChainMixHeatmap } from '@/components/assets/chain-mix-heatmap';
import { ClassShareChart } from '@/components/assets/class-share-chart';
import { StablecoinBars } from '@/components/assets/stablecoin-bars';
import { TopCollateralTable } from '@/components/assets/top-collateral-table';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  getAssetClassShareOverTime,
  getAssetsHeaderStats,
  getAssetsKpis,
  getChainAssetMixMatrix,
  getCollateralByAssetClass,
  getStablecoinBreakdown,
  getSupplyByAssetClass,
  getTopCollateralAssets,
  getUncategorizedAssets,
} from '@/lib/queries/assets';

export const revalidate = 900;

const fmtDeltaPct = (cur: number, prior: number | null): string => {
  if (prior == null || prior === 0) return '—';
  const p = (cur - prior) / prior;
  return `${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}%`;
};

const findShare = (slices: { category: string; usd: number }[], cat: string): number => {
  const total = slices.reduce((s, x) => s + x.usd, 0);
  const v = slices.find((s) => s.category === cat)?.usd ?? 0;
  return total > 0 ? v / total : 0;
};

export default async function AssetsPage() {
  if (!hasDatabaseUrl()) {
    return (
      <EmptyState
        title="Database not configured"
        message="Local: apps/web/.env.local. Production: Vercel env."
      />
    );
  }

  const [header, kpis, supplyMix, collateralMix, stables, topCollateral, classShare, chainMix, uncat] =
    await Promise.all([
      getAssetsHeaderStats(),
      getAssetsKpis(),
      getSupplyByAssetClass(),
      getCollateralByAssetClass(),
      getStablecoinBreakdown(),
      getTopCollateralAssets(20),
      getAssetClassShareOverTime(365),
      getChainAssetMixMatrix(8),
      getUncategorizedAssets(10_000_000),
    ]);

  if (!header.marketCount) {
    return (
      <EmptyState title="No markets yet" message="Trigger /sync/markets to populate." />
    );
  }

  // Donut callout
  const supplyStable = findShare(supplyMix, 'stablecoin');
  const supplyLst = findShare(supplyMix, 'lst');
  const colBtc = findShare(collateralMix, 'btc');
  const colEth = findShare(collateralMix, 'eth');
  const colLstSum = findShare(collateralMix, 'lst');
  const colLrt = findShare(collateralMix, 'lrt');

  const donutCallout = `Supply is ${(supplyStable * 100).toFixed(0)}% stablecoin / ${(supplyLst * 100).toFixed(0)}% LST. ` +
    `Collateral is ${(colBtc * 100).toFixed(0)}% BTC variants / ${((colEth + colLstSum) * 100).toFixed(0)}% ETH and LSTs / ${(colLrt * 100).toFixed(0)}% LRTs.`;

  // Class-share-over-time chart subtitle — old vs current for stablecoin + LST
  const first = classShare[0];
  const last = classShare[classShare.length - 1];
  const stableOld = Number(first?.stablecoin ?? 0);
  const stableNew = Number(last?.stablecoin ?? 0);
  const lstOld = Number(first?.lst ?? 0);
  const lstNew = Number(last?.lst ?? 0);
  const lstDir = lstNew >= lstOld ? 'climbed' : 'fell';
  const classChartSubtitle =
    first && last
      ? `Stablecoin share moved from ${(stableOld * 100).toFixed(0)}% to ${(stableNew * 100).toFixed(0)}%. ` +
        `LST share ${lstDir}: ${(lstOld * 100).toFixed(0)}% → ${(lstNew * 100).toFixed(0)}%.`
      : undefined;

  // CSV builders (pre-computed server-side)
  const csvSupplyMix = ['category,usd,top_symbol,top_usd', ...supplyMix.map((s) => `${s.category},${s.usd},${s.topSymbol ?? ''},${s.topSymbolUsd}`)].join('\n');
  const csvCollateralMix = ['category,usd,top_symbol,top_usd', ...collateralMix.map((s) => `${s.category},${s.usd},${s.topSymbol ?? ''},${s.topSymbolUsd}`)].join('\n');
  const csvStables = ['symbol,supply_usd,is_ethena', ...stables.bars.map((b) => `${b.symbol},${b.supplyUsd},${b.isEthena}`)].join('\n');
  const csvClassShareCols = ['date', 'stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];
  const csvClassShare = [
    csvClassShareCols.join(','),
    ...classShare.map((p) => csvClassShareCols.map((c) => (p[c] == null ? '' : p[c])).join(',')),
  ].join('\n');
  const csvChainMixCols = ['chain', 'total_usd', ...chainMix.categories];
  const csvChainMix = [
    csvChainMixCols.join(','),
    ...chainMix.chains.map((ch) => {
      const cells = chainMix.cells.filter((c) => c.chainSlug === ch.slug);
      return [
        ch.slug,
        ch.totalUsd,
        ...chainMix.categories.map((cat) => cells.find((c) => c.category === cat)?.supplyUsd ?? 0),
      ].join(',');
    }),
  ].join('\n');

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Assets
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          {fmtNumber(header.loanAssetCount)} loan assets, {fmtNumber(header.collateralAssetCount)} collateral assets
          {' '}across {fmtNumber(header.marketCount)} markets and {fmtNumber(header.chainCount)} chains
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total Supply"
          value={fmtUsd(kpis.totalSupplyUsd, { compact: true })}
          subtext={`30d ${fmtDeltaPct(kpis.totalSupplyUsd, kpis.totalSupply30dAgo)}`}
          accent="chart-1"
        />
        <KpiCard
          label="Total Collateral"
          value={fmtUsd(kpis.totalCollateralUsd, { compact: true })}
          subtext={`30d ${fmtDeltaPct(kpis.totalCollateralUsd, kpis.totalCollateral30dAgo)}`}
          accent="chart-2"
        />
        <KpiCard
          label="Total Borrow"
          value={fmtUsd(kpis.totalBorrowUsd, { compact: true })}
          subtext={`30d ${fmtDeltaPct(kpis.totalBorrowUsd, kpis.totalBorrow30dAgo)}`}
          accent="chart-4"
        />
        <KpiCard
          label="Largest Supply Asset"
          value={kpis.largestSupplySymbol ?? '—'}
          subtext={fmtUsd(kpis.largestSupplyUsd, { compact: true })}
          accent="chart-5"
        />
        <KpiCard
          label="Largest Collateral"
          value={kpis.largestCollateralSymbol ?? '—'}
          subtext={fmtUsd(kpis.largestCollateralUsd, { compact: true })}
          accent="chart-6"
        />
      </div>

      {/* 3. DONUT PAIR + CALLOUT */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-small uppercase tracking-header-wide text-text-muted">
          Composition — Supply vs Collateral
        </h2>
        <p className="mb-5 text-body text-text-secondary">{donutCallout}</p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-3 text-tiny uppercase tracking-header-medium text-text-muted">Supply side</h3>
            <ChainAssetMix
              data={supplyMix.map((s) => ({
                category: s.category,
                supplyUsd: s.usd,
                topSymbol: s.topSymbol,
                topSymbolUsd: s.topSymbolUsd,
              }))}
            />
          </div>
          <div>
            <h3 className="mb-3 text-tiny uppercase tracking-header-medium text-text-muted">Collateral side</h3>
            <ChainAssetMix
              data={collateralMix.map((s) => ({
                category: s.category,
                supplyUsd: s.usd,
                topSymbol: s.topSymbol,
                topSymbolUsd: s.topSymbolUsd,
              }))}
            />
          </div>
        </div>
      </section>

      {/* 4. STABLECOIN BREAKDOWN */}
      <ChartFrame
        title="Stablecoin Breakdown — Supply by Symbol"
        subtitle={
          stables.ethenaCombinedUsd >= 1_000_000_000
            ? `Ethena (USDe + sUSDe + USDtb): ${fmtUsd(stables.ethenaCombinedUsd, { compact: true })} = ${(stables.ethenaSharePct * 100).toFixed(1)}% of Morpho stablecoin supply.`
            : `Ethena (USDe + sUSDe + USDtb): ${fmtUsd(stables.ethenaCombinedUsd, { compact: true })} (${(stables.ethenaSharePct * 100).toFixed(1)}% of stablecoin supply).`
        }
        csvFilename="stablecoins.csv"
        csvContent={csvStables}
      >
        <StablecoinBars bars={stables.bars} />
      </ChartFrame>

      {/* 5. TOP COLLATERAL TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Top Collateral Assets — by USD Collateralizing Borrows
        </h2>
        <TopCollateralTable rows={topCollateral} />
      </section>

      {/* 6. ASSET-CLASS GROWTH RACE */}
      <ChartFrame
        title="Asset Class Share of Morpho Supply — Last 12 Months"
        subtitle={classChartSubtitle}
        csvFilename="asset-class-share.csv"
        csvContent={csvClassShare}
      >
        <ClassShareChart data={classShare} />
      </ChartFrame>

      {/* 7. PER-CHAIN ASSET MIX HEATMAP */}
      <ChartFrame
        title="Per-Chain Collateral Mix"
        subtitle={
          chainMix.identityLines.length > 0
            ? chainMix.identityLines.slice(0, 3).map((l) => l.line).join(' · ')
            : 'Each row shaded by its own max — read across to see each chain\'s structural identity.'
        }
        csvFilename="chain-asset-mix.csv"
        csvContent={csvChainMix}
      >
        <ChainMixHeatmap data={chainMix} />
      </ChartFrame>

      {/* 8. UNCATEGORIZED — only render if there's anything */}
      {uncat.length > 0 && (
        <section className="rounded-lg border border-dashed border-border-bright bg-surface/40 p-5">
          <h2 className="mb-2 text-small uppercase tracking-header-wide text-accent-yellow">
            Uncategorized Assets · &gt; $10M
          </h2>
          <p className="mb-3 text-tiny uppercase tracking-header-medium text-text-muted">
            Symbols not matched by the inline classifier · add to the CASE in lib/queries/assets.ts
          </p>
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted">Symbol</th>
                <th className="pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted">Side</th>
                <th className="pb-2 text-right text-tiny font-normal uppercase tracking-header-medium text-text-muted">USD</th>
                <th className="pb-2 text-right text-tiny font-normal uppercase tracking-header-medium text-text-muted">Markets</th>
              </tr>
            </thead>
            <tbody>
              {uncat.map((u) => (
                <tr key={`${u.symbol}-${u.side}`} className="border-b border-border last:border-0">
                  <td className="py-2 text-text-primary uppercase tracking-header-medium">{u.symbol}</td>
                  <td className="py-2 text-text-secondary uppercase tracking-header-medium">{u.side}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{fmtUsd(u.totalUsd, { compact: true })}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{u.marketCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-tiny uppercase tracking-header-medium text-text-muted">
        Composition derived from morpho_.markets × morpho_.market_state_daily latest snapshot per market ·
        vault_allocations_daily not yet backfilled
      </p>
    </div>
  );
}

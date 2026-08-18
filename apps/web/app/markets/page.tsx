import { ChartFrame } from '@/components/chains/chart-frame';
import { BubbleScatter, type BubblePoint } from '@/components/charts/bubble-scatter';
import { DistributionHistogram, type HistogramBar } from '@/components/charts/distribution-histogram';
import { HorizontalBar, type HBar } from '@/components/charts/horizontal-bar';
import { CopyRow, CopyToast } from '@/components/directory/copy-row-toast';
import { FilterBar, type ActiveFilter } from '@/components/directory/filter-bar';
import { FilterControls, type FilterControlSpec } from '@/components/directory/filter-controls';
import { Pagination } from '@/components/directory/pagination';
import { SortableHeader } from '@/components/directory/sortable-header';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL as ACL, type AssetClass } from '@/lib/assets/asset-class';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  PAGE_SIZE,
  getLltvHistogram,
  getMarketsDirectory,
  getMarketsFilterOptions,
  getMarketsKpis,
  getMarketsScatterData,
  getMarketsTopTenByActiveLoans,
  type MarketSortKey,
  type MarketsDirectoryFilters,
} from '@/lib/queries/markets';

export const revalidate = 900;

interface SP {
  chain?: string; loanAssetClass?: string; collateralAssetClass?: string; minSupply?: string;
  lltvRange?: string; utilRange?: string; search?: string; sort?: string; dir?: 'asc' | 'desc'; page?: string;
}
interface Props { searchParams: Promise<SP> }

const ASSET_CLASS_OPTIONS = [
  { value: 'stablecoin', label: 'Stable' }, { value: 'lst', label: 'LST' }, { value: 'lrt', label: 'LRT' },
  { value: 'btc', label: 'BTC' }, { value: 'eth', label: 'ETH' }, { value: 'rwa', label: 'RWA' }, { value: 'other', label: 'Other' },
] as const;
const ASSET_CLASS_LABEL: Record<string, string> = Object.fromEntries(ASSET_CLASS_OPTIONS.map((o) => [o.value, o.label]));

const parseList = (v: string | undefined): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);
const parseNum = (v: string | undefined): number | undefined => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const parseRange = (v: string | undefined): [number | null, number | null] | undefined => {
  if (!v) return undefined;
  const [lo, hi] = v.split('-');
  const loN = lo && !Number.isNaN(Number(lo)) ? Number(lo) : null;
  const hiN = hi && !Number.isNaN(Number(hi)) ? Number(hi) : null;
  if (loN == null && hiN == null) return undefined;
  return [loN, hiN];
};
const pct1 = (v: number | null): string => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null): string => (v == null ? 'N/A' : `${(v * 100).toFixed(2)}%`);

export default async function MarketsPage({ searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }
  const sp = await searchParams;

  const filters: MarketsDirectoryFilters = {
    chain: parseList(sp.chain), loanAssetClass: parseList(sp.loanAssetClass),
    collateralAssetClass: parseList(sp.collateralAssetClass), minSupply: parseNum(sp.minSupply),
    lltvRange: parseRange(sp.lltvRange), utilRange: parseRange(sp.utilRange), search: sp.search,
  };
  const sortKey = (sp.sort as MarketSortKey | undefined) ?? 'supply';
  const sortDir = sp.dir ?? 'desc';
  const page = Math.max(1, Number(sp.page ?? '1'));

  const [kpis, top, scatter, lltvHist, opts, directory] = await Promise.all([
    getMarketsKpis(),
    getMarketsTopTenByActiveLoans(),
    getMarketsScatterData(),
    getLltvHistogram(),
    getMarketsFilterOptions(),
    getMarketsDirectory(filters, { key: sortKey, dir: sortDir }, page),
  ]);

  const topBars: HBar[] = top.map((t) => ({
    label: `${t.label.length > 24 ? t.label.slice(0, 22) + '…' : t.label} · ${t.chainSlug ?? ''}`,
    value: t.activeLoans,
    color: ASSET_CLASS_COLOR[t.collateralClass as AssetClass] ?? ASSET_CLASS_COLOR.other,
    tooltipTitle: t.label,
    tooltipLines: [
      `Active loans ${fmtUsd(t.activeLoans, { compact: true })}`,
      `${t.chainName ?? t.chainSlug ?? ''}${t.utilization != null ? ` · ${(t.utilization * 100).toFixed(0)}% util` : ''}`,
    ],
  }));

  const scatterPoints: BubblePoint[] = scatter.map((p) => ({
    x: p.util * 100, y: p.borrowApy * 100, z: p.supplyUsd, cls: p.collateralClass, name: p.pair,
  }));

  const lltvBars: HistogramBar[] = lltvHist.map((b) => ({
    label: b.bucketLabel,
    height: b.supplyUsd,
    color: b.dominantClass ? ASSET_CLASS_COLOR[b.dominantClass as AssetClass] : undefined,
    tooltipLines: [
      `${fmtUsd(b.supplyUsd, { compact: true })} supply`,
      `${b.marketCount} markets`,
      b.dominantClass ? `Mostly ${ACL[b.dominantClass as AssetClass]}` : '',
    ].filter(Boolean),
  }));

  // Active-filter chips.
  const activeChips: ActiveFilter[] = [];
  for (const slug of filters.chain ?? []) activeChips.push({ key: 'chain', value: slug, label: `Chain: ${opts.chains.find((c) => c.value === slug)?.label ?? slug}` });
  for (const ac of filters.loanAssetClass ?? []) activeChips.push({ key: 'loanAssetClass', value: ac, label: `Loan: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  for (const ac of filters.collateralAssetClass ?? []) activeChips.push({ key: 'collateralAssetClass', value: ac, label: `Coll: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  if (filters.minSupply) activeChips.push({ key: 'minSupply', label: `Min supply: ${fmtUsd(filters.minSupply, { compact: true })}` });
  if (filters.lltvRange) activeChips.push({ key: 'lltvRange', label: `LLTV: ${filters.lltvRange[0] ?? '0'}%-${filters.lltvRange[1] ?? '100'}%` });
  if (filters.utilRange) activeChips.push({ key: 'utilRange', label: `Util: ${filters.utilRange[0] ?? '0'}%-${filters.utilRange[1] ?? '100'}%` });
  if (filters.search) activeChips.push({ key: 'search', label: `Search: "${filters.search}"` });

  const controlSpecs: FilterControlSpec[] = [
    { key: 'chain', label: 'Chain', type: 'multi', options: opts.chains },
    { key: 'loanAssetClass', label: 'Loan asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'collateralAssetClass', label: 'Collateral asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'minSupply', label: 'Min supply', type: 'number', placeholder: 'e.g. 10000000', suffix: 'USD' },
    { key: 'lltvRange', label: 'LLTV range', type: 'range', rangeMin: 0, rangeMax: 100, suffix: '%' },
    { key: 'utilRange', label: 'Utilization range', type: 'range', rangeMin: 0, rangeMax: 100, suffix: '%' },
    { key: 'search', label: 'Search', type: 'text', placeholder: 'asset symbols / unique key' },
  ];

  const csvDir = ['chain,loan,collateral,lltv,supply_usd,active_loans,utilization,supply_apy,borrow_apy,borrow_interest,age_days,unique_key',
    ...directory.rows.map((r) => [r.chainSlug ?? r.chainId, r.loanSymbol, r.collateralSymbol ?? '', r.lltv ?? '', r.supplyUsd, r.borrowUsd,
      r.utilization ?? '', r.supplyApy ?? '', r.borrowApy ?? '', r.borrowInterest, r.ageDays ?? '', r.uniqueKey].join(',')),
  ].join('\n');

  const baseSearchObj = new URLSearchParams();
  for (const [k, v] of Object.entries({ chain: sp.chain, loanAssetClass: sp.loanAssetClass, collateralAssetClass: sp.collateralAssetClass, minSupply: sp.minSupply, lltvRange: sp.lltvRange, utilRange: sp.utilRange, search: sp.search, sort: sp.sort, dir: sp.dir })) {
    if (v) baseSearchObj.set(k, v);
  }

  const sh = (key: MarketSortKey, label: string, align: 'left' | 'right' = 'left', def: 'asc' | 'desc' = 'desc') => (
    <SortableHeader sortKey={key} activeKey={sortKey} activeDir={sortDir} defaultDir={def} basePath="/markets" baseSearch={baseSearchObj} align={align}>{label}</SortableHeader>
  );

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">Markets</h1>
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-primary">{fmtNumber(kpis.activeMarketCount)}</span> active markets across{' '}
          <span className="text-text-primary">{fmtNumber(kpis.chainCount)}</span> chains ·{' '}
          <span className="text-text-primary">{fmtUsd(kpis.totalBorrowUsd, { compact: true })}</span> active loans ·{' '}
          <span className="text-text-primary">{fmtUsd(kpis.totalBorrowInterest, { compact: true })}</span> borrow interest annualized
        </p>
        <p className="mt-1 text-tiny uppercase tracking-header-medium text-text-muted">
          Markets as lending products · Source: Morpho GraphQL · market_state_daily · as of {kpis.asOfDate}
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Active Markets" value={fmtNumber(kpis.activeMarketCount)} subtext={`${kpis.launched30d} launched in last 30 days`} accent="chart-1" />
        <KpiCard label="Largest Market" value={fmtUsd(kpis.largestMarketActiveLoans, { compact: true })} subtext={`${kpis.largestMarketLabel ?? 'N/A'}${kpis.largestMarketChain ? ` · ${kpis.largestMarketChain}` : ''}`} accent="chart-2" />
        <KpiCard label="Median Utilization" value={pct1(kpis.medianUtilization)} subtext="supply-weighted" accent="chart-4" />
        <KpiCard label="Median LLTV" value={kpis.medianLltv == null ? 'N/A' : `${(kpis.medianLltv * 100).toFixed(0)}%`} subtext="supply-weighted" accent="chart-5" />
        <KpiCard label="Markets ≥ 90% Util" value={fmtNumber(kpis.at90Count)} subtext={`${fmtUsd(kpis.at90SupplyUsd, { compact: true })} combined supply`} accent="accent" />
        <KpiCard label="Markets w/ Bad Debt" value={fmtNumber(kpis.badDebtCount)} subtext={`${fmtUsd(kpis.badDebtTotalUsd, { compact: true })} combined exposure`} accent="negative" />
      </div>

      {/* 3. TOP 10 BY ACTIVE LOANS */}
      <ChartFrame
        title="Top 10 markets by active loans"
        subtitle="Bars colored by collateral asset class · hover for utilization."
        csvFilename="markets-top-ten.csv"
        csvContent={['market,chain,active_loans,utilization,collateral_class', ...top.map((t) => [t.label.replace(/,/g, ' '), t.chainSlug ?? '', t.activeLoans, t.utilization ?? '', t.collateralClass].join(','))].join('\n')}
      >
        <HorizontalBar data={topBars} height={300} />
      </ChartFrame>

      {/* 4. UTILIZATION × BORROW APY SCATTER */}
      <ChartFrame
        title="Utilization × borrow APY"
        subtitle="Each dot a market. Bubble size = supply USD, color = collateral asset class. APY clamped at 100% (degenerate IRMs excluded)."
        csvFilename="markets-scatter.csv"
        csvContent={['market,utilization,borrow_apy,supply_usd,collateral_class', ...scatter.map((p) => [p.pair.replace(/,/g, ' '), p.util, p.borrowApy, p.supplyUsd, p.collateralClass].join(','))].join('\n')}
      >
        <BubbleScatter
          points={scatterPoints}
          xLabel="Utilization" yLabel="Borrow APY" xMax={100} yMax={30}
          sizeCaption="bubble size = supply USD"
          quadrants={[
            { corner: 'tr', text: 'RUNNING HOT' },
            { corner: 'tl', text: 'OVERPRICED' },
            { corner: 'br', text: 'UNDERVALUED' },
            { corner: 'bl', text: 'IDLE' },
          ]}
        />
      </ChartFrame>

      {/* 5. LLTV DISTRIBUTION */}
      <ChartFrame
        title="LLTV distribution"
        subtitle="Supply-USD-weighted. Where Morpho's risk concentrates. Bars colored by the bracket's dominant collateral class."
        csvFilename="markets-lltv-hist.csv"
        csvContent={['bucket,market_count,supply_usd,dominant_class', ...lltvHist.map((b) => [b.bucketLabel, b.marketCount, b.supplyUsd, b.dominantClass ?? ''].join(','))].join('\n')}
      >
        <DistributionHistogram data={lltvBars} yFormat="usd" />
      </ChartFrame>

      {/* 6. FILTERABLE DIRECTORY */}
      <FilterControls specs={controlSpecs} />
      {activeChips.length > 0 && <FilterBar filters={activeChips} />}
      <ChartFrame
        title={`Market directory: ${fmtNumber(directory.totalRows)} ${directory.totalRows === 1 ? 'match' : 'matches'}`}
        subtitle="Click a header to sort, a row to copy its unique key. Supply/Borrow APY clamped at 100% (degenerate IRMs show &quot;N/A&quot;)."
        csvFilename={`markets-directory-page-${page}.csv`}
        csvContent={csvDir}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-tiny tabular-nums">
            <thead className="sticky top-0 z-10 bg-card-bg">
              <tr>
                {sh('chain', 'Chain', 'left', 'asc')}
                {sh('loan', 'Loan', 'left', 'asc')}
                {sh('collateral', 'Collateral', 'left', 'asc')}
                {sh('lltv', 'LLTV', 'right')}
                {sh('supply', 'Supply', 'right')}
                {sh('borrow', 'Active Loans', 'right')}
                {sh('utilization', 'Util', 'right')}
                {sh('supplyApy', 'Supply APY', 'right')}
                {sh('borrowApy', 'Borrow APY', 'right')}
                {sh('borrowInterest', 'Borrow Int.', 'right')}
                {sh('age', 'Age', 'right')}
              </tr>
            </thead>
            <tbody>
              {directory.rows.length === 0 ? (
                <tr><td colSpan={11} className="py-8 text-center text-small uppercase tracking-header-medium text-text-muted">No markets match these filters.</td></tr>
              ) : (
                directory.rows.map((r) => (
                  <CopyRow key={r.uniqueKey} copyId={r.uniqueKey}>
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.chainName ?? r.chainSlug ?? r.chainId}</td>
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-primary">{r.loanSymbol}</td>
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.collateralSymbol ?? <span className="text-text-muted">N/A</span>}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{r.lltv == null ? 'N/A' : `${(r.lltv * 100).toFixed(0)}%`}</td>
                    <td className="px-3 py-2 text-right text-text-primary">{fmtUsd(r.supplyUsd, { compact: true })}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{fmtUsd(r.borrowUsd, { compact: true })}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{pct1(r.utilization)}</td>
                    <td className="px-3 py-2 text-right text-positive">{pct2(r.supplyApy)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{pct2(r.borrowApy)}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{r.borrowInterest > 0 ? fmtUsd(r.borrowInterest, { compact: true }) : 'N/A'}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{r.ageDays == null ? 'N/A' : `${r.ageDays}d`}</td>
                  </CopyRow>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Pagination page={page} totalPages={directory.pageCount} totalRows={directory.totalRows} pageSize={PAGE_SIZE} basePath="/markets" baseSearch={baseSearchObj} />
        </div>
      </ChartFrame>

      {/* 7. METHODOLOGY */}
      <PageProvenance
        pageTitle="Market directory"
        pageUrl="/markets"
        fetchedAt={kpis.asOfDate ?? new Date().toISOString()}
        source="Morpho GraphQL · market_state_daily latest snapshot per market"
        methodology={{
          text: "Morpho markets are isolated lending positions: one loan asset, one collateral asset, one fixed LLTV, one IRM. Each market is independent. No shared liquidity, no cross-market contagion. Supply USD is what lenders have deposited; Active Loans is what borrowers have drawn. Utilization is loans ÷ supply. LLTV is the maximum loan-to-value at which a position can be opened without liquidation risk. Borrow interest = active loans × borrow APY (clamped at 100%).\nSupply/borrow APY ≥ 100% are saturated-utilization IRM blow-ups (BONDUSD/USR, K/USDC on Arbitrum, the HERMES family on Base). Those rows show \". \" and are excluded from weighted KPIs, the histogram and the scatter. Bad debt is Morpho's stored unrealized figure.",
          source: 'morpho_.markets × morpho_.market_state_daily latest day · saturation clamp = apy < 100%',
        }}
      />
      <CopyToast />
    </div>
  );
}

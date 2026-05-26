import { ChartFrame } from '@/components/chains/chart-frame';
import { FilterBar, type ActiveFilter } from '@/components/directory/filter-bar';
import { FilterControls, type FilterControlSpec } from '@/components/directory/filter-controls';
import { LltvHistogram } from '@/components/directory/lltv-histogram';
import { Pagination } from '@/components/directory/pagination';
import { SortableHeader } from '@/components/directory/sortable-header';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  PAGE_SIZE,
  getLltvHistogram,
  getMarketsDirectory,
  getMarketsFilterOptions,
  getMarketsKpis,
  type MarketSortKey,
  type MarketsDirectoryFilters,
} from '@/lib/queries/markets';

export const revalidate = 900;

interface SP {
  chain?: string;
  loanAssetClass?: string;
  collateralAssetClass?: string;
  minSupply?: string;
  lltvRange?: string;     // "lo-hi"
  utilRange?: string;     // "lo-hi"
  search?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: string;
}

interface Props { searchParams: Promise<SP> }

const ASSET_CLASS_OPTIONS = [
  { value: 'stablecoin', label: 'Stable' },
  { value: 'lst', label: 'LST' },
  { value: 'lrt', label: 'LRT' },
  { value: 'btc', label: 'BTC' },
  { value: 'eth', label: 'ETH' },
  { value: 'rwa', label: 'RWA' },
  { value: 'other', label: 'Other' },
] as const;

const ASSET_CLASS_LABEL: Record<string, string> = Object.fromEntries(
  ASSET_CLASS_OPTIONS.map((o) => [o.value, o.label]),
);

const parseList = (v: string | undefined): string[] | undefined =>
  v ? v.split(',').filter(Boolean) : undefined;
const parseNum = (v: string | undefined): number | undefined =>
  v && !Number.isNaN(Number(v)) ? Number(v) : undefined;
const parseRange = (v: string | undefined): [number | null, number | null] | undefined => {
  if (!v) return undefined;
  const [lo, hi] = v.split('-');
  const loN = lo && !Number.isNaN(Number(lo)) ? Number(lo) : null;
  const hiN = hi && !Number.isNaN(Number(hi)) ? Number(hi) : null;
  if (loN == null && hiN == null) return undefined;
  return [loN, hiN];
};

export default async function MarketsPage({ searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  const sp = await searchParams;

  const filters: MarketsDirectoryFilters = {
    chain: parseList(sp.chain),
    loanAssetClass: parseList(sp.loanAssetClass),
    collateralAssetClass: parseList(sp.collateralAssetClass),
    minSupply: parseNum(sp.minSupply),
    lltvRange: parseRange(sp.lltvRange),
    utilRange: parseRange(sp.utilRange),
    search: sp.search,
  };
  const sortKey = (sp.sort as MarketSortKey | undefined) ?? 'supply';
  const sortDir = sp.dir ?? 'desc';
  const page = Math.max(1, Number(sp.page ?? '1'));

  const [kpis, lltvHist, opts, directory] = await Promise.all([
    getMarketsKpis(),
    getLltvHistogram(),
    getMarketsFilterOptions(),
    getMarketsDirectory(filters, { key: sortKey, dir: sortDir }, page),
  ]);

  // Active-filter chips.
  const activeChips: ActiveFilter[] = [];
  for (const slug of filters.chain ?? []) {
    const label = opts.chains.find((c) => c.value === slug)?.label ?? slug;
    activeChips.push({ key: 'chain', value: slug, label: `Chain: ${label}` });
  }
  for (const ac of filters.loanAssetClass ?? []) {
    activeChips.push({ key: 'loanAssetClass', value: ac, label: `Loan: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  }
  for (const ac of filters.collateralAssetClass ?? []) {
    activeChips.push({ key: 'collateralAssetClass', value: ac, label: `Coll: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  }
  if (filters.minSupply) {
    activeChips.push({ key: 'minSupply', label: `Min supply: ${fmtUsd(filters.minSupply, { compact: true })}` });
  }
  if (filters.lltvRange) {
    const [lo, hi] = filters.lltvRange;
    activeChips.push({ key: 'lltvRange', label: `LLTV: ${lo ?? '0'}%–${hi ?? '100'}%` });
  }
  if (filters.utilRange) {
    const [lo, hi] = filters.utilRange;
    activeChips.push({ key: 'utilRange', label: `Util: ${lo ?? '0'}%–${hi ?? '100'}%` });
  }
  if (filters.search) {
    activeChips.push({ key: 'search', label: `Search: "${filters.search}"` });
  }

  const controlSpecs: FilterControlSpec[] = [
    { key: 'chain', label: 'Chain', type: 'multi', options: opts.chains },
    { key: 'loanAssetClass', label: 'Loan asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'collateralAssetClass', label: 'Collateral asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'minSupply', label: 'Min supply', type: 'number', placeholder: 'e.g. 10000000', suffix: 'USD' },
    { key: 'lltvRange', label: 'LLTV range', type: 'range', rangeMin: 0, rangeMax: 100, suffix: '%' },
    { key: 'utilRange', label: 'Utilization range', type: 'range', rangeMin: 0, rangeMax: 100, suffix: '%' },
    { key: 'search', label: 'Search', type: 'text', placeholder: 'pair / unique key' },
  ];

  const csvDir = ['chain,loan,collateral,lltv,supply_usd,borrow_usd,utilization,supply_apy,borrow_apy,age_days,unique_key',
    ...directory.rows.map((r) => [
      r.chainSlug ?? r.chainId,
      r.loanSymbol,
      r.collateralSymbol ?? '',
      r.lltv ?? '',
      r.supplyUsd,
      r.borrowUsd,
      r.utilization ?? '',
      r.supplyApy ?? '',
      r.borrowApy ?? '',
      r.ageDays ?? '',
      r.uniqueKey,
    ].join(',')),
  ].join('\n');

  const baseSearchObj = new URLSearchParams();
  if (sp.chain) baseSearchObj.set('chain', sp.chain);
  if (sp.loanAssetClass) baseSearchObj.set('loanAssetClass', sp.loanAssetClass);
  if (sp.collateralAssetClass) baseSearchObj.set('collateralAssetClass', sp.collateralAssetClass);
  if (sp.minSupply) baseSearchObj.set('minSupply', sp.minSupply);
  if (sp.lltvRange) baseSearchObj.set('lltvRange', sp.lltvRange);
  if (sp.utilRange) baseSearchObj.set('utilRange', sp.utilRange);
  if (sp.search) baseSearchObj.set('search', sp.search);
  if (sp.sort) baseSearchObj.set('sort', sp.sort);
  if (sp.dir) baseSearchObj.set('dir', sp.dir);

  // Auto-subtitle for LLTV histogram → identify the dominant band by supply USD.
  const topLltvBucket = lltvHist.length > 0
    ? lltvHist.reduce((m, b) => (b.supplyUsd > m.supplyUsd ? b : m))
    : null;
  const lltvSubtitle = topLltvBucket
    ? `Most supply USD sits in the ${topLltvBucket.bucketLabel} LLTV band (${topLltvBucket.marketCount} markets, ${fmtUsd(topLltvBucket.supplyUsd, { compact: true })}).`
    : undefined;

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Markets
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-primary">{fmtNumber(kpis.activeMarketCount)}</span> active markets across{' '}
          <span className="text-text-primary">{fmtNumber(kpis.chainCount)}</span> chains ·{' '}
          <span className="text-text-primary">{fmtUsd(kpis.totalSupplyUsd, { compact: true })}</span> supply
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Active markets"
          value={fmtNumber(kpis.activeMarketCount)}
          subtext={`across ${kpis.chainCount} chains`}
          accent="chart-1"
        />
        <KpiCard
          label="Total supply"
          value={fmtUsd(kpis.totalSupplyUsd, { compact: true })}
          accent="chart-2"
        />
        <KpiCard
          label="Total borrow"
          value={fmtUsd(kpis.totalBorrowUsd, { compact: true })}
          subtext={kpis.totalSupplyUsd > 0
            ? `${((kpis.totalBorrowUsd / kpis.totalSupplyUsd) * 100).toFixed(0)}% of supply`
            : undefined}
          accent="chart-4"
        />
        <KpiCard
          label="Median LLTV"
          value={kpis.medianLltv == null ? '—' : `${(kpis.medianLltv * 100).toFixed(0)}%`}
          accent="chart-5"
        />
        <KpiCard
          label="Weighted Utilization"
          value={kpis.weightedUtilization == null ? '—' : `${(kpis.weightedUtilization * 100).toFixed(1)}%`}
          subtext="weighted by supply USD"
          accent="chart-6"
        />
      </div>

      {/* 3. LLTV HISTOGRAM */}
      <ChartFrame
        title="LLTV distribution — supply-USD weighted"
        subtitle={lltvSubtitle}
        csvFilename="markets-lltv-hist.csv"
        csvContent={['bucket,min_pct,max_pct,market_count,supply_usd',
          ...lltvHist.map((b) => [b.bucketLabel, b.bucketLow, b.bucketHigh, b.marketCount, b.supplyUsd].join(','))
        ].join('\n')}
      >
        <LltvHistogram data={lltvHist} />
      </ChartFrame>

      {/* 4. FILTER CONTROLS */}
      <FilterControls specs={controlSpecs} />

      {/* 5. ACTIVE-FILTER CHIPS */}
      {activeChips.length > 0 && <FilterBar filters={activeChips} />}

      {/* 6. DIRECTORY TABLE */}
      <ChartFrame
        title={`Market directory — ${fmtNumber(directory.totalRows)} ${directory.totalRows === 1 ? 'match' : 'matches'}`}
        subtitle="Supply APY / Borrow APY columns are clamped at 100% — saturated-util markets with degenerate IRMs (BONDUSD, K/USDC, HERMES family) display as &quot;—&quot; rather than nonsense rates."
        csvFilename={`markets-directory-page-${page}.csv`}
        csvContent={csvDir}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-tiny tabular-nums">
            <thead>
              <tr>
                <SortableHeader sortKey="chain"      activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/markets" baseSearch={baseSearchObj}>Chain</SortableHeader>
                <SortableHeader sortKey="loan"       activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/markets" baseSearch={baseSearchObj}>Loan</SortableHeader>
                <SortableHeader sortKey="collateral" activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/markets" baseSearch={baseSearchObj}>Collateral</SortableHeader>
                <SortableHeader sortKey="lltv"       activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">LLTV</SortableHeader>
                <SortableHeader sortKey="supply"     activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Supply</SortableHeader>
                <SortableHeader sortKey="borrow"     activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Borrow</SortableHeader>
                <SortableHeader sortKey="utilization" activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Util</SortableHeader>
                <SortableHeader sortKey="supplyApy"  activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Supply APY</SortableHeader>
                <SortableHeader sortKey="borrowApy"  activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Borrow APY</SortableHeader>
                <SortableHeader sortKey="age"        activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/markets" baseSearch={baseSearchObj} align="right">Age</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {directory.rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-small uppercase tracking-header-medium text-text-muted">
                    No markets match these filters.
                  </td>
                </tr>
              ) : (
                directory.rows.map((r) => (
                  <tr key={r.uniqueKey} className="border-t border-border hover:bg-hover-overlay">
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.chainName ?? r.chainSlug ?? r.chainId}</td>
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-primary">{r.loanSymbol}</td>
                    <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.collateralSymbol ?? <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {r.lltv == null ? '—' : `${(r.lltv * 100).toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-text-primary">{fmtUsd(r.supplyUsd, { compact: true })}</td>
                    <td className="px-3 py-2 text-right text-text-secondary">{fmtUsd(r.borrowUsd, { compact: true })}</td>
                    <td className="px-3 py-2 text-right text-text-muted">
                      {r.utilization == null ? '—' : `${(r.utilization * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-positive">
                      {r.supplyApy == null ? '—' : `${(r.supplyApy * 100).toFixed(2)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-text-secondary">
                      {r.borrowApy == null ? '—' : `${(r.borrowApy * 100).toFixed(2)}%`}
                    </td>
                    <td className="px-3 py-2 text-right text-text-muted">
                      {r.ageDays == null ? '—' : `${r.ageDays}d`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={directory.pageCount}
            totalRows={directory.totalRows}
            pageSize={PAGE_SIZE}
            basePath="/markets"
            baseSearch={baseSearchObj}
          />
        </div>
      </ChartFrame>

      <p className="text-tiny uppercase tracking-header-medium text-text-muted">
        Supply / borrow APY clamped at 100% to drop saturated-utilization IRM blow-ups (BONDUSD/USR,
        K/USDC Arbitrum, HERMES/USDC family) — those rows still appear in the table but their APY columns
        show &quot;—&quot; rather than figures like 2980%.
      </p>
    </div>
  );
}

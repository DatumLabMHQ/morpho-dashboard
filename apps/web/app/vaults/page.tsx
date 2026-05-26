import { ChartFrame } from '@/components/chains/chart-frame';
import { PageProvenance } from '@/components/provenance';
import { FilterBar, type ActiveFilter } from '@/components/directory/filter-bar';
import { FilterControls, type FilterControlSpec } from '@/components/directory/filter-controls';
import { Pagination } from '@/components/directory/pagination';
import { SortableHeader } from '@/components/directory/sortable-header';
import { TopVaultsBar } from '@/components/directory/top-vaults-bar';
import { TvlHistogram } from '@/components/directory/tvl-histogram';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  PAGE_SIZE,
  getVaultsDirectory,
  getVaultsFilterOptions,
  getVaultsKpis,
  getVaultsTopTen,
  getVaultsTvlHistogram,
  type VaultSortKey,
  type VaultsDirectoryFilters,
} from '@/lib/queries/vaults';

export const revalidate = 900;

interface SP {
  chain?: string;
  assetClass?: string;
  curator?: string;
  minTvl?: string;
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

export default async function VaultsPage({ searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }

  const sp = await searchParams;

  const filters: VaultsDirectoryFilters = {
    chain: parseList(sp.chain),
    assetClass: parseList(sp.assetClass),
    curator: parseList(sp.curator),
    minTvl: parseNum(sp.minTvl),
    search: sp.search,
  };
  const sortKey = (sp.sort as VaultSortKey | undefined) ?? 'tvl';
  const sortDir = sp.dir ?? 'desc';
  const page = Math.max(1, Number(sp.page ?? '1'));

  const [kpis, top, tvlHist, opts, directory] = await Promise.all([
    getVaultsKpis(),
    getVaultsTopTen(),
    getVaultsTvlHistogram(),
    getVaultsFilterOptions(),
    getVaultsDirectory(filters, { key: sortKey, dir: sortDir }, page),
  ]);

  // Build active-filter chips for FilterBar.
  const activeChips: ActiveFilter[] = [];
  for (const slug of filters.chain ?? []) {
    const label = opts.chains.find((c) => c.value === slug)?.label ?? slug;
    activeChips.push({ key: 'chain', value: slug, label: `Chain: ${label}` });
  }
  for (const ac of filters.assetClass ?? []) {
    activeChips.push({ key: 'assetClass', value: ac, label: `Asset: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  }
  for (const cu of filters.curator ?? []) {
    const label = opts.curators.find((c) => c.value === cu)?.label ?? cu;
    activeChips.push({ key: 'curator', value: cu, label: `Curator: ${label}` });
  }
  if (filters.minTvl) {
    activeChips.push({ key: 'minTvl', label: `Min TVL: ${fmtUsd(filters.minTvl, { compact: true })}` });
  }
  if (filters.search) {
    activeChips.push({ key: 'search', label: `Search: "${filters.search}"` });
  }

  const controlSpecs: FilterControlSpec[] = [
    { key: 'chain', label: 'Chain', type: 'multi', options: opts.chains },
    { key: 'assetClass', label: 'Asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'curator', label: 'Curator', type: 'multi', options: opts.curators },
    { key: 'minTvl', label: 'Min TVL', type: 'number', placeholder: 'e.g. 10000000', suffix: 'USD' },
    { key: 'search', label: 'Search', type: 'text', placeholder: 'vault name / asset / address' },
  ];

  // CSV — current filtered+sorted page.
  const csvDir = ['chain,vault_name,curator,asset,tvl_usd,net_apy,fee_bps,tvl_30d_pct,utilization',
    ...directory.rows.map((r) => {
      const deltaPct = r.tvl30dAgoUsd && r.tvl30dAgoUsd > 0
        ? ((r.tvlUsd - r.tvl30dAgoUsd) / r.tvl30dAgoUsd).toFixed(4)
        : '';
      return [
        r.chainSlug ?? r.chainId,
        (r.name ?? r.symbol ?? '').replace(/,/g, ' '),
        r.curatorName ?? '',
        r.assetSymbol ?? '',
        r.tvlUsd,
        r.netApy ?? '',
        r.feeBps ?? '',
        deltaPct,
        r.utilization ?? '',
      ].join(',');
    }),
  ].join('\n');

  // basePath/baseSearch used by SortableHeader + Pagination.
  const baseSearchObj = new URLSearchParams();
  if (sp.chain) baseSearchObj.set('chain', sp.chain);
  if (sp.assetClass) baseSearchObj.set('assetClass', sp.assetClass);
  if (sp.curator) baseSearchObj.set('curator', sp.curator);
  if (sp.minTvl) baseSearchObj.set('minTvl', sp.minTvl);
  if (sp.search) baseSearchObj.set('search', sp.search);
  if (sp.sort) baseSearchObj.set('sort', sp.sort);
  if (sp.dir) baseSearchObj.set('dir', sp.dir);

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
          Vaults
        </h1>
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-primary">{fmtNumber(kpis.activeVaultCount)}</span> active vaults across{' '}
          <span className="text-text-primary">{fmtNumber(kpis.chainCount)}</span> chains ·{' '}
          <span className="text-text-primary">{fmtUsd(kpis.totalTvlUsd, { compact: true })}</span> TVL
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Total TVL"
          value={fmtUsd(kpis.totalTvlUsd, { compact: true })}
          subtext={`across ${kpis.chainCount} chains`}
          accent="chart-1"
        />
        <KpiCard
          label="Active vaults"
          value={fmtNumber(kpis.activeVaultCount)}
          accent="chart-2"
        />
        <KpiCard
          label="Median Net APY"
          value={kpis.weightedNetApy == null ? '—' : `${(kpis.weightedNetApy * 100).toFixed(2)}%`}
          subtext="weighted by TVL"
          accent="chart-4"
        />
        <KpiCard
          label="Top Vault TVL"
          value={fmtUsd(kpis.topVaultTvlUsd, { compact: true })}
          subtext={kpis.topVaultName ?? '—'}
          accent="chart-5"
        />
        <KpiCard
          label="Launched (30d)"
          value={fmtNumber(kpis.launched30d)}
          subtext="new vaults"
          accent="chart-6"
        />
      </div>

      {/* 3. CHART PAIR */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Top 10 vaults by TVL"
          csvFilename="vaults-top-ten.csv"
          csvContent={['vault,chain,tvl_usd,net_apy',
            ...top.map((t) => [t.name.replace(/,/g, ' '), t.chainSlug ?? '', t.tvlUsd, t.netApy ?? ''].join(','))
          ].join('\n')}
          methodologyKey="vaults-top-ten"
        >
          <TopVaultsBar data={top} />
        </ChartFrame>
        <ChartFrame
          title="Vault TVL distribution (log buckets)"
          subtitle="Reveals the long tail — most vaults sit below $25M; a handful exceed $1B."
          csvFilename="vaults-tvl-hist.csv"
          csvContent={['bucket,min_usd,max_usd,vault_count,total_usd',
            ...tvlHist.map((b) => [b.bucketLabel, b.bucketLow, b.bucketHigh ?? '', b.vaultCount, b.totalUsd].join(','))
          ].join('\n')}
          methodologyKey="vaults-tvl-distribution"
        >
          <TvlHistogram data={tvlHist} />
        </ChartFrame>
      </div>

      {/* 4. FILTER CONTROLS */}
      <FilterControls specs={controlSpecs} />

      {/* 5. ACTIVE-FILTER CHIPS */}
      {activeChips.length > 0 && <FilterBar filters={activeChips} />}

      {/* 6. DIRECTORY TABLE */}
      <ChartFrame
        title={`Vault directory — ${fmtNumber(directory.totalRows)} ${directory.totalRows === 1 ? 'match' : 'matches'}`}
        subtitle="Click any column header to sort. Default sort: TVL desc."
        csvFilename={`vaults-directory-page-${page}.csv`}
        csvContent={csvDir}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-tiny tabular-nums">
            <thead>
              <tr>
                <SortableHeader sortKey="chain"   activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/vaults" baseSearch={baseSearchObj}>Chain</SortableHeader>
                <SortableHeader sortKey="name"    activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/vaults" baseSearch={baseSearchObj}>Vault</SortableHeader>
                <SortableHeader sortKey="curator" activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/vaults" baseSearch={baseSearchObj}>Curator</SortableHeader>
                <SortableHeader sortKey="asset"   activeKey={sortKey} activeDir={sortDir} defaultDir="asc"  basePath="/vaults" baseSearch={baseSearchObj}>Asset</SortableHeader>
                <SortableHeader sortKey="tvl"     activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/vaults" baseSearch={baseSearchObj} align="right">TVL</SortableHeader>
                <SortableHeader sortKey="netApy"  activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/vaults" baseSearch={baseSearchObj} align="right">Net APY</SortableHeader>
                <SortableHeader sortKey="fee"     activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/vaults" baseSearch={baseSearchObj} align="right">Fee</SortableHeader>
                <SortableHeader sortKey="tvl30d"  activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/vaults" baseSearch={baseSearchObj} align="right">30d Δ</SortableHeader>
                <SortableHeader sortKey="utilization" activeKey={sortKey} activeDir={sortDir} defaultDir="desc" basePath="/vaults" baseSearch={baseSearchObj} align="right">Util</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {directory.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-small uppercase tracking-header-medium text-text-muted">
                    No vaults match these filters.
                  </td>
                </tr>
              ) : (
                directory.rows.map((r) => {
                  const deltaPct =
                    r.tvl30dAgoUsd != null && r.tvl30dAgoUsd > 0
                      ? (r.tvlUsd - r.tvl30dAgoUsd) / r.tvl30dAgoUsd
                      : null;
                  const deltaClass = deltaPct == null ? 'text-text-muted' : deltaPct >= 0 ? 'text-positive' : 'text-negative';
                  return (
                    <tr key={`${r.chainId}:${r.address}`} className="border-t border-border hover:bg-hover-overlay">
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.chainName ?? r.chainSlug ?? r.chainId}</td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-primary">
                        {r.name ?? <span className="text-text-muted">{r.symbol ?? r.address.slice(0, 10)}</span>}
                      </td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">
                        {r.curatorName ?? <span className="text-text-muted">unattributed</span>}
                      </td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.assetSymbol ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-text-primary">{fmtUsd(r.tvlUsd, { compact: true })}</td>
                      <td className={`px-3 py-2 text-right ${
                        r.netApy == null ? 'text-text-muted'
                        : r.netApy >= 0 ? 'text-positive' : 'text-negative'
                      }`}>
                        {r.netApy == null ? '—' : `${(r.netApy * 100).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2 text-right text-text-secondary">{r.feeBps == null ? '—' : `${(r.feeBps / 100).toFixed(1)}%`}</td>
                      <td className={`px-3 py-2 text-right ${deltaClass}`}>
                        {deltaPct == null ? '—' : `${deltaPct >= 0 ? '+' : ''}${(deltaPct * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2 text-right text-text-muted">
                        {r.utilization == null ? '—' : `${(r.utilization * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })
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
            basePath="/vaults"
            baseSearch={baseSearchObj}
          />
        </div>
      </ChartFrame>

      <PageProvenance
        pageTitle="Vault directory"
        pageUrl="/vaults"
        fetchedAt={kpis.asOfDate ?? new Date().toISOString()}
        source="Morpho Blue GraphQL · vault_state_daily latest snapshot per vault"
        methodology={{
          text: 'Vault TVL, net APY and fees come from the latest vault_state_daily row per vault. 30-day Δ TVL compares the latest snapshot to the same vault\'s row from ~30 days prior. Net APY is post-fee. "Launched (30d)" counts vaults with created_at within the last 30 days.\nUtilization column shows "—" until vault_allocations_daily backfills (currently empty) — vault-level utilization requires the per-market allocations dataset.\nA vault\'s reported net APY ≥ 100% is treated as a data artifact (the underlying market\'s IRM ran away at saturated utilization) and excluded from the weighted-APY KPI; the vault still appears in the table with "—" in its APY column.',
          source: 'morpho_.vaults × morpho_.vault_state_daily · curator attribution via vaults.curator_id',
        }}
      />
    </div>
  );
}

import { ChartFrame } from '@/components/chains/chart-frame';
import { BubbleScatter, type BubblePoint } from '@/components/charts/bubble-scatter';
import { DistributionHistogram, type HistogramBar } from '@/components/charts/distribution-histogram';
import { HorizontalBar, type HBar } from '@/components/charts/horizontal-bar';
import { CopyRow, CopyToast } from '@/components/directory/copy-row-toast';
import { FilterBar, type ActiveFilter } from '@/components/directory/filter-bar';
import { FilterControls, type FilterControlSpec } from '@/components/directory/filter-controls';
import { Pagination } from '@/components/directory/pagination';
import { SortableHeader } from '@/components/directory/sortable-header';
import { KpiCardMultiDelta, type KpiIconKey } from '@/components/overview/kpi-card-multi-delta';
import { PageProvenance } from '@/components/provenance';
import { EmptyState } from '@/components/ui/empty-state';
import { ASSET_CLASS_COLOR } from '@/lib/assets/asset-class';
import { tokens } from '@/lib/brand/tokens';
import { hasDatabaseUrl } from '@/lib/db';
import { fmtNumber, fmtUsd } from '@/lib/format';
import {
  PAGE_SIZE,
  getVaultPerformanceScatter,
  getVaultsAumDistributionMeta,
  getVaultsDirectory,
  getVaultsFilterOptions,
  getVaultsKpiCards,
  getVaultsKpis,
  getVaultsTopTen,
  getVaultsTvlHistogram,
  type VaultSortKey,
  type VaultsDirectoryFilters,
} from '@/lib/queries/vaults';

export const revalidate = 900;

interface SP {
  chain?: string; assetClass?: string; curator?: string; minTvl?: string;
  search?: string; sort?: string; dir?: 'asc' | 'desc'; page?: string;
}
interface Props { searchParams: Promise<SP> }

const ASSET_CLASS_OPTIONS = [
  { value: 'stablecoin', label: 'Stable' }, { value: 'lst', label: 'LST' },
  { value: 'lrt', label: 'LRT' }, { value: 'btc', label: 'BTC' },
  { value: 'eth', label: 'ETH' }, { value: 'rwa', label: 'RWA' }, { value: 'other', label: 'Other' },
] as const;
const ASSET_CLASS_LABEL: Record<string, string> = Object.fromEntries(ASSET_CLASS_OPTIONS.map((o) => [o.value, o.label]));

const parseList = (v: string | undefined): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);
const parseNum = (v: string | undefined): number | undefined => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const fmtPct2 = (v: number | null): string => (v == null ? 'N/A' : `${(v * 100).toFixed(2)}%`);

export default async function VaultsPage({ searchParams }: Props) {
  if (!hasDatabaseUrl()) {
    return <EmptyState title="Database not configured" message="Local: apps/web/.env.local. Production: Vercel env." />;
  }
  const sp = await searchParams;

  const filters: VaultsDirectoryFilters = {
    chain: parseList(sp.chain), assetClass: parseList(sp.assetClass),
    curator: parseList(sp.curator), minTvl: parseNum(sp.minTvl), search: sp.search,
  };
  const sortKey = (sp.sort as VaultSortKey | undefined) ?? 'tvl';
  const sortDir = sp.dir ?? 'desc';
  const page = Math.max(1, Number(sp.page ?? '1'));

  const [kpis, cards, top, scatter, tvlHist, aumMeta, opts, directory] = await Promise.all([
    getVaultsKpis(),
    getVaultsKpiCards(),
    getVaultsTopTen(),
    getVaultPerformanceScatter(),
    getVaultsTvlHistogram(),
    getVaultsAumDistributionMeta(),
    getVaultsFilterOptions(),
    getVaultsDirectory(filters, { key: sortKey, dir: sortDir }, page),
  ]);

  // Chain → palette color for the top-10 bars.
  const chainColor: Record<string, string> = {};
  let ci = 0;
  for (const t of top) {
    const slug = t.chainSlug ?? '?';
    if (!(slug in chainColor)) { chainColor[slug] = tokens.colors.chart[ci % tokens.colors.chart.length]!; ci++; }
  }
  const topBars: HBar[] = top.map((t) => ({
    label: `${t.name.length > 22 ? t.name.slice(0, 20) + '…' : t.name} · ${t.chainSlug ?? ''}`,
    value: t.tvlUsd,
    color: chainColor[t.chainSlug ?? '?'] ?? tokens.colors.accent,
    tooltipTitle: t.name,
    tooltipLines: [
      `AUM ${fmtUsd(t.tvlUsd, { compact: true })}${t.netApy != null ? ` · ${(t.netApy * 100).toFixed(2)}% net APY` : ''}`,
      `${t.chainSlug ?? ''}${t.curatorName ? ` · ${t.curatorName}` : ''}`,
    ],
  }));

  const scatterPoints: BubblePoint[] = scatter.map((p) => ({
    x: p.feeRate * 100, y: p.netApy * 100, z: p.aum, cls: p.assetClass, name: p.name, label: p.label,
  }));

  const aumBars: HistogramBar[] = tvlHist.map((b) => ({
    label: b.bucketLabel,
    height: b.vaultCount,
    tooltipLines: [`${b.vaultCount} vaults`, `${fmtUsd(b.totalUsd, { compact: true })} AUM`],
  }));

  // Active-filter chips.
  const activeChips: ActiveFilter[] = [];
  for (const slug of filters.chain ?? []) activeChips.push({ key: 'chain', value: slug, label: `Chain: ${opts.chains.find((c) => c.value === slug)?.label ?? slug}` });
  for (const ac of filters.assetClass ?? []) activeChips.push({ key: 'assetClass', value: ac, label: `Asset: ${ASSET_CLASS_LABEL[ac] ?? ac}` });
  for (const cu of filters.curator ?? []) activeChips.push({ key: 'curator', value: cu, label: `Curator: ${opts.curators.find((c) => c.value === cu)?.label ?? cu}` });
  if (filters.minTvl) activeChips.push({ key: 'minTvl', label: `Min AUM: ${fmtUsd(filters.minTvl, { compact: true })}` });
  if (filters.search) activeChips.push({ key: 'search', label: `Search: "${filters.search}"` });

  const controlSpecs: FilterControlSpec[] = [
    { key: 'chain', label: 'Chain', type: 'multi', options: opts.chains },
    { key: 'assetClass', label: 'Asset class', type: 'multi', options: [...ASSET_CLASS_OPTIONS] },
    { key: 'curator', label: 'Curator', type: 'multi', options: opts.curators },
    { key: 'minTvl', label: 'Min AUM', type: 'number', placeholder: 'e.g. 10000000', suffix: 'USD' },
    { key: 'search', label: 'Search', type: 'text', placeholder: 'vault name / symbol / address' },
  ];

  const csvDir = ['chain,vault_name,curator,asset,aum_usd,net_apy,fee_rate,fee_take_rate,borrow_interest_captured,aum_30d_pct,utilization',
    ...directory.rows.map((r) => {
      const d = r.tvl30dAgoUsd && r.tvl30dAgoUsd > 0 ? ((r.tvlUsd - r.tvl30dAgoUsd) / r.tvl30dAgoUsd).toFixed(4) : '';
      return [r.chainSlug ?? r.chainId, (r.name ?? r.symbol ?? '').replace(/,/g, ' '), r.curatorName ?? '', r.assetSymbol ?? '',
        r.tvlUsd, r.netApy ?? '', r.feeBps != null ? r.feeBps / 10000 : '', r.feeTakeRate ?? '', r.borrowInterestCaptured, d, r.utilization ?? ''].join(',');
    }),
  ].join('\n');

  const baseSearchObj = new URLSearchParams();
  for (const [k, v] of Object.entries({ chain: sp.chain, assetClass: sp.assetClass, curator: sp.curator, minTvl: sp.minTvl, search: sp.search, sort: sp.sort, dir: sp.dir })) {
    if (v) baseSearchObj.set(k, v);
  }

  const sh = (key: VaultSortKey, label: string, align: 'left' | 'right' = 'left', def: 'asc' | 'desc' = 'desc') => (
    <SortableHeader sortKey={key} activeKey={sortKey} activeDir={sortDir} defaultDir={def} basePath="/vaults" baseSearch={baseSearchObj} align={align}>{label}</SortableHeader>
  );

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">Vaults</h1>
        <p className="mt-2 text-body text-text-secondary">
          <span className="text-text-primary">{fmtNumber(kpis.activeVaultCount)}</span> active vaults across{' '}
          <span className="text-text-primary">{fmtNumber(kpis.chainCount)}</span> chains ·{' '}
          <span className="text-text-primary">{fmtUsd(kpis.totalTvlUsd, { compact: true })}</span> AUM ·{' '}
          <span className="text-text-primary">{fmtUsd(cards.curatorFees.value ?? 0, { compact: true })}</span> curator fees annualized ·{' '}
          <span className="text-text-primary">{fmtUsd(cards.totalBorrowInterestCaptured, { compact: true })}</span> borrow interest captured
        </p>
        <p className="mt-1 text-tiny uppercase tracking-header-medium text-text-muted">
          Vaults as asset managers · Source: Morpho GraphQL · vault_state_daily · as of {cards.asOfDate}
        </p>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {([
          ['Total AUM', cards.totalAum, 'positive', 'dollar'],
          ['Active Vaults', cards.activeVaults, 'accent-blue', 'wallet'],
          ['Median Net APY Delivered', cards.medianNetApy, 'accent', 'percent'],
          ['Total Curator Fees (Ann.)', cards.curatorFees, 'accent-secondary', 'dollar'],
          ['Largest Vault AUM', cards.largestVaultAum, 'chart-7', 'trending-up'],
        ] as [string, typeof cards.totalAum, string, KpiIconKey][]).map(([label, data, accent, icon]) => (
          <KpiCardMultiDelta key={label} label={label} data={data} accent={accent} icon={icon} />
        ))}
      </div>

      {/* 3. TOP 10 BY AUM */}
      <ChartFrame
        title="Top 10 vaults by AUM"
        subtitle="Bars colored by chain · hover for net APY delivered + curator."
        csvFilename="vaults-top-ten.csv"
        csvContent={['vault,chain,curator,aum_usd,net_apy', ...top.map((t) => [t.name.replace(/,/g, ' '), t.chainSlug ?? '', t.curatorName ?? '', t.tvlUsd, t.netApy ?? ''].join(','))].join('\n')}
      >
        <HorizontalBar data={topBars} height={300} />
      </ChartFrame>

      {/* 4. VAULT PERFORMANCE SCATTER */}
      <ChartFrame
        title="Vault performance landscape"
        subtitle="Fee rate vs net APY delivered. Bubble size = AUM, color = asset class. Each dot is one vault; the top 5 by AUM are the largest bubbles."
        csvFilename="vaults-performance-scatter.csv"
        csvContent={['vault,fee_rate,net_apy,aum,asset_class', ...scatter.map((p) => [p.name.replace(/,/g, ' '), p.feeRate, p.netApy, p.aum, p.assetClass].join(','))].join('\n')}
      >
        <BubbleScatter points={scatterPoints} xLabel="Fee Rate" yLabel="Net APY" xMax={30} yMax={15} sizeCaption="bubble size = AUM" />
      </ChartFrame>

      {/* 5. AUM DISTRIBUTION HISTOGRAM */}
      <ChartFrame
        title="Vault AUM distribution"
        subtitle={aumMeta.medianAumUsd != null
          ? `Median vault AUM ${fmtUsd(aumMeta.medianAumUsd, { compact: true })} · ${aumMeta.pctBelow10m != null ? `${(aumMeta.pctBelow10m * 100).toFixed(0)}% of vaults sit below $10M` : ''}. A long tail under a handful of mega-vaults.`
          : undefined}
        csvFilename="vaults-aum-distribution.csv"
        csvContent={['bucket,vault_count,total_usd', ...tvlHist.map((b) => [b.bucketLabel, b.vaultCount, b.totalUsd].join(','))].join('\n')}
      >
        <DistributionHistogram data={aumBars} />
      </ChartFrame>

      {/* 6. FILTERABLE DIRECTORY */}
      <FilterControls specs={controlSpecs} />
      {activeChips.length > 0 && <FilterBar filters={activeChips} />}
      <ChartFrame
        title={`Vault directory: ${fmtNumber(directory.totalRows)} ${directory.totalRows === 1 ? 'match' : 'matches'}`}
        subtitle="Click a header to sort, a row to copy its identifier (chain:address). Vaults with APY > 100% are dropped as non-economic."
        csvFilename={`vaults-directory-page-${page}.csv`}
        csvContent={csvDir}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-tiny tabular-nums">
            <thead className="sticky top-0 z-10 bg-card-bg">
              <tr>
                {sh('chain', 'Chain', 'left', 'asc')}
                {sh('name', 'Vault', 'left', 'asc')}
                {sh('curator', 'Curator', 'left', 'asc')}
                {sh('asset', 'Asset', 'left', 'asc')}
                {sh('tvl', 'AUM', 'right')}
                {sh('netApy', 'Net APY', 'right')}
                {sh('fee', 'Fee Rate', 'right')}
                {sh('feeTakeRate', 'Fee Take', 'right')}
                {sh('borrowInterest', 'Borrow Int.', 'right')}
                {sh('tvl30d', 'AUM 30d Δ', 'right')}
                {sh('utilization', 'Util', 'right')}
              </tr>
            </thead>
            <tbody>
              {directory.rows.length === 0 ? (
                <tr><td colSpan={11} className="py-8 text-center text-small uppercase tracking-header-medium text-text-muted">No vaults match these filters.</td></tr>
              ) : (
                directory.rows.map((r) => {
                  const deltaPct = r.tvl30dAgoUsd != null && r.tvl30dAgoUsd > 0 ? (r.tvlUsd - r.tvl30dAgoUsd) / r.tvl30dAgoUsd : null;
                  return (
                    <CopyRow key={`${r.chainId}:${r.address}`} copyId={`${r.chainId}:${r.address}`}>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.chainName ?? r.chainSlug ?? r.chainId}</td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-primary">{r.name ?? <span className="text-text-muted">{r.symbol ?? r.address.slice(0, 10)}</span>}</td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.curatorName ?? <span className="text-text-muted">unattributed</span>}</td>
                      <td className="px-3 py-2 uppercase tracking-header-medium text-text-secondary">{r.assetSymbol ?? 'N/A'}</td>
                      <td className="px-3 py-2 text-right text-text-primary">{fmtUsd(r.tvlUsd, { compact: true })}</td>
                      <td className={`px-3 py-2 text-right ${r.netApy == null ? 'text-text-muted' : r.netApy >= 0 ? 'text-positive' : 'text-negative'}`}>{fmtPct2(r.netApy)}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{r.feeBps == null ? 'N/A' : `${(r.feeBps / 100).toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{r.feeTakeRate == null ? 'N/A' : `${(r.feeTakeRate * 100).toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-right text-text-secondary">{r.borrowInterestCaptured > 0 ? fmtUsd(r.borrowInterestCaptured, { compact: true }) : 'N/A'}</td>
                      <td className={`px-3 py-2 text-right ${deltaPct == null ? 'text-text-muted' : deltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>{deltaPct == null ? 'N/A' : `${deltaPct >= 0 ? '+' : ''}${(deltaPct * 100).toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-right text-text-muted">{r.utilization == null ? 'N/A' : `${(r.utilization * 100).toFixed(1)}%`}</td>
                    </CopyRow>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <Pagination page={page} totalPages={directory.pageCount} totalRows={directory.totalRows} pageSize={PAGE_SIZE} basePath="/vaults" baseSearch={baseSearchObj} />
        </div>
      </ChartFrame>

      {/* 7. METHODOLOGY */}
      <PageProvenance
        pageTitle="Vault directory"
        pageUrl="/vaults"
        fetchedAt={cards.asOfDate ?? new Date().toISOString()}
        source="Morpho GraphQL · vault_state_daily latest snapshot per vault"
        methodology={{
          text: "Vaults are MetaMorpho's curated allocators. Depositors put capital into a vault, and the curator allocates across Morpho markets. AUM = total assets supplied to the vault. Net APY is after-fee yield delivered to depositors. Fee Rate is the curator's performance fee on yield. Fee Take Rate = curator fees ÷ borrow interest captured = the share of borrower-paid yield the curator retains (per-vault this reduces to the performance fee). Borrow interest captured = AUM × pre-fee APY.\nVaults reporting APY ≥ 100% are excluded from weighted aggregates as data artifacts (a saturated-utilization underlying market with a runaway IRM). The utilization column shows \". \" until vault_allocations_daily backfills.",
          source: 'morpho_.vaults × morpho_.vault_state_daily · curator attribution via vaults.curator_id',
        }}
      />
      <CopyToast />
    </div>
  );
}

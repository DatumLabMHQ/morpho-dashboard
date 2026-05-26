'use client';

import { format, parseISO } from 'date-fns';

import { ChainAssetMix } from './chain-asset-mix';
import { ChainCompetitorStackChart } from './chain-competitor-stack-chart';
import { ChainTvlShareChart } from './chain-tvl-share-chart';
import { ChartFrame } from './chart-frame';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtNumber, fmtUsd } from '@/lib/format';
import type {
  AssetMixSlice,
  ChainHeader,
  ChainKpis,
  CompetitorMeta,
  CompetitorPoint,
  CuratorRow,
  MarketRow,
  TvlSharePoint,
  VaultRow,
} from '@/lib/queries/chain-detail';

interface Props {
  header: ChainHeader;
  kpis: ChainKpis;
  series: TvlSharePoint[];
  competitors: { meta: CompetitorMeta[]; series: CompetitorPoint[] };
  markets: MarketRow[];
  vaults: VaultRow[];
  curators: CuratorRow[];
  assetMix: AssetMixSlice[];
}

const fmtMonths = (fromIso: string | null): string => {
  if (!fromIso) return '—';
  try {
    return format(parseISO(`${fromIso}-01`), 'MMM yyyy').toUpperCase();
  } catch {
    return fromIso;
  }
};

const fmtPct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);

const fmtDeltaPct = (current: number | null, prior: number | null): string => {
  if (current == null || prior == null || !Number.isFinite(prior) || prior === 0) return '—';
  const pct = (current - prior) / prior;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${(pct * 100).toFixed(1)}%`;
};

const fmtDeltaPp = (current: number | null, prior: number | null): string => {
  if (current == null || prior == null) return '—';
  const pp = (current - prior) * 100;
  const sign = pp >= 0 ? '+' : '';
  return `${sign}${pp.toFixed(1)} pp`;
};

export function ChainDetailClient(props: Props) {
  const {
    header, kpis, series, competitors, markets, vaults, curators, assetMix,
  } = props;

  const deltaTvlSign = kpis.morphoTvl30dAgoUsd != null
    ? (kpis.morphoTvlUsd >= kpis.morphoTvl30dAgoUsd ? 'pos' : 'neg')
    : null;
  const deltaShareSign = kpis.morphoShare30dAgoPct != null
    ? (kpis.morphoSharePct >= kpis.morphoShare30dAgoPct ? 'pos' : 'neg')
    : null;

  // Subtitle for the TVL+Share chart: auto-generated growth narrative.
  const firstNonNull = series.find((p) => p.morphoTvlUsd != null && p.morphoTvlUsd > 0);
  const last = series[series.length - 1];
  const tvlSubtitle =
    firstNonNull && last && firstNonNull.morphoTvlUsd != null && last.morphoTvlUsd != null
      ? (() => {
          const monthsBetween = Math.max(
            1,
            Math.round((Date.parse(last.date) - Date.parse(firstNonNull.date)) / (30 * 86400_000)),
          );
          const oldShare = firstNonNull.morphoSharePct;
          const newShare = last.morphoSharePct;
          return `Morpho TVL grew from ${fmtUsd(firstNonNull.morphoTvlUsd, { compact: true })} to ${fmtUsd(last.morphoTvlUsd, { compact: true })} in ${monthsBetween} months · share moved from ${fmtPct1(oldShare)} to ${fmtPct1(newShare)}`;
        })()
      : undefined;

  const csvOfSeries = () => {
    const head = 'date,morpho_tvl_usd,chain_lending_tvl_usd,morpho_share';
    const rows = series.map((p) =>
      [
        p.date,
        p.morphoTvlUsd ?? '',
        p.chainLendingTvlUsd ?? '',
        p.morphoSharePct ?? '',
      ].join(','),
    );
    return [head, ...rows].join('\n');
  };

  const csvOfCompetitors = () => {
    const cols = ['date', ...competitors.meta.map((m) => m.protocolSlug)];
    const head = cols.join(',');
    const rows = competitors.series.map((p) =>
      cols.map((c) => (p[c] == null ? '' : p[c])).join(','),
    );
    return [head, ...rows].join('\n');
  };

  const csvOfAssetMix = () => {
    const head = 'category,supply_usd,top_symbol,top_symbol_usd';
    const rows = assetMix.map((s) =>
      [s.category, s.supplyUsd, s.topSymbol ?? '', s.topSymbolUsd].join(','),
    );
    return [head, ...rows].join('\n');
  };

  const slug = header.chainSlug.toLowerCase();

  return (
    <div className="space-y-6">
      {/* 1. HEADER BLOCK */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">
            {header.chainName}
          </h1>
          <div className="mt-2 text-small uppercase tracking-header-wide text-text-muted">
            {header.networkLabel}
          </div>
        </div>
        <div className="text-right space-y-1">
          {header.morphoLiveSince && (
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">
              Live since <span className="text-text-secondary">{fmtMonths(header.morphoLiveSince)}</span>
            </div>
          )}
          {header.morphoRank != null && (
            <div className="text-body uppercase tracking-header-wide">
              <span className="text-accent">#{header.morphoRank}</span>
              <span className="text-text-muted"> of {header.totalProtocolsOnChain} lending protocols</span>
            </div>
          )}
        </div>
      </header>

      {/* 2. KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard
          label="Morpho TVL"
          value={fmtUsd(kpis.morphoTvlUsd, { compact: true })}
          subtext={deltaTvlSign ? `30d ${fmtDeltaPct(kpis.morphoTvlUsd, kpis.morphoTvl30dAgoUsd)}` : 'no 30d baseline'}
          accent="chart-1"
        />
        <KpiCard
          label="Morpho Share"
          value={fmtPct1(kpis.morphoSharePct)}
          subtext={deltaShareSign ? `30d ${fmtDeltaPp(kpis.morphoSharePct, kpis.morphoShare30dAgoPct)}` : 'no 30d baseline'}
          accent="chart-2"
        />
        <KpiCard label="Markets"  value={fmtNumber(kpis.marketCount)}  accent="chart-4" />
        <KpiCard label="Vaults"   value={fmtNumber(kpis.vaultCount)}   accent="chart-5" />
        <KpiCard label="Curators" value={fmtNumber(kpis.curatorCount)} accent="chart-6" />
      </div>

      {/* 3. DUAL-AXIS PRIMARY CHART */}
      <ChartFrame
        title={`Morpho TVL & Share — ${header.chainName}`}
        subtitle={tvlSubtitle}
        csvFilename={`morpho-tvl-share-${slug}.csv`}
        csvContent={csvOfSeries()}
      >
        <ChainTvlShareChart data={series} />
      </ChartFrame>

      {/* 4. COMPETITOR STACK */}
      <ChartFrame
        title={`Lending TVL on ${header.chainName} — Top ${competitors.meta.length} Protocols`}
        subtitle={
          competitors.meta.length > 0
            ? `Morpho highlighted · ${competitors.meta.filter((m) => !m.isMorpho).length} comparators in palette`
            : undefined
        }
        csvFilename={`lending-tvl-${slug}.csv`}
        csvContent={csvOfCompetitors()}
      >
        <ChainCompetitorStackChart data={competitors.series} meta={competitors.meta} />
      </ChartFrame>

      {/* 5. TOP MARKETS TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Top Markets on {header.chainName}
        </h2>
        {markets.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No markets yet</div>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Market</Th>
                <Th align="right">Supply USD</Th>
                <Th align="right">Borrow USD</Th>
                <Th align="right">Utilization</Th>
                <Th align="right">Supply APY</Th>
                <Th align="right">Borrow APY</Th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m) => {
                const lltvPct = m.lltvPct != null ? (m.lltvPct / 1e18) * 100 : null;
                return (
                  <tr key={m.uniqueKey} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                    <td className="py-2 text-text-primary">
                      <span className="uppercase tracking-header-medium">
                        {m.collateralSymbol ?? '—'} / {m.loanSymbol}
                      </span>
                      {lltvPct != null && (
                        <span className="ml-2 text-tiny text-text-muted">{lltvPct.toFixed(0)}% LLTV</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-primary">{fmtUsd(m.supplyUsd, { compact: true })}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{fmtUsd(m.borrowUsd, { compact: true })}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{m.utilization == null ? '—' : `${(m.utilization * 100).toFixed(1)}%`}</td>
                    <td className="py-2 text-right tabular-nums text-positive">{m.supplyApy == null ? '—' : `${(m.supplyApy * 100).toFixed(2)}%`}</td>
                    <td className="py-2 text-right tabular-nums text-accent">{m.borrowApy == null ? '—' : `${(m.borrowApy * 100).toFixed(2)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 6. TOP VAULTS TABLE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Top Vaults on {header.chainName}
        </h2>
        {vaults.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No vaults yet</div>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Name</Th>
                <Th>Curator</Th>
                <Th>Asset</Th>
                <Th align="right">TVL</Th>
                <Th align="right">Net APY</Th>
                <Th align="right">Fee</Th>
                <Th align="right">30d Δ TVL</Th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={`${v.chainId}:${v.address}`} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2 text-text-primary uppercase tracking-header-medium">{v.name ?? '—'}</td>
                  <td className="py-2 text-text-secondary">{v.curatorName ?? <span className="text-text-muted">unattributed</span>}</td>
                  <td className="py-2 text-text-secondary uppercase tracking-header-medium">{v.assetSymbol ?? '—'}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{fmtUsd(v.tvlUsd, { compact: true })}</td>
                  <td className="py-2 text-right tabular-nums text-positive">{v.netApy == null ? '—' : `${(v.netApy * 100).toFixed(2)}%`}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{v.feeBps == null ? '—' : `${(v.feeBps / 100).toFixed(1)}%`}</td>
                  <td className={`py-2 text-right tabular-nums ${
                    v.delta30dTvlUsd == null ? 'text-text-muted'
                    : v.delta30dTvlUsd >= 0 ? 'text-positive' : 'text-negative'
                  }`}>
                    {v.delta30dTvlUsd == null
                      ? '—'
                      : `${v.delta30dTvlUsd >= 0 ? '+' : ''}${fmtUsd(v.delta30dTvlUsd, { compact: true })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 7. CURATOR PRESENCE */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          Curator Presence on {header.chainName}
        </h2>
        {curators.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No curated vaults yet</div>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Curator</Th>
                <Th align="right">Vaults Here</Th>
                <Th align="right">TVL on Chain</Th>
                <Th align="right">Weighted Net APY</Th>
                <Th align="right">Global TVL</Th>
              </tr>
            </thead>
            <tbody>
              {curators.map((c) => (
                <tr key={c.curatorId} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2 text-text-primary uppercase tracking-header-medium">{c.curatorName ?? c.curatorId}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{c.vaultCount}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{fmtUsd(c.tvlOnChainUsd, { compact: true })}</td>
                  <td className="py-2 text-right tabular-nums text-positive">{c.weightedNetApy == null ? '—' : `${(c.weightedNetApy * 100).toFixed(2)}%`}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{fmtUsd(c.globalTvlUsd, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 8. ASSET MIX */}
      <ChartFrame
        title={`Asset Mix — Morpho Supply on ${header.chainName}`}
        csvFilename={`asset-mix-${slug}.csv`}
        csvContent={csvOfAssetMix()}
      >
        <ChainAssetMix data={assetMix} />
      </ChartFrame>

      <p className="text-tiny uppercase tracking-header-medium text-text-muted">
        As of {kpis.asOfDate} · DefiLlama lending + CDP categories
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </th>
  );
}

'use client';

import { format, parseISO } from 'date-fns';

import { ChainAssetMix } from './chain-asset-mix';
import { ChainCompetitorStackChart } from './chain-competitor-stack-chart';
import { ChainTvlShareChart } from './chain-tvl-share-chart';
import { ChartFrame } from './chart-frame';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtUsd } from '@/lib/format';
import type {
  ChainAssetMixResult, ChainHeader, ChainKpis,
  CompetitorMeta, CompetitorPoint, CuratorRow, InterestFlowAttribution,
  MarketRow, RateComparisonRow, TvlSharePoint, VaultRow,
} from '@/lib/queries/chain-detail';

interface Props {
  header: ChainHeader;
  kpis: ChainKpis;
  series: TvlSharePoint[];
  competitors: { meta: CompetitorMeta[]; series: CompetitorPoint[] };
  markets: MarketRow[];
  vaults: VaultRow[];
  curators: CuratorRow[];
  assetMix: ChainAssetMixResult;
  interestFlow: InterestFlowAttribution | null;
  rates: RateComparisonRow[];
}

const fmtMonths = (fromIso: string | null): string => {
  if (!fromIso) return 'N/A';
  try { return format(parseISO(`${fromIso}-01`), 'MMM yyyy').toUpperCase(); } catch { return fromIso; }
};
const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(2)}%`);
const bps = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${Math.round(v * 10000)} bps`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
// markets.lltv is stored as a fraction (0..1), so LLTV% = fraction * 100.
const lltvDisplayPct = (frac: number | null) => (frac == null ? null : frac * 100);
const monthYear = (iso: string | null | undefined) => {
  if (!iso) return 'N/A';
  try { return format(parseISO(iso), 'MMM yyyy'); } catch { return iso; }
};

export function ChainDetailClient(props: Props) {
  const { header, kpis, series, competitors, markets, vaults, curators, assetMix, interestFlow, rates } = props;

  // ----- Chart 1 subtitle (active loans + market share) -----
  const loanFirst = series.find((p) => p.activeLoansUsd != null && p.activeLoansUsd > 0);
  const loanLast = [...series].reverse().find((p) => p.activeLoansUsd != null);
  const share50 = series.find((p) => p.morphoSharePct != null && p.morphoSharePct >= 0.5);
  const shareLast = [...series].reverse().find((p) => p.morphoSharePct != null);
  // Subtitle spells out which is which: the loan figure is Morpho's own active
  // loans (left axis); the share figure is Morpho TVL divided by the chain's
  // total lending TVL (right axis), so neither metric is mistaken for the other.
  const cn = header.chainName;
  const loanSubtitle =
    loanFirst && loanLast && loanFirst.activeLoansUsd != null && loanLast.activeLoansUsd != null
      ? `Morpho's active loans on ${cn} grew from ${usdC(loanFirst.activeLoansUsd)} to ${usdC(loanLast.activeLoansUsd)}.` +
        (share50 && shareLast
          ? ` Morpho's share of ${cn} lending TVL (DefiLlama, lending + CDP) crossed 50% in ${monthYear(share50.date)} and reached ${pct1(shareLast.morphoSharePct)} by ${monthYear(shareLast.date)}.`
          : shareLast
            ? ` Morpho's share of ${cn} lending TVL (DefiLlama, lending + CDP) is ${pct1(shareLast.morphoSharePct)} as of ${monthYear(shareLast.date)}.`
            : '')
      : undefined;

  // ----- Chart 2 subtitle (top protocols by TVL) -----
  const compLast = competitors.series.length ? competitors.series[competitors.series.length - 1] : null;
  const moLast = compLast && typeof compLast['morpho-blue'] === 'number' ? (compLast['morpho-blue'] as number) : null;
  const avLast = compLast && typeof compLast['aave-v3'] === 'number' ? (compLast['aave-v3'] as number) : null;
  let compCross: string | null = null;
  for (const p of competitors.series) {
    const mo = p['morpho-blue'];
    const av = p['aave-v3'];
    if (typeof mo === 'number' && typeof av === 'number' && mo > av) { compCross = p.date; break; }
  }
  const compMultiple = moLast != null && avLast != null && avLast > 0 ? moLast / avLast : null;
  const compSubtitle =
    competitors.meta.length > 0
      ? compCross && compMultiple != null
        ? `Top ${competitors.meta.length} lending protocols on ${header.chainName} by TVL. Morpho overtook Aave V3 in ${monthYear(compCross)} and now leads by ${compMultiple.toFixed(1)}x. 7-day moving average.`
        : `Top ${competitors.meta.length} lending protocols on ${header.chainName} by TVL. 7-day moving average.`
      : undefined;

  const slug = header.chainSlug.toLowerCase();
  const csv = (head: string, rows: (string | number | null)[][]) =>
    [head, ...rows.map((r) => r.map((c) => (c == null ? '' : c)).join(','))].join('\n');

  // Shared scale for the rates comparison bars (Morpho vs best competitor).
  const ratesMax = Math.max(
    0.0001,
    ...rates.flatMap((r) => [r.morphoSupplyApy ?? 0, r.competitorSupplyApy ?? 0]),
  );

  return (
    <div className="space-y-6">
      {/* 1. HEADER BLOCK */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
        <div>
          <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">{header.chainName}</h1>
          <div className="mt-2 text-small uppercase tracking-header-wide text-text-muted">{header.networkLabel}</div>
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

      {/* 2. KPI STRIP. Loan-book first; TVL at position 6 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Active Loans" value={usdC(kpis.activeLoansUsd)} subtext={kpis.activeLoans30dDeltaPct != null ? `30d ${signedPct(kpis.activeLoans30dDeltaPct)}` : 'no 30d baseline'} accent="chart-1" />
        <KpiCard label="Borrow Interest" value={usdC(kpis.borrowInterestUsd)} subtext="annualized" accent="chart-3" />
        <KpiCard label="Net Interest Margin" value={bps(kpis.nim)} subtext="weighted spread" accent="chart-2" />
        <KpiCard label="Utilization" value={pct1(kpis.utilization)} subtext="loans ÷ deposits" accent="chart-5" />
        <KpiCard label="Active Loans 30d Δ" value={signedPct(kpis.activeLoans30dDeltaPct)} subtext="vs 30 days ago" accent="chart-7" />
        <KpiCard label="TVL" value={usdC(kpis.morphoTvlUsd)} subtext={`share ${pct1(kpis.morphoSharePct)}`} accent="chart-4" />
      </div>

      {/* 3. DUAL-AXIS. Active loans (left) + share of chain lending TVL (right) */}
      <ChartFrame
        anchorId="active-loans-share"
        title={`Active Loans & Share of ${header.chainName} Lending TVL`}
        subtitle={loanSubtitle}
        csvFilename={`active-loans-share-${slug}.csv`}
        csvContent={csv('date,morpho_active_loans_usd,morpho_tvl_usd,chain_lending_tvl_usd,morpho_share_pct', series.map((p) => [
          p.date, p.activeLoansUsd, p.morphoTvlUsd, p.chainLendingTvlUsd,
          p.morphoTvlUsd != null && p.chainLendingTvlUsd != null && p.chainLendingTvlUsd > 0
            ? +((p.morphoTvlUsd / p.chainLendingTvlUsd) * 100).toFixed(4) : null,
        ]))}
        methodologyText="Left axis = Morpho's active loans (borrowed) on this chain, 7-day moving average (DefiLlama). Right axis = Morpho's share of the chain's total lending TVL = Morpho TVL divided by DefiLlama lending + CDP TVL, 7-day moving average. The two axes are different Morpho quantities: the share numerator is Morpho TVL, not active loans."
        methodologySource="morpho_.protocol_tvl_daily · morpho_.chain_lending_tvl_daily"
      >
        <ChainTvlShareChart data={series} />
      </ChartFrame>

      {/* 4. COMPETITOR STACK */}
      <ChartFrame
        title={`Lending TVL on ${header.chainName}. Top ${competitors.meta.length} Protocols`}
        subtitle={compSubtitle}
        csvFilename={`lending-tvl-${slug}.csv`}
        csvContent={csv(['date', ...competitors.meta.map((m) => m.protocolSlug)].join(','), competitors.series.map((p) => ['date', ...competitors.meta.map((m) => m.protocolSlug)].map((k) => p[k] ?? '')))}
        methodologyText="Top lending/CDP protocols on this chain by latest per-chain TVL (DefiLlama), stacked over time with Morpho highlighted. Ranking uses each protocol's most recent TVL within a 7-day window and is gated to DefiLlama 'Lending'/'CDP' categories."
        methodologySource="morpho_.protocol_tvl_daily · morpho_.defillama_protocols_snapshot"
      >
        <ChainCompetitorStackChart data={competitors.series} meta={competitors.meta} />
      </ChartFrame>

      {/* 5. TOP MARKETS. Reordered: Total Supply, Active Loans, Util, APYs, Borrow Interest */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Top Markets on {header.chainName}</h2>
          <MethodologyTooltip text="Largest markets by Total Supply (Σ supply_assets_usd). Active Loans = borrow_assets_usd; Borrow Interest = Active Loans × borrow APY (annualized). APYs are clamped <100%; idle (lltv=0) and bad-oracle (APY>100%) markets are excluded." source="morpho_.market_state_daily + morpho_.markets" />
        </div>
        {markets.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No markets yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>Market</Th><Th r>Total Supply</Th><Th r>Active Loans</Th><Th r>Utilization</Th>
                  <Th r>Supply APY</Th><Th r>Borrow APY</Th><Th r>Borrow Interest</Th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => {
                  const lltvPct = lltvDisplayPct(m.lltvPct);
                  const borrowInterest = m.borrowApy != null ? m.borrowUsd * m.borrowApy : null;
                  return (
                    <tr key={m.uniqueKey} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                      <td className="py-2 text-text-primary whitespace-nowrap">
                        <span className="uppercase tracking-header-medium">{m.collateralSymbol ?? 'N/A'} / {m.loanSymbol}</span>
                        {lltvPct != null && <span className="ml-2 text-tiny text-text-muted">{lltvPct.toFixed(0)}% LLTV</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(m.supplyUsd)}</td>
                      <td className="py-2 text-right tabular-nums text-text-primary">{usdC(m.borrowUsd)}</td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(m.utilization)}</td>
                      <td className="py-2 text-right tabular-nums text-positive">{pct2(m.supplyApy)}</td>
                      <td className="py-2 text-right tabular-nums text-accent">{pct2(m.borrowApy)}</td>
                      <td className="py-2 text-right tabular-nums text-text-primary">{usdC(borrowInterest)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6. TOP VAULTS . + Curator Fees 30d */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Top Vaults on {header.chainName}</h2>
          <MethodologyTooltip text="Largest MetaMorpho vaults by TVL. Curator Fees 30d = TVL × gross APY × performance fee × (30/365). Net APY is the depositor's yield after fees. Bad-data vaults (APY > 100%) show no fee." source="morpho_.vault_state_daily + morpho_.vaults" />
        </div>
        {vaults.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No vaults yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>Name</Th><Th>Curator</Th><Th>Asset</Th><Th r>TVL</Th><Th r>Net APY</Th><Th r>Fee</Th><Th r>Curator Fees 30d</Th><Th r>30d Δ TVL</Th>
                </tr>
              </thead>
              <tbody>
                {vaults.map((v) => (
                  <tr key={`${v.chainId}:${v.address}`} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                    <td className="py-2 text-text-primary uppercase tracking-header-medium">{v.name ?? 'N/A'}</td>
                    <td className="py-2 text-text-secondary">{v.curatorName ?? <span className="text-text-muted">unattributed</span>}</td>
                    <td className="py-2 text-text-secondary uppercase tracking-header-medium">{v.assetSymbol ?? 'N/A'}</td>
                    <td className="py-2 text-right tabular-nums text-text-primary">{usdC(v.tvlUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-positive">{pct2(v.netApy)}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{v.feeBps == null ? 'N/A' : `${(v.feeBps / 100).toFixed(1)}%`}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(v.curatorFees30dUsd)}</td>
                    <td className={`py-2 text-right tabular-nums ${v.delta30dTvlUsd == null ? 'text-text-muted' : v.delta30dTvlUsd >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {v.delta30dTvlUsd == null ? 'N/A' : `${v.delta30dTvlUsd >= 0 ? '+' : ''}${usdC(v.delta30dTvlUsd)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 7. CURATOR PRESENCE . + Curator Fees Annualized */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Curator Presence on {header.chainName}</h2>
          <MethodologyTooltip text="Curators ranked by their vault TVL on this chain. Curator Fees (Ann.) = Σ vault TVL × gross APY × performance fee. Weighted Net APY is TVL-weighted across the curator's vaults here. Global TVL is the curator's total across all chains." source="morpho_.vault_state_daily + morpho_.curators" />
        </div>
        {curators.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No curated vaults yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>Curator</Th><Th r>Vaults Here</Th><Th r>TVL on Chain</Th><Th r>Curator Fees (Ann.)</Th><Th r>Weighted Net APY</Th><Th r>Global TVL</Th>
                </tr>
              </thead>
              <tbody>
                {curators.map((c) => (
                  <tr key={c.curatorId} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                    <td className="py-2 text-text-primary uppercase tracking-header-medium">{c.curatorName ?? c.curatorId}</td>
                    <td className="py-2 text-right tabular-nums text-text-primary">{c.vaultCount}</td>
                    <td className="py-2 text-right tabular-nums text-text-primary">{usdC(c.tvlOnChainUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(c.curatorFeesAnnualUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-positive">{pct2(c.weightedNetApy)}</td>
                    <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(c.globalTvlUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 8. ASSET MIX. Two donuts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartFrame title={`Loan Asset Mix. What Morpho Lends on ${header.chainName}`} csvFilename={`asset-mix-supply-${slug}.csv`}
          csvContent={csv('category,value_usd,top_symbol,top_symbol_usd', assetMix.supply.map((s) => [s.category, s.supplyUsd, s.topSymbol ?? '', s.topSymbolUsd]))}
          methodologyText="Share of Morpho supply (Σ supply_assets_usd, latest snapshot) by loan-asset class on this chain. Symbols bucketed in JS into stablecoin / LST / LRT / BTC / ETH / RWA / other."
          methodologySource="morpho_.market_state_daily + morpho_.assets">
          <ChainAssetMix data={assetMix.supply} />
        </ChartFrame>
        <ChartFrame title={`Collateral Mix. What Backs Loans on ${header.chainName}`} csvFilename={`asset-mix-collateral-${slug}.csv`}
          csvContent={csv('category,value_usd,top_symbol,top_symbol_usd', assetMix.collateral.map((s) => [s.category, s.supplyUsd, s.topSymbol ?? '', s.topSymbolUsd]))}
          methodologyText="Share of collateral backing loans (Σ collateral_assets_usd, latest snapshot) by asset class on this chain. Idle/loan-only and bad-oracle markets are excluded."
          methodologySource="morpho_.market_state_daily + morpho_.assets">
          <ChainAssetMix data={assetMix.collateral} />
        </ChartFrame>
      </div>

      {/* 9. INTEREST FLOW ATTRIBUTION */}
      {interestFlow && interestFlow.totalBorrowInterest > 0 && <InterestFlow flow={interestFlow} chainName={header.chainName} />}

      {/* 10. RATES ON THIS CHAIN. Visual: Morpho supply APY vs best competitor. */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Supply Rates vs Competitors on {header.chainName}</h2>
          <MethodologyTooltip text="For assets with both a Morpho market and an Aave V3 market on this chain: Morpho Supply APY is supply-weighted across Morpho markets (clamped <100%); competitor APY is Aave V3's supply rate from DefiLlama yields. Spread = Morpho minus competitor, in bps. Bars share one scale." source="morpho_.market_state_daily + morpho_.aave_rates_daily" />
        </div>
        <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Morpho supply APY against the best competing venue, per asset.</p>
        {rates.length === 0 ? (
          <div className="text-small uppercase tracking-header-medium text-text-muted">No assets with both a Morpho market and a competitor market on this chain</div>
        ) : (
          <div className="space-y-4">
            {rates.map((r) => {
              const mW = Math.max(2, ((r.morphoSupplyApy ?? 0) / ratesMax) * 100);
              const cW = Math.max(2, ((r.competitorSupplyApy ?? 0) / ratesMax) * 100);
              const pos = (r.spreadBps ?? 0) >= 0;
              return (
                <div key={r.asset} className="grid grid-cols-[64px_1fr_auto] items-center gap-3">
                  <span className="text-small uppercase tracking-header-medium text-text-primary">{r.asset}</span>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 rounded-sm" style={{ width: `${mW}%`, background: 'var(--accent)' }} />
                      <span className="text-tiny tabular-nums text-text-primary">Morpho {pct2(r.morphoSupplyApy)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 rounded-sm" style={{ width: `${cW}%`, background: 'var(--border-bright)' }} />
                      <span className="text-tiny tabular-nums text-text-secondary">{r.competitorName} {pct2(r.competitorSupplyApy)}</span>
                    </div>
                  </div>
                  <span className={`text-small tabular-nums ${pos ? 'text-positive' : 'text-negative'}`}>
                    {r.spreadBps == null ? 'N/A' : `${pos ? '+' : ''}${r.spreadBps} bps`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>


      <p className="text-tiny uppercase tracking-header-medium text-text-muted">As of {kpis.asOfDate} · loan-book metrics from Morpho market/vault state</p>
    </div>
  );
}

// ---------- Section 9 sub-component ----------
const FLOW_COLORS = { vaults: '#34d399', direct: '#6b85ff', curators: '#fbbf24', dao: 'hsla(0,0%,100%,0.22)' };

function InterestFlow({ flow, chainName }: { flow: InterestFlowAttribution; chainName: string }) {
  const total = flow.totalBorrowInterest || 1;
  const segs = [
    { key: 'vaults', label: 'To Lenders · via vaults', usd: flow.lenderViaVaults, color: FLOW_COLORS.vaults },
    { key: 'direct', label: 'To Lenders · direct supply', usd: flow.lenderDirect, color: FLOW_COLORS.direct },
    { key: 'curators', label: 'To Curators', usd: flow.curatorFees, color: FLOW_COLORS.curators },
    { key: 'dao', label: 'To Morpho DAO (fee switch off)', usd: flow.daoFees, color: FLOW_COLORS.dao },
  ];
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Interest Flow Attribution</h2>
        <MethodologyTooltip text="Where annualized borrow interest goes. Total = Σ borrow × borrow APY. To Curators = Σ vault TVL × APY × fee. Lender Yield = Total − Curator Fees − Protocol Fees (DAO fee switch is off ⇒ $0). Lender yield is split vaults-vs-direct by the share of market supply sourced from MetaMorpho vaults. An estimate." source="morpho_.market_state_daily + morpho_.vault_state_daily" />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Annualized borrow interest paid by borrowers on {chainName}: <span className="text-text-primary">{usdC(flow.totalBorrowInterest)}</span></p>
      <div className="flex h-9 w-full overflow-hidden rounded bg-background">
        {segs.map((s) => {
          const pctW = (s.usd / total) * 100;
          return (
            <div key={s.key} className="flex items-center justify-center overflow-hidden" style={{ width: `${Math.max(0, pctW)}%`, background: s.color }} title={`${s.label}: ${usdC(s.usd)}`}>
              {pctW >= 8 && <span className="px-1 text-tiny font-medium tabular-nums text-background">{pctW.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {segs.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-small">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="uppercase tracking-header-medium text-text-secondary">{s.label}</span>
            </span>
            <span className="tabular-nums text-text-primary">{usdC(s.usd)} <span className="text-text-muted">{((s.usd / total) * 100).toFixed(0)}%</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-tiny text-text-muted">Lender yield = borrow interest − curator fees − protocol fees · vault/direct split by vault supply share ({pct1(flow.vaultSupplyShare)})</p>
    </section>
  );
}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>;
}

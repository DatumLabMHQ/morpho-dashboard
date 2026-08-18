'use client';

import Link from 'next/link';

import { AssetCompositionChart } from './asset-composition-chart';
import { AssetVelocityScatter } from './asset-velocity-scatter';
import { ChartFrame } from '@/components/chains/chart-frame';
import { type HeatCell, type HeatColumn, type HeatRow, HeatmapGrid } from '@/components/chains/heatmap-grid';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import { ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, ASSET_CLASS_ORDER, ASSET_CLASS_SHORT, type AssetClass } from '@/lib/assets/asset-class';
import { fmtNumber, fmtUsd } from '@/lib/format';
import type {
  AssetClassEconomics, AssetCompositionPayload, AssetSuperlative, AssetVelocityPoint,
  AssetsHeader, CollateralDeepDive, PerChainMixRow, StablecoinDeepDive, UncategorizedAsset,
} from '@/lib/queries/assets';

interface Props {
  header: AssetsHeader;
  totalSupply: number;
  totalCollateral: number;
  kpis: AssetSuperlative[];
  composition: AssetCompositionPayload;
  classEcon: AssetClassEconomics[];
  stablecoin: StablecoinDeepDive;
  collateral: CollateralDeepDive;
  velocity: AssetVelocityPoint[];
  perChain: { chains: PerChainMixRow[]; categories: string[] };
  uncategorized: UncategorizedAsset[];
}

const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const pct2 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(2)}%`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const doublingDisplay = (d: number | null) => (d == null ? 'N/A' : d > 1000 ? '1000+' : `${Math.round(d)}d`);
const aLink = (sym: string) => `/assets/${encodeURIComponent(sym)}`;

function rankIntensities(values: (number | null)[], lowerBetter = false): (number | null)[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  present.sort((a, b) => a.v - b.v);
  const n = present.length;
  const out: (number | null)[] = values.map(() => null);
  present.forEach((x, rank) => { const f = n <= 1 ? 1 : rank / (n - 1); out[x.i] = lowerBetter ? 1 - f : f; });
  return out;
}

export function AssetsBalanceSheetClient(props: Props) {
  const { header, totalSupply, totalCollateral, kpis, composition, classEcon, stablecoin, collateral, velocity, perChain, uncategorized } = props;

  return (
    <div className="space-y-6">
      {/* 1. HEADER */}
      <header className="border-b border-border pb-5">
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">Assets</h1>
        <p className="mt-2 text-small text-text-secondary">
          {fmtNumber(header.loanAssetCount)} loan assets, {fmtNumber(header.collateralAssetCount)} collateral assets across {fmtNumber(header.marketCount)} markets and {header.chainCount} chains ·{' '}
          <span className="text-text-primary">{usdC(totalSupply)}</span> supply · <span className="text-text-primary">{usdC(totalCollateral)}</span> collateral
        </p>
      </header>

      {/* 2. HEADLINE KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.key} className="relative overflow-hidden rounded-lg border border-border bg-surface p-4">
            <div className="absolute inset-x-0 top-0 h-px bg-accent" />
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">{k.label}</div>
            <div className="mt-2 text-body uppercase tracking-header-medium text-text-primary leading-tight">
              {k.symbol ? <Link href={aLink(k.symbol)} className="hover:text-accent">{k.value}</Link> : k.value}
            </div>
            <div className="mt-1 text-tiny text-text-secondary normal-case tracking-normal">{k.caption}</div>
          </div>
        ))}
      </div>

      {/* 3. ANCHOR CHART */}
      <AssetCompositionChart payload={composition} />

      {/* 4. ASSET CLASS ECONOMICS HEATMAP */}
      <ClassEconomicsHeatmap rows={classEcon} />

      {/* 5. STABLECOIN DEEP DIVE */}
      <StablecoinDeepDiveSection data={stablecoin} />

      {/* 6. COLLATERAL DEEP DIVE */}
      <CollateralDeepDiveSection data={collateral} />

      {/* 7. ASSET VELOCITY */}
      <ChartFrame title="Asset Velocity. Who's Growing, Who's Shrinking" subtitle="30d supply growth × total supply (log) · bubble = # markets · color = class"
        csvFilename="asset-velocity.csv" csvContent={['symbol,supply_30d_delta_pct,total_supply,markets,quadrant', ...velocity.map((p) => [p.symbol, p.supply30dDeltaPct ?? '', p.totalSupply, p.marketCount, p.quadrant].join(','))].join('\n')}
        methodologyText="Each bubble is a loan asset (≥$5M supply). X = 30d supply growth %, Y = total supply (log), size = # markets, color = class. Quadrants: growing whales (↗ big), rising challengers (↗ small), shrinking incumbents (↘ big), declining minor (↘ small). Labels = top 5 growers + 3 shrinkers by $ delta.">
        <AssetVelocityScatter points={velocity} />
      </ChartFrame>

      {/* 8. PER-CHAIN ASSET MIX */}
      <PerChainMixHeatmap data={perChain} />

      {/* 9. UNCATEGORIZED PANEL */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-small uppercase tracking-header-wide text-accent">Uncategorized Assets</h2>
        <p className="mb-3 text-tiny text-text-secondary">Assets above $10M not in a thematic class. A maintenance signal. The remainder are reviewed native-gas / governance / exotic tokens with no thematic bucket.</p>
        {uncategorized.length === 0 ? <div className="text-small uppercase tracking-header-medium text-positive">All assets above $10M are classified ✓</div> : (
          <table className="w-full text-body">
            <thead><tr className="border-b border-border text-left"><Th>Symbol</Th><Th>Side</Th><Th r>USD</Th><Th r># Markets</Th></tr></thead>
            <tbody>
              {uncategorized.map((u) => (
                <tr key={`${u.symbol}:${u.side}`} className="border-b border-border last:border-0">
                  <td className="py-2 uppercase tracking-header-medium text-text-primary">{u.symbol}</td>
                  <td className="py-2 text-text-secondary">{u.side}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{usdC(u.totalUsd)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{u.marketCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 11. METHODOLOGY */}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3 text-small text-text-secondary leading-relaxed">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Methodology</h2>
        <p>Assets sit on both sides of Morpho&apos;s balance sheet. Supply-side metrics measure lent capital; collateral-side metrics measure locked capital backing borrows. Borrow interest generated by an asset reveals its economic productivity. High supply with low borrow interest indicates idle capital.</p>
        <p>Total Supply = Σ supply_assets_usd by loan asset. Total Collateral = Σ collateral_assets_usd by collateral asset. Borrow Interest = Σ borrow × LEAST(borrow_apy, 1.0). APYs clamped at 100% and markets reporting &gt;100% APY are excluded (degenerate-IRM). Asset class is inferred from symbol.</p>
      </section>
    </div>
  );

  // ---------- Section 4 ----------
  function ClassEconomicsHeatmap({ rows }: { rows: AssetClassEconomics[] }) {
    const cols: { key: string; label: string; fmt: (r: AssetClassEconomics) => string; val: (r: AssetClassEconomics) => number | null; lowerBetter?: boolean }[] = [
      { key: 'sup', label: 'Total Supply', fmt: (r) => usdC(r.totalSupply), val: (r) => r.totalSupply },
      { key: 'col', label: 'Total Collateral', fmt: (r) => usdC(r.totalCollateral), val: (r) => r.totalCollateral },
      { key: 'bi', label: 'Borrow Interest Gen.', fmt: (r) => usdC(r.borrowInterestGen), val: (r) => r.borrowInterestGen },
      { key: 'util', label: 'Avg Utilization', fmt: (r) => pct1(r.avgUtilization), val: (r) => r.avgUtilization },
      { key: 'sapy', label: 'Avg Supply APY', fmt: (r) => pct2(r.avgSupplyApy), val: (r) => r.avgSupplyApy },
      { key: 'd30', label: '30d Δ %', fmt: (r) => signedPct(r.supply30dDeltaPct), val: (r) => r.supply30dDeltaPct },
      { key: 'dbl', label: 'Doubling Time', fmt: (r) => doublingDisplay(r.doublingTimeDays), val: (r) => r.doublingTimeDays, lowerBetter: true },
    ];
    const intens = cols.map((c) => rankIntensities(rows.map((r) => c.val(r)), c.lowerBetter));
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Asset Class Economics</h2>
          <MethodologyTooltip text="Per asset class: Total Supply (lent), Total Collateral (locked), Borrow Interest Generated (Σ borrow × clamped borrow APY), supply-weighted Avg Utilization & Supply APY, 30d supply Δ, and supply doubling time. Reveals asymmetries. E.g. stablecoins are a fraction of locked value but generate most borrow interest, while BTC is huge collateral but barely supplied." source="morpho_.market_state_daily × morpho_.markets" />
        </div>
        <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Where supply, collateral, and borrow interest actually concentrate</p>
        <HeatmapGrid cornerLabel="Class"
          columns={cols.map((c): HeatColumn => ({ key: c.key, label: c.label }))}
          rows={rows.map((r, ri): HeatRow => ({
            key: r.category, label: <span style={{ color: ASSET_CLASS_COLOR[r.category as AssetClass] }}>{ASSET_CLASS_LABEL[r.category as AssetClass] ?? r.category}</span>,
            cells: cols.map((c, ci): HeatCell => ({ key: c.key, content: c.fmt(r), intensity: intens[ci]![ri]!, tooltip: <div><div className="uppercase tracking-header-medium text-text-primary">{ASSET_CLASS_LABEL[r.category as AssetClass] ?? r.category} · {c.label}</div><div className="mt-1 tabular-nums">{c.fmt(r)}</div></div> })),
          }))} />
      </section>
    );
  }

  // ---------- Section 8 ----------
  function PerChainMixHeatmap({ data }: { data: { chains: PerChainMixRow[]; categories: string[] } }) {
    const classes = data.categories as AssetClass[];
    const maxBi = Math.max(...data.chains.map((c) => c.borrowInterestGen), 1);
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-1">
          <h2 className="text-small uppercase tracking-header-wide text-accent">Per-Chain Asset Mix</h2>
          <MethodologyTooltip text="Per chain: collateral composition by asset class (% of the chain's collateral, shaded within row) plus the chain's annualized borrow interest generated (shaded across chains). Shows which chains generate interest from which collateral classes." source="morpho_.market_state_daily × morpho_.markets" />
        </div>
        <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Collateral class mix + borrow interest generated, by chain</p>
        <HeatmapGrid cornerLabel="Chain"
          columns={[...classes.map((c): HeatColumn => ({ key: c, label: ASSET_CLASS_SHORT[c], color: ASSET_CLASS_COLOR[c] })), { key: '__bi', label: 'Borrow Int.' }]}
          rows={data.chains.map((ch): HeatRow => {
            const total = classes.reduce((s, c) => s + (ch.byClass[c] ?? 0), 0);
            const maxPct = Math.max(...classes.map((c) => (total > 0 ? (ch.byClass[c] ?? 0) / total : 0)), 0.0001);
            return {
              key: ch.chainSlug, label: <Link href={`/chains/${ch.chainSlug.toLowerCase()}`} className="hover:text-accent">{ch.chainName}</Link>,
              cells: [
                ...classes.map((c): HeatCell => {
                  const pct = total > 0 ? (ch.byClass[c] ?? 0) / total : 0;
                  return { key: c, content: pct > 0 ? `${(pct * 100).toFixed(0)}%` : '·', intensity: pct > 0 ? pct / maxPct : null, dimText: pct === 0, tooltip: <div><div className="uppercase tracking-header-medium text-text-primary">{ch.chainName} · {ASSET_CLASS_LABEL[c]}</div><div className="mt-1 tabular-nums">{(pct * 100).toFixed(1)}% · {usdC(ch.byClass[c] ?? 0)}</div></div> };
                }),
                { key: '__bi', content: usdC(ch.borrowInterestGen), intensity: ch.borrowInterestGen / maxBi, tooltip: <div><div className="uppercase tracking-header-medium text-text-primary">{ch.chainName}</div><div className="mt-1 tabular-nums">{usdC(ch.borrowInterestGen)} borrow interest</div></div> },
              ],
            };
          })} />
      </section>
    );
  }

  function StablecoinDeepDiveSection({ data }: { data: StablecoinDeepDive }) {
    const top = data.rows.slice(0, 14);
    const maxSup = Math.max(...top.map((r) => r.supplyUsd), 1);
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-small uppercase tracking-header-wide text-accent">Stablecoin Deep Dive</h2>
        <p className="mb-4 text-tiny text-text-secondary">{usdC(data.totalUsd)} stablecoin supply (loan side)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead><tr className="border-b border-border text-left"><Th>Symbol</Th><Th r>Total Supply</Th><Th r>Borrow Int. Gen.</Th><Th r>Avg Supply APY</Th><Th r># Markets</Th><Th r>30d Δ</Th>{data.tbillRatePct != null && <Th r>vs T-bill</Th>}</tr></thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.symbol} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2"><Link href={aLink(r.symbol)} className="uppercase tracking-header-medium text-text-primary hover:text-accent">{r.symbol}</Link>{r.isEthena && <span className="ml-1.5 text-tiny text-accent">ena</span>}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">
                    <span className="mr-2 inline-block h-1.5 rounded-sm bg-accent/50 align-middle" style={{ width: `${Math.max(2, (r.supplyUsd / maxSup) * 60)}px` }} />{usdC(r.supplyUsd)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.borrowInterestGen)}</td>
                  <td className="py-2 text-right tabular-nums text-positive">{pct2(r.avgSupplyApy)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.marketCount}</td>
                  <td className={`py-2 text-right tabular-nums ${r.supply30dDeltaPct == null ? 'text-text-muted' : r.supply30dDeltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>{signedPct(r.supply30dDeltaPct)}</td>
                  {data.tbillRatePct != null && <td className={`py-2 text-right tabular-nums ${(r.avgSupplyApy ?? 0) - data.tbillRatePct >= 0 ? 'text-positive' : 'text-negative'}`}>{r.avgSupplyApy == null ? 'N/A' : `${((r.avgSupplyApy - data.tbillRatePct) * 10000 >= 0 ? '+' : '')}${Math.round((r.avgSupplyApy - data.tbillRatePct) * 10000)} bps`}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="text-tiny uppercase tracking-header-medium text-accent">Ethena footprint</div>
            <p className="mt-1 text-small text-text-secondary">Ethena (USDe + sUSDe + USDtb): <span className="text-text-primary">{usdC(data.ethenaCombinedUsd)}</span> = <span className="text-text-primary">{pct1(data.ethenaSharePct)}</span> of Morpho stablecoin supply. Despite Ethena&apos;s positioning as a yield-bearing stablecoin native to lending markets, its Morpho footprint is far below the sector narrative.</p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">Stablecoin yield vs risk-free</div>
            {data.tbillRatePct != null ? (
              <p className="mt-1 text-small text-text-secondary">3M T-bill (risk-free): <span className="text-text-primary">{pct2(data.tbillRatePct)}</span>. The &quot;vs T-bill&quot; column shows each stablecoin&apos;s Morpho supply APY spread over risk-free.</p>
            ) : (
              <p className="mt-1 text-small text-text-muted">Spread vs 3M T-bill. Coming once the FRED sync lands (tbill_rates_daily is empty).</p>
            )}
          </div>
        </div>
      </section>
    );
  }

  function CollateralDeepDiveSection({ data }: { data: CollateralDeepDive }) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-small uppercase tracking-header-wide text-accent">Collateral Assets Deep Dive</h2>
        <p className="mb-4 text-tiny text-text-secondary">{usdC(data.totalCollateral)} total collateral locked</p>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead><tr className="border-b border-border text-left"><Th>Symbol</Th><Th>Class</Th><Th r>Total Collateral</Th><Th r># Markets</Th><Th r># Chains</Th><Th r>Max LLTV</Th><Th r>Wtd Util</Th><Th r>30d Δ</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.symbol} className="border-b border-border last:border-0 hover:bg-hover-overlay">
                  <td className="py-2"><Link href={aLink(r.symbol)} className="uppercase tracking-header-medium text-text-primary hover:text-accent">{r.symbol}</Link></td>
                  <td className="py-2 text-tiny uppercase tracking-header-medium" style={{ color: ASSET_CLASS_COLOR[r.category as AssetClass] }}>{ASSET_CLASS_SHORT[r.category as AssetClass] ?? r.category}</td>
                  <td className="py-2 text-right tabular-nums text-text-primary">{usdC(r.collateralUsd)}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.marketCount}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.chainCount}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{r.maxLltvPct == null ? 'N/A' : `${(r.maxLltvPct * 100).toFixed(0)}%`}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(r.weightedUtil)}</td>
                  <td className={`py-2 text-right tabular-nums ${r.collateral30dDeltaPct == null ? 'text-text-muted' : r.collateral30dDeltaPct >= 0 ? 'text-positive' : 'text-negative'}`}>{signedPct(r.collateral30dDeltaPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="text-tiny uppercase tracking-header-medium text-accent">BTC variants</div>
            <p className="mt-1 text-small text-text-secondary">cbBTC: <span className="text-text-primary">{usdC(data.btc.cbBTC)}</span>, WBTC: <span className="text-text-primary">{usdC(data.btc.WBTC)}</span>, LBTC: <span className="text-text-primary">{usdC(data.btc.LBTC)}</span>, others: {usdC(data.btc.otherBtc)}. Combined BTC collateral = <span className="text-text-primary">{pct1(data.btc.sharePct)}</span> of Morpho-wide collateral. The Coinbase-Morpho-Base flywheel.</p>
          </div>
          <div className="rounded-md border border-border bg-background p-3">
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">LST / LRT</div>
            <p className="mt-1 text-small text-text-secondary">LSTs: <span className="text-text-primary">{usdC(data.lstLrt.lstTotal)}</span> backing borrows. wstETH dominant at <span className="text-text-primary">{pct1(data.lstLrt.wstEthShare)}</span>. LRTs (weETH, ezETH, rsETH): <span className="text-text-primary">{usdC(data.lstLrt.lrtTotal)}</span> combined.</p>
          </div>
        </div>
      </section>
    );
  }

}

function Th({ children, r }: { children: React.ReactNode; r?: boolean }) {
  return <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium text-text-muted ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>;
}

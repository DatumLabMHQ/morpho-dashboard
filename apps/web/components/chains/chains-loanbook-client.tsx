'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ActiveLoanByChainChart } from './active-loan-by-chain-chart';
import { type HeatCell, type HeatColumn, type HeatRow, HeatmapGrid } from './heatmap-grid';
import { MethodologyTooltip } from '@/components/chart-card/methodology-tooltip';
import {
  ASSET_CLASS_COLOR, ASSET_CLASS_LABEL, ASSET_CLASS_ORDER, ASSET_CLASS_SHORT, type AssetClass,
} from '@/lib/assets/asset-class';
import { fmtUsd } from '@/lib/format';
import type {
  ActiveLoanSeriesPayload, ChainEconomics, ChainStructuralRow,
  ChainSuperlative, ChainsTableExpandedRow, CuratorChainMatrix,
} from '@/lib/queries/chains';

interface Props {
  asOfDate: string;
  kpis: ChainSuperlative[];
  series: ActiveLoanSeriesPayload;
  structural: ChainStructuralRow[];
  economics: ChainEconomics[];
  curatorMatrix: CuratorChainMatrix;
  table: ChainsTableExpandedRow[];
}

// ---------- formatters ----------
const usdC = (v: number | null) => (v == null ? 'N/A' : fmtUsd(v, { compact: true }));
const pct1 = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${(v * 100).toFixed(1)}%`);
const bps = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${Math.round(v * 10000)} bps`);
const signedPct = (v: number | null) => (v == null || !Number.isFinite(v) ? 'N/A' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

// Rank-based intensity per column (cross-sectional). lowerBetter inverts.
function rankIntensities(values: (number | null)[], lowerBetter = false): (number | null)[] {
  const present = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  present.sort((a, b) => a.v - b.v);
  const n = present.length;
  const out: (number | null)[] = values.map(() => null);
  present.forEach((x, rank) => {
    const frac = n <= 1 ? 1 : rank / (n - 1);
    out[x.i] = lowerBetter ? 1 - frac : frac;
  });
  return out;
}

export function ChainsLoanbookClient(props: Props) {
  const { asOfDate, kpis, series, structural, economics, curatorMatrix, table } = props;

  const totalActiveLoans = economics.reduce((s, e) => s + e.activeLoans, 0);
  const totalBorrowInterest = economics.reduce((s, e) => s + e.borrowInterest, 0);

  return (
    <div className="space-y-6">
      {/* SECTION 1. HEADER */}
      <header className="border-b border-border pb-5">
        <h1 className="text-[28px] uppercase tracking-header-medium text-text-primary leading-none">Chains</h1>
        <p className="mt-2 text-small text-text-secondary">
          Morpho across {economics.length} chains · active loans{' '}
          <span className="text-text-primary">{usdC(totalActiveLoans)}</span> · borrow interest{' '}
          <span className="text-text-primary">{usdC(totalBorrowInterest)}</span> annualized
        </p>
      </header>

      {/* SECTION 2. HEADLINE KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.key} className="relative overflow-hidden rounded-lg border border-border bg-surface p-4">
            <div className="absolute inset-x-0 top-0 h-px bg-accent" />
            <div className="text-tiny uppercase tracking-header-medium text-text-muted">{k.label}</div>
            <div className="mt-2 text-body uppercase tracking-header-medium text-text-primary leading-tight">
              {k.chainName ? (
                <Link href={`/chains/${k.chainSlug?.toLowerCase()}`} className="hover:text-accent">{k.chainName}</Link>
              ) : 'N/A'}
            </div>
            <div className="mt-1 text-tiny text-text-secondary normal-case tracking-normal">{k.caption}</div>
          </div>
        ))}
      </div>

      {/* SECTION 3. ANCHOR CHART */}
      <ActiveLoanByChainChart payload={series} />

      {/* SECTION 4. STRUCTURAL IDENTITY HEATMAP */}
      <StructuralHeatmap rows={structural} />

      {/* SECTION 5. CHAIN ECONOMICS HEATMAP */}
      <EconomicsHeatmap rows={economics} />

      {/* SECTION 6. CROSS-CHAIN CURATOR NETWORK */}
      <CuratorNetwork matrix={curatorMatrix} />

      {/* SECTION 7. ALL CHAINS TABLE */}
      <AllChainsTable rows={table} />

      {/* SECTION 8. METHODOLOGY */}
      <Methodology asOfDate={asOfDate} />
    </div>
  );
}

// ---------- Section 4 ----------
function StructuralHeatmap({ rows }: { rows: ChainStructuralRow[] }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Chain Structural Identity</h2>
        <MethodologyTooltip
          text="Each cell is the share of a chain's Morpho collateral (Σ collateral_assets_usd, latest snapshot) in that asset class. Symbols are bucketed in JS. Stablecoin / LST / LRT / BTC / ETH / RWA / other. Shaded by intensity within each row (the chain's largest class is darkest). Hover a cell for % · USD · market count. Bad-oracle markets (APY > 100%) are excluded."
          source="morpho_.market_state_daily + morpho_.markets"
        />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">How each chain&apos;s collateral composes. Which asset classes back lending where</p>
      <HeatmapGrid
        cornerLabel="Chain"
        columns={ASSET_CLASS_ORDER.map((c): HeatColumn => ({ key: c, label: ASSET_CLASS_SHORT[c], color: ASSET_CLASS_COLOR[c] }))}
        rows={rows.map((r): HeatRow => {
          const maxPct = Math.max(...ASSET_CLASS_ORDER.map((c) => r.byClass[c].pct), 0.0001);
          return {
            key: r.chainSlug,
            label: <Link href={`/chains/${r.chainSlug.toLowerCase()}`} className="hover:text-accent">{r.chainName}</Link>,
            cells: ASSET_CLASS_ORDER.map((c): HeatCell => {
              const cell = r.byClass[c];
              return {
                key: c,
                content: cell.pct > 0 ? `${(cell.pct * 100).toFixed(0)}%` : '·',
                intensity: cell.pct > 0 ? cell.pct / maxPct : null,
                dimText: cell.pct === 0,
                tooltip: (
                  <div>
                    <div className="uppercase tracking-header-medium text-text-primary">{r.chainName} · {ASSET_CLASS_LABEL[c]}</div>
                    <div className="mt-1 tabular-nums">{(cell.pct * 100).toFixed(1)}% of collateral</div>
                    <div className="tabular-nums">{usdC(cell.usd)} · {cell.marketCount} market{cell.marketCount === 1 ? '' : 's'}</div>
                  </div>
                ),
              };
            }),
          };
        })}
      />
    </section>
  );
}

// ---------- Section 5 ----------
const ECON_COLS: { key: keyof ChainEconomics; label: string; fmt: (r: ChainEconomics) => string; val: (r: ChainEconomics) => number | null; lowerBetter?: boolean }[] = [
  { key: 'activeLoans', label: 'Active Loans', fmt: (r) => usdC(r.activeLoans), val: (r) => r.activeLoans },
  { key: 'borrowInterest', label: 'Borrow Interest', fmt: (r) => usdC(r.borrowInterest), val: (r) => r.borrowInterest },
  { key: 'nim', label: 'NIM', fmt: (r) => bps(r.nim), val: (r) => r.nim },
  { key: 'curatorFees', label: 'Curator Fees', fmt: (r) => usdC(r.curatorFees), val: (r) => r.curatorFees },
  { key: 'utilization', label: 'Utilization', fmt: (r) => pct1(r.utilization), val: (r) => r.utilization },
  { key: 'activeLoans30dDeltaPct', label: 'Active Loans 30d Δ', fmt: (r) => signedPct(r.activeLoans30dDeltaPct), val: (r) => r.activeLoans30dDeltaPct },
];

function EconomicsHeatmap({ rows }: { rows: ChainEconomics[] }) {
  const intensitiesByCol = ECON_COLS.map((col) => rankIntensities(rows.map((r) => col.val(r)), col.lowerBetter));
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Chain Economics</h2>
        <MethodologyTooltip
          text="Per-chain metrics from the latest market/vault snapshot. Active Loans = Σ borrow_assets_usd. Borrow Interest = Σ borrow × borrow APY (annualized). NIM = weighted borrow APY − weighted supply APY. Curator Fees = Σ vault TVL × APY × fee (annualized). Utilization = active loans ÷ total deposits (supply + collateral). Active Loans 30d Δ = % change vs 30 days ago. Each column is shaded by its cross-sectional rank. Bad-oracle markets (APY > 100%) excluded."
          source="morpho_.market_state_daily + morpho_.vault_state_daily"
        />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Where Morpho&apos;s economic activity concentrates by chain</p>
      <HeatmapGrid
        cornerLabel="Chain"
        columns={ECON_COLS.map((c): HeatColumn => ({ key: String(c.key), label: c.label }))}
        rows={rows.map((r, ri): HeatRow => ({
          key: r.chainSlug,
          label: <Link href={`/chains/${r.chainSlug.toLowerCase()}`} className="hover:text-accent">{r.chainName}</Link>,
          cells: ECON_COLS.map((c, ci): HeatCell => ({
            key: String(c.key),
            content: c.fmt(r),
            intensity: intensitiesByCol[ci]![ri]!,
            tooltip: (
              <div>
                <div className="uppercase tracking-header-medium text-text-primary">{r.chainName} · {c.label}</div>
                <div className="mt-1 tabular-nums">{c.fmt(r)}</div>
              </div>
            ),
          })),
        }))}
      />
    </section>
  );
}

// ---------- Section 6 ----------
function CuratorNetwork({ matrix }: { matrix: CuratorChainMatrix }) {
  const maxTvl = Math.max(
    ...matrix.curators.flatMap((cu) => matrix.chains.map((ch) => matrix.cells[cu.id]?.[ch.slug]?.tvl ?? 0)),
    1,
  );
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center gap-1">
        <h2 className="text-small uppercase tracking-header-wide text-accent">Curator Presence Across Chains</h2>
        <MethodologyTooltip
          text="Rows = top curators by global vault TVL; columns = top chains by active loans. Each cell is that curator's vault TVL on that chain (latest snapshot), shaded by intensity. TVL is used here (not a P&L metric) because curator-to-chain is a presence/scale relationship. Hover for TVL · vault count · % of the curator's global TVL."
          source="morpho_.vault_state_daily + morpho_.curators"
        />
      </div>
      <p className="mt-0.5 mb-4 text-tiny text-text-secondary">Top {matrix.curators.length} curators by global TVL × top {matrix.chains.length} chains by active loans · cells are TVL</p>
      <HeatmapGrid
        cornerLabel="Curator"
        columns={matrix.chains.map((ch): HeatColumn => ({ key: ch.slug, label: ch.name }))}
        rows={matrix.curators.map((cu): HeatRow => ({
          key: cu.id,
          label: cu.name,
          cells: matrix.chains.map((ch): HeatCell => {
            const cell = matrix.cells[cu.id]?.[ch.slug];
            return {
              key: ch.slug,
              content: cell ? usdC(cell.tvl) : '·',
              intensity: cell ? cell.tvl / maxTvl : null,
              dimText: !cell,
              tooltip: cell ? (
                <div>
                  <div className="uppercase tracking-header-medium text-text-primary">{cu.name} · {ch.name}</div>
                  <div className="mt-1 tabular-nums">{usdC(cell.tvl)} TVL</div>
                  <div className="tabular-nums">{cell.vaultCount} vault{cell.vaultCount === 1 ? '' : 's'} · {(cell.pctOfGlobal * 100).toFixed(0)}% of global TVL</div>
                </div>
              ) : (
                <div className="text-text-muted">{cu.name} has no vaults on {ch.name}</div>
              ),
            };
          }),
        }))}
      />
    </section>
  );
}

// ---------- Section 7 ----------
function AllChainsTable({ rows }: { rows: ChainsTableExpandedRow[] }) {
  const router = useRouter();
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-small uppercase tracking-header-wide text-accent">All Chains</h2>
      <p className="mt-0.5 mb-3 text-tiny text-text-secondary">Click any row to open that chain&apos;s detail page.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Chain</Th><Th r>Active Loans</Th><Th r>30d Δ</Th><Th r>Borrow Interest</Th><Th r>NIM</Th>
              <Th r>Utilization</Th><Th r>Curator Fees</Th><Th r>Total Deposits</Th><Th r dim>TVL</Th><Th r># Markets</Th><Th r dim>12mo Δ pp</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.chainSlug}
                onClick={() => router.push(`/chains/${r.chainSlug.toLowerCase()}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-hover-overlay"
              >
                <td className="py-2 uppercase tracking-header-medium text-text-primary whitespace-nowrap">
                  <Link href={`/chains/${r.chainSlug.toLowerCase()}`} className="hover:text-accent" onClick={(e) => e.stopPropagation()}>{r.chainName}</Link>
                </td>
                <td className="py-2 text-right tabular-nums text-text-primary">{usdC(r.activeLoans)}</td>
                <td className={`py-2 text-right tabular-nums ${deltaClass(r.activeLoans30dDeltaPct)}`}>{signedPct(r.activeLoans30dDeltaPct)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.borrowInterest)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{bps(r.nim)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{pct1(r.utilization)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.curatorFees)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{usdC(r.totalDeposits)}</td>
                <td className="py-2 text-right tabular-nums text-text-muted">{usdC(r.tvl)}</td>
                <td className="py-2 text-right tabular-nums text-text-secondary">{r.marketCount}</td>
                <td className={`py-2 text-right tabular-nums ${deltaClass(r.share12moDeltaPp)}`}>{r.share12moDeltaPp == null ? 'N/A' : `${r.share12moDeltaPp >= 0 ? '+' : ''}${r.share12moDeltaPp.toFixed(1)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-tiny uppercase tracking-header-medium text-text-muted">Sorted by active loans · TVL &amp; 12mo Δ pp kept for sector compatibility</p>
    </section>
  );
}

function deltaClass(v: number | null): string {
  if (v == null) return 'text-text-muted';
  return v >= 0 ? 'text-positive' : 'text-negative';
}

function Th({ children, r, dim }: { children: React.ReactNode; r?: boolean; dim?: boolean }) {
  return (
    <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium ${dim ? 'text-text-muted/60' : 'text-text-muted'} ${r ? 'text-right pl-2' : ''} whitespace-nowrap`}>{children}</th>
  );
}

// ---------- Section 9 ----------
function Methodology({ asOfDate }: { asOfDate: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-3 text-small text-text-secondary leading-relaxed">
      <h2 className="text-small uppercase tracking-header-wide text-accent">Methodology</h2>
      <p>
        This dashboard analyzes Morpho the way a credit analyst would analyze a bank. Leading with active loans (the
        earning assets), borrow interest flows (income), and net interest margin (spread). TVL is shown where useful for
        sector comparison but is not the primary metric. Framing per Stani Kulechov, Aave founder, late 2025.
      </p>
      <p>
        Sources: Morpho GraphQL market &amp; vault state (snapshotted daily into Neon), DefiLlama per-protocol per-chain
        TVL for the lending-sector denominator, and DefiLlama yields for Aave V3 comparison rates. APYs are clamped below
        100% to neutralize bad-oracle and dust-market outliers.
      </p>
      <p>
        Updated every 15 minutes from the latest daily snapshot (as of {asOfDate}). Full metric definitions and caveats
        live at <Link href="/methodology" className="text-accent hover:underline">/methodology</Link>.
      </p>
    </section>
  );
}

import type { Metadata } from 'next';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Methodology · Morpho Research Terminal',
  description:
    'How every metric on the Morpho Research Terminal is computed: data sources, metric definitions, methodological choices, known limitations, and citation.',
};

// Static, query-free server component. The intellectual anchor of the dashboard:
// the page a researcher clicks through to from a report to check the receipts.

function Section({ n, title, id, children }: { n: string; title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-border pt-8">
      <h2 className="mb-4 text-small uppercase tracking-header-wide text-accent">
        <span className="text-text-muted">{n}.</span> {title}
      </h2>
      <div className="space-y-3 text-body leading-relaxed text-text-secondary">{children}</div>
    </section>
  );
}

function Sub({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="mt-5 text-tiny uppercase tracking-header-medium text-text-primary">
        <span className="text-text-muted">{id}</span> {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const Term = ({ children }: { children: React.ReactNode }) => (
  <span className="text-text-primary">{children}</span>
);
const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="text-text-primary">{children}</code>
);

function Def({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <p>
      <Term>{term}:</Term> {children}
    </p>
  );
}

const SOURCES: { source: string; provides: string; cadence: string; auth: string }[] = [
  { source: 'Morpho GraphQL API (blue-api.morpho.org)', provides: 'Markets, vaults, curators, asset metadata, historical state', cadence: 'Every 6 hours', auth: 'None' },
  { source: 'DefiLlama protocol API', provides: 'Protocol-level TVL, fees, revenue across chains', cadence: 'Every 6 hours', auth: 'None' },
  { source: 'DefiLlama yields API', provides: 'Competitor supply and borrow APYs', cadence: 'Every 6 hours', auth: 'None' },
  { source: 'FRED (Federal Reserve Economic Data)', provides: '3-month T-bill rate for risk-free benchmark', cadence: 'Daily', auth: 'API key required' },
];

const LIMITATIONS = [
  'Vault allocation breakdowns infer asset class from the vault deposit asset symbol rather than market-level allocations. True per-market vault exposure lives in vault_allocations_daily, which is empty as of this writing. The backfill is planned but not run.',
  'Curator revenue attribution maps roughly 26% of vault performance fees to named curators via fee_recipient_address. The remaining 74% routes to addresses not present in Morpho’s curator metadata and surfaces as "UNATTRIBUTED" in the revenue leaderboard. The total revenue is preserved; the attribution gap is real and reflects incomplete public mappings.',
  'Today’s row for chain_lending_tvl_daily may show artificially low values if DefiLlama has not yet indexed long-tail protocols for the current day. The carry-forward semantic in section 4.1 mitigates this, but the most recent 24 hours can still be conservative.',
  'Curator fees are realized in vault shares, not USD. The USD-marked revenue figures move with share price. Multi-day averages are more reliable than spot snapshots.',
  'FRED T-bill rate data may be empty if the sync key is not configured. The real yield spread KPI falls back to a placeholder when this happens.',
  'Bad debt detection is snapshot-based. A market may carry transient bad debt during liquidation processing that resolves within hours but registers in historical event data.',
];

const CHANGELOG = [
  '2026-05-31: Initial release.',
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-16">
      <header>
        <h1 className="text-[28px] uppercase tracking-header-medium leading-none text-text-primary">Methodology</h1>
        <p className="mt-3 text-body leading-relaxed text-text-secondary">
          How every number on this terminal is computed, sourced, and qualified. If a figure in a research report links here,
          this page is the receipt.
        </p>
      </header>

      {/* 1 */}
      <Section n="1" title="What this dashboard is">
        <p>
          The Morpho Research Terminal is a read-only analytics surface for Morpho and the MetaMorpho vault layer across
          every chain Morpho is live on. It is built for lending researchers, allocators, and analysts who need defensible
          numbers with their derivations attached. It is not an operator console: it does not place orders, manage positions,
          or surface wallet-level activity, and it is not affiliated with Morpho Labs.
        </p>
        <p>
          The analytical lens treats Morpho as a lending sector in its own right. Chains are its primary components and curators
          its secondary ones, the way a banking system is read through its regional banks and asset managers. That framing is
          what separates this dashboard from operator-facing tools like data.morpho.org, which answer "what is happening in this
          market right now." This dashboard answers "how large is the loan book, who runs it, what does it earn, and how does it
          sit against the rest of the sector."
        </p>
        <p>
          The headline metrics follow from that lens. Active loans, borrow interest, and net interest margin lead. Total value
          locked is shown where it aids comparison with other dashboards, but it never sits at the top of a page.
        </p>
        <p className="border-l-2 border-accent pl-4 text-text-secondary">
          Per a framing principle articulated by Stani Kulechov in late 2025 and adopted across Datum Labs research dashboards,
          lending protocols are analyzed by their loan books and interest flows rather than by net asset position (TVL) alone.
        </p>
      </Section>

      {/* 2 */}
      <Section n="2" title="Data sources" id="data-sources">
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-tiny uppercase tracking-header-medium text-text-muted">
                <th className="border-b border-border py-2 pr-4 font-normal">Source</th>
                <th className="border-b border-border px-4 py-2 font-normal">What it provides</th>
                <th className="border-b border-border px-4 py-2 font-normal">Update cadence</th>
                <th className="border-b border-border py-2 pl-4 font-normal">Authentication</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((s) => (
                <tr key={s.source} className="align-top">
                  <td className="border-b border-border py-2.5 pr-4 text-text-primary">{s.source}</td>
                  <td className="border-b border-border px-4 py-2.5 text-text-secondary">{s.provides}</td>
                  <td className="border-b border-border px-4 py-2.5 tabular-nums text-text-secondary">{s.cadence}</td>
                  <td className="border-b border-border py-2.5 pl-4 text-text-secondary">{s.auth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4">
          A Cloudflare Worker reads from these sources on a schedule and writes normalized rows to a Neon Postgres database. The
          web application reads from Neon only. It does not call any external API at render time, so a page load never depends on
          a third-party service being up.
        </p>

        <Sub id="2.1" title="Data lineage: from source to figure">
          <p>
            Every market and vault number on this terminal traces through four stages. There is no manual entry and no
            estimation at any step:
          </p>
          <ol className="ml-1 space-y-1.5">
            <li>
              <Term>1. Source.</Term> The Cloudflare Worker queries the Morpho GraphQL API at{' '}
              <Mono>blue-api.morpho.org/graphql</Mono> every six hours, paginating the top markets by supply and the top vaults
              by assets. The exact fields pulled per market are <Mono>borrowAssetsUsd</Mono>, <Mono>supplyAssetsUsd</Mono>,{' '}
              <Mono>collateralAssetsUsd</Mono>, <Mono>borrowApy</Mono>, and <Mono>supplyApy</Mono>; per vault,{' '}
              <Mono>totalAssetsUsd</Mono>, <Mono>apy</Mono>, and <Mono>fee</Mono>.
            </li>
            <li>
              <Term>2. Snapshot.</Term> Each field is written verbatim to a dated row in <Mono>market_state_daily</Mono> or{' '}
              <Mono>vault_state_daily</Mono>. The Worker does not transform the values; it only normalizes types (BigInt to text,
              fee fraction to basis points) and stamps the UTC date.
            </li>
            <li>
              <Term>3. Aggregation.</Term> At render time the web app reads the latest snapshot per market or vault and applies
              the formulas in section 3 directly in SQL. The relevant query lives in <Mono>lib/queries/chains.ts</Mono>
              (<Mono>getChainEconomicsMatrix</Mono>). Borrow Interest, NIM, and Curator Fees are computed there and nowhere else.
            </li>
            <li>
              <Term>4. Render.</Term> The figure is formatted for display. No rounding occurs before aggregation, so totals
              reconcile to the source.
            </li>
          </ol>
        </Sub>

        <Sub id="2.2" title="Source authority and accuracy">
          <p>
            <Term>Is the source authoritative?</Term> The Morpho GraphQL API is Morpho Labs’ own indexer, the same backend that
            serves the official app.morpho.org interface. It is the canonical reference for on-chain Morpho state, not a
            third-party reconstruction. USD values are Morpho’s own price-feed marks at query time.
          </p>
          <p>
            <Term>Is our stored copy faithful?</Term> A standing reconciliation re-fetches the live API and compares it against
            the stored snapshot the dashboard renders, per chain, for Active Loans, Borrow Interest, NIM, and Curator Fees. At
            the most recent check the Morpho-wide totals were Active Loans of <Mono>$3.73B</Mono> (live and stored agreeing to
            within 0.1%) and Borrow Interest of roughly <Mono>$185M</Mono> annualized. Per-chain Active Loans matched within
            about 1-2%; that small gap is intraday drift between the last six-hour sync and the live moment, not a
            methodological difference. The Morpho-wide Active Loans figure also matches Morpho’s publicly reported loan book.
          </p>
          <p>
            Because the dashboard reads a snapshot rather than calling the API live, displayed figures lag the source by at most
            one sync interval (six hours). Interest and fee figures, which scale with APY, drift slightly more than balance
            figures between syncs because APYs move continuously. Multi-day context is therefore more reliable than any single
            spot reading. The footer of every page shows the exact snapshot timestamp.
          </p>
        </Sub>
      </Section>

      {/* 3 */}
      <Section n="3" title="Metric definitions">
        <Sub id="3.1" title="Active loans and related supply-side metrics">
          <Def term="Active Loans"><Mono>{'Σ'} borrow_assets_usd</Mono> across all Morpho markets, latest day.</Def>
          <Def term="Total Deposits"><Mono>{'Σ'} supply_assets_usd</Mono> plus <Mono>{'Σ'} collateral_assets_usd</Mono>. The gross size of capital locked in the protocol.</Def>
          <Def term="Total Supply"><Mono>{'Σ'} supply_assets_usd</Mono>. The loan-asset side only, excluding collateral.</Def>
          <Def term="TVL">Total Deposits minus Active Loans. Matches Morpho’s published dashboard and DefiLlama. Used for sector compatibility; not the primary headline metric on this dashboard.</Def>
          <Def term="Utilization">Active Loans divided by Total Deposits.</Def>
          <Def term="Available Liquidity">Total Deposits minus Active Loans. Numerically identical to TVL.</Def>
        </Sub>

        <Sub id="3.2" title="Interest flow metrics">
          <Def term="Borrow Interest (Annualized)"><Mono>{'Σ'} borrow_assets_usd {'×'} min(borrow_apy, 1.0)</Mono>. The dollars borrowers pay per year across the protocol.</Def>
          <Def term="Lender Yield (Annualized)"><Mono>{'Σ'} supply_assets_usd {'×'} min(supply_apy, 1.0)</Mono>. The dollars lenders receive per year.</Def>
          <Def term="Curator Fees (Annualized)"><Mono>{'Σ'} vault.total_assets_usd {'×'} min(vault.apy, 1.0) {'×'} vault.fee</Mono>. The dollars retained by curators per year as performance fees.</Def>
          <Def term="Net Interest Margin (NIM)">weighted_borrow_apy minus weighted_supply_apy, in basis points. The spread between borrower cost and lender return, defining lending profitability.</Def>
        </Sub>

        <Sub id="3.3" title="Curator metrics">
          <Def term="AUM">vault total_assets_usd, summed per curator. Treats curators as asset managers; AUM is the assets under their curation.</Def>
          <Def term="Fee Take Rate">Curator Fees divided by Borrow Interest Captured. The share of borrower-paid yield the curator retains as fees.</Def>
          <Def term="Net APY Delivered">weighted average vault net_apy across the curator’s book.</Def>
          <Def term="CR3, CR5">combined market share of the top 3 and top 5 curators by AUM. Used to summarize concentration.</Def>
          <Def term="HHI (Herfindahl-Hirschman Index)"><Mono>{'Σ'} (share){'²'} {'×'} 10,000</Mono> across all curators. Per US Department of Justice thresholds, HHI above 2,500 indicates a highly concentrated market.</Def>
        </Sub>

        <Sub id="3.4" title="Risk metrics">
          <Def term="LLTV">liquidation loan-to-value ratio per market, set at market creation, immutable.</Def>
          <Def term="Risk Score"><Mono>supply_usd {'×'} utilization {'×'} LLTV</Mono>. Used to rank markets by potential blast-radius. Higher scores indicate larger, more fully utilized, higher-LLTV positions.</Def>
          <Def term="Bad Debt"><Mono>max(0, {'Σ'} borrow_assets_usd minus {'Σ'} supply_assets_usd)</Mono> per market. Markets where outstanding borrows exceed supplied capital.</Def>
          <Def term="Stressed Markets">count of markets above 90% utilization.</Def>
        </Sub>

        <Sub id="3.5" title="Sector-level metrics">
          <Def term="Chain Lending TVL">sum of TVL across every protocol DefiLlama categorizes as &lsquo;Lending&rsquo; or &lsquo;CDP&rsquo; on that chain. Used as the denominator for Morpho’s per-chain share.</Def>
          <Def term="Morpho Share of Lending">Morpho TVL on a chain divided by Chain Lending TVL on that chain.</Def>
          <Def term="Real Yield Spread">Morpho’s volume-weighted stablecoin supply APY minus the 3-month T-bill rate from FRED. Available when FRED data is current.</Def>
        </Sub>
      </Section>

      {/* 4 */}
      <Section n="4" title="Methodological choices">
        <Sub id="4.1" title="Carry-forward semantics for lending denominators">
          <p>
            Many DefiLlama-indexed protocols update their TVL with a one-day lag, particularly long-tail lenders. A strict
            <Mono> snapshot_date GROUP BY</Mono> produces denominators that systematically understate yesterday’s number. This dashboard
            computes each protocol’s latest TVL within a trailing seven-day window before aggregating, mirroring the carry-forward
            semantic standard in TVL analytics.
          </p>
        </Sub>
        <Sub id="4.2" title="Per-protocol latest within seven days for chain competitor stacks">
          <p>
            The same logic applies when ranking competitors on a chain. Strict <Mono>max(snapshot_date)</Mono> drops protocols whose most
            recent indexing is older than the freshest reporter. The seven-day window includes Moonwell on Base, Hyperlend on
            Hyperliquid, and other chain-native lenders that would otherwise be invisible.
          </p>
        </Sub>
        <Sub id="4.3" title="Exclusion of degenerate IRM markets from rate aggregations">
          <p>
            Roughly 120 Morpho markets have interest rate models that produce non-economic APYs above 100% under saturated
            utilization. The BONDUSD/USR market on Ethereum, for example, has shown supply APY of 41,829% during liquidation
            periods. Including these in weighted averages produces meaningless aggregate rates. This dashboard excludes any
            market whose supply APY or borrow APY exceeds 100% from all weighted rate computations. The count of excluded markets
            is surfaced below the relevant charts. The risk surface table deliberately keeps these markets visible because their
            blast-radius is real even when their reported yields are not.
          </p>
        </Sub>
        <Sub id="4.4" title="SUM grouped by collateral, not MAX per market">
          <p>
            The "largest collateral asset" headline KPI computes <Mono>{'Σ'} collateral_assets_usd</Mono> grouped by collateral asset symbol,
            then takes the largest. Earlier versions of this query took MAX per market, which produced BONDUSD as the headline
            largest collateral. BONDUSD is a single phantom market with null collateral data sorted incorrectly via the Postgres
            NULLS FIRST default. The corrected query produces cbBTC as the largest, at roughly $3B across 30 markets.
          </p>
        </Sub>
        <Sub id="4.5" title="Stani-inspired metric hierarchy">
          <p>
            TVL is shown where useful for sector compatibility. It is not the primary headline metric on any page. Active loans,
            borrow interest, and net interest margin lead instead. This follows the framing principle that lending protocols
            should be analyzed like banks: by loan book size and interest flows, not by net asset position. The framing is
            borrowed; the vocabulary stays DeFi-native.
          </p>
        </Sub>
        <Sub id="4.6" title="Asset categorization">
          <p>
            Asset class assignment uses an inline classifier with manual mappings for the 100 most prevalent symbols on Morpho.
            Classes include stablecoin, LST, LRT, BTC, ETH, RWA, and other. PT- prefixed tokens (Pendle principal tokens) inherit
            the class of their underlying. New symbols above $10 million in supply trigger a warning in the maintenance log and
            appear in the uncategorized panel on /assets. The full classification list is documented in <Mono>lib/queries/assets.ts</Mono>.
          </p>
        </Sub>
      </Section>

      {/* 5 */}
      <Section n="5" title="Known limitations">
        <ul className="space-y-3">
          {LIMITATIONS.map((l, i) => (
            <li key={i} className="flex gap-3">
              <span className="select-none text-accent">{'›'}</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6 */}
      <Section n="6" title="Citation">
        <p>To cite this dashboard in research output, use the plain-text format:</p>
        <p className="rounded-md border border-border bg-surface p-4 text-small text-text-primary">
          Datum Labs. (2026). Morpho Research Terminal. Retrieved {'{date}'} from datumlab.xyz/morpho-terminal/{'{page}'}.
        </p>
        <p>
          For a specific page, append the page slug. For a specific finding, include the snapshot date visible in the page
          footer.
        </p>
      </Section>

      {/* 7 */}
      <Section n="7" title="Changelog">
        <ul className="space-y-1.5 text-small">
          {CHANGELOG.map((c, i) => {
            const [date, ...rest] = c.split(': ');
            return (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 tabular-nums text-text-muted">{date}</span>
                <span className="text-text-secondary">{rest.join(': ')}</span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

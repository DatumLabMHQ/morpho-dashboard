// Chains-surface queries. All cached via unstable_cache (15 min revalidate) per
// the build spec. Numbers come from Neon only. No external fetches at render time.
//
// We anchor "latest" to yesterday (MAX(snapshot_date) - 1 day) because the
// current day's chain_lending_tvl_daily is artificially low: DefiLlama indexes
// long-tail protocols with ~1-day lag, so the day-strict rebuild SQL
// undercounts today's denominator. Yesterday is fully populated.

import { unstable_cache } from 'next/cache';

import { type AssetClass, ASSET_CLASS_ORDER, categorizeAsset } from '../assets/asset-class.js';
import { tokens } from '../brand/tokens.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'chains-v4';
// Loan-book-first surfaces (Part B) get their own cache namespace so the legacy
// share-of-TVL payload above can keep its key.
const LB_CACHE_VERSION = 'chains-loanbook-v3';
const REVALIDATE_SECONDS = 900;
const ELIGIBLE_TVL_THRESHOLD = 50_000_000;       // $50M peak
const SERIES_START_DATE = '2024-06-01';

// Brand-aligned chain coloring. Base + Ethereum highlighted with the same
// hues as the Lending Terminal's accent + accent-secondary; long tail in
// muted "border-bright" grey.
export const BASE_COLOR = tokens.colors.accent;             // #ff8155
export const ETH_COLOR = tokens.colors.accentSecondary;     // #b97aff
export const OTHER_COLOR = 'hsla(0, 0%, 100%, 0.22)';       // muted grey

// ---------- Types ----------

export interface ChainMetaRow {
  chainSlug: string;
  chainName: string;
  color: string;
  isHighlighted: boolean;
  peakMorphoTvl: number;
}

export interface SharePoint {
  date: string;              // YYYY-MM-DD
  [chainKey: string]: string | number | undefined;
}

export interface ChainsTableRow {
  chainSlug: string;
  chainName: string | null;
  morphoTvlUsd: number;
  chainLendingTvlUsd: number;
  morphoShare: number;
  share12moAgo: number | null;
  deltaPp: number | null;
}

export interface LatestChainSummary {
  asOfDate: string;
  base?: { current: number; ago12mo: number | null };
  ethereum?: { current: number; ago12mo: number | null };
}

export interface ChainsPagePayload {
  asOfDate: string;
  chains: ChainMetaRow[];
  series: SharePoint[];
  table: ChainsTableRow[];
  summary: LatestChainSummary;
  subtitle: string;
}

// ---------- Helpers ----------

function pickColor(slug: string): { color: string; highlighted: boolean } {
  if (slug === 'Base') return { color: BASE_COLOR, highlighted: true };
  if (slug === 'Ethereum') return { color: ETH_COLOR, highlighted: true };
  return { color: OTHER_COLOR, highlighted: false };
}

function pct1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'N/A';
  return `${(v * 100).toFixed(1)}%`;
}

// ---------- The one query that drives the page ----------

export const getChainsPagePayload = unstable_cache(
  async (): Promise<ChainsPagePayload> => {
    const sql = getDb();

    const latestRows = (await sql`
      SELECT (MAX(snapshot_date) - INTERVAL '1 day')::text AS as_of
      FROM morpho_.chain_lending_tvl_daily
    `) as { as_of: string }[];
    const asOfDate = latestRows[0]!.as_of;

    const eligibleRows = (await sql`
      SELECT
        chain_slug,
        MAX(tvl_usd)::float8 AS peak
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue'
        AND snapshot_date >= ${SERIES_START_DATE}::date
        AND snapshot_date <= ${asOfDate}::date
      GROUP BY chain_slug
      HAVING MAX(tvl_usd) > ${ELIGIBLE_TVL_THRESHOLD}
      ORDER BY peak DESC
    `) as { chain_slug: string; peak: number }[];

    const eligibleSlugs = eligibleRows.map((r) => r.chain_slug);
    if (eligibleSlugs.length === 0) return emptyPayload(asOfDate);

    const namesMap = await getChainNames(sql, eligibleSlugs);

    const chains: ChainMetaRow[] = eligibleRows
      .map((r) => {
        const { color, highlighted } = pickColor(r.chain_slug);
        return {
          chainSlug: r.chain_slug,
          chainName: namesMap.get(r.chain_slug) ?? r.chain_slug,
          color,
          isHighlighted: highlighted,
          peakMorphoTvl: r.peak,
        };
      })
      .sort((a, b) => {
        const orderA = a.chainSlug === 'Base' ? 0 : a.chainSlug === 'Ethereum' ? 1 : 2;
        const orderB = b.chainSlug === 'Base' ? 0 : b.chainSlug === 'Ethereum' ? 1 : 2;
        if (orderA !== orderB) return orderA - orderB;
        return b.peakMorphoTvl - a.peakMorphoTvl;
      });

    const seriesRows = (await sql`
      SELECT
        m.snapshot_date::text                                                  AS date,
        m.chain_slug,
        CASE WHEN l.lending_tvl_usd > 0
             THEN (m.tvl_usd::numeric / l.lending_tvl_usd)::float8
             ELSE NULL END                                                      AS share
      FROM morpho_.protocol_tvl_daily m
      JOIN morpho_.chain_lending_tvl_daily l
        ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
      WHERE m.protocol_slug = 'morpho-blue'
        AND m.chain_slug = ANY(${eligibleSlugs}::text[])
        AND m.snapshot_date >= ${SERIES_START_DATE}::date
        AND m.snapshot_date <= ${asOfDate}::date
      ORDER BY m.snapshot_date ASC
    `) as { date: string; chain_slug: string; share: number | null }[];

    const byDate = new Map<string, SharePoint>();
    for (const r of seriesRows) {
      let point = byDate.get(r.date);
      if (!point) {
        point = { date: r.date };
        byDate.set(r.date, point);
      }
      if (r.share != null) point[r.chain_slug] = r.share;
    }
    const series: SharePoint[] = [...byDate.values()].sort((a, b) =>
      (a.date as string).localeCompare(b.date as string),
    );

    const tableRows = (await sql`
      WITH latest AS (
        SELECT
          m.chain_slug,
          m.tvl_usd::float8                                                    AS morpho_tvl,
          l.lending_tvl_usd::float8                                            AS lending_tvl,
          (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8          AS share
        FROM morpho_.protocol_tvl_daily m
        JOIN morpho_.chain_lending_tvl_daily l
          ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
        WHERE m.protocol_slug = 'morpho-blue'
          AND m.snapshot_date = ${asOfDate}::date
          AND m.chain_slug = ANY(${eligibleSlugs}::text[])
      ),
      ago AS (
        SELECT DISTINCT ON (m.chain_slug)
          m.chain_slug,
          (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8          AS share
        FROM morpho_.protocol_tvl_daily m
        JOIN morpho_.chain_lending_tvl_daily l
          ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
        WHERE m.protocol_slug = 'morpho-blue'
          AND m.chain_slug = ANY(${eligibleSlugs}::text[])
          AND m.snapshot_date <= (${asOfDate}::date - INTERVAL '365 days')
        ORDER BY m.chain_slug, m.snapshot_date DESC
      )
      SELECT
        latest.chain_slug,
        latest.morpho_tvl,
        latest.lending_tvl,
        latest.share,
        ago.share                                                              AS share_12mo_ago
      FROM latest LEFT JOIN ago USING (chain_slug)
      ORDER BY latest.morpho_tvl DESC
    `) as {
      chain_slug: string;
      morpho_tvl: number;
      lending_tvl: number;
      share: number | null;
      share_12mo_ago: number | null;
    }[];

    const table: ChainsTableRow[] = tableRows.map((r) => ({
      chainSlug: r.chain_slug,
      chainName: namesMap.get(r.chain_slug) ?? null,
      morphoTvlUsd: r.morpho_tvl,
      chainLendingTvlUsd: r.lending_tvl,
      morphoShare: r.share ?? 0,
      share12moAgo: r.share_12mo_ago,
      deltaPp:
        r.share != null && r.share_12mo_ago != null
          ? (r.share - r.share_12mo_ago) * 100
          : null,
    }));

    const baseRow = table.find((r) => r.chainSlug === 'Base');
    const ethRow = table.find((r) => r.chainSlug === 'Ethereum');
    const summary: LatestChainSummary = {
      asOfDate,
      base: baseRow
        ? { current: baseRow.morphoShare, ago12mo: baseRow.share12moAgo }
        : undefined,
      ethereum: ethRow
        ? { current: ethRow.morphoShare, ago12mo: ethRow.share12moAgo }
        : undefined,
    };

    const parts: string[] = [];
    if (summary.base) {
      const ago = summary.base.ago12mo != null
        ? `vs ${pct1(summary.base.ago12mo)} 12 months ago`
        : 'no 12mo baseline';
      parts.push(`Base: ${pct1(summary.base.current)} (${ago})`);
    }
    if (summary.ethereum) {
      const ago = summary.ethereum.ago12mo != null
        ? `vs ${pct1(summary.ethereum.ago12mo)} 12 months ago`
        : 'no 12mo baseline';
      parts.push(`Ethereum: ${pct1(summary.ethereum.current)} (${ago})`);
    }
    const subtitle = parts.join(' · ');

    return { asOfDate, chains, series, table, summary, subtitle };
  },
  [CACHE_VERSION, 'page-payload'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

async function getChainNames(
  sql: ReturnType<typeof getDb>,
  slugs: string[],
): Promise<Map<string, string>> {
  const rows = (await sql`
    SELECT slug, name FROM morpho_.chains WHERE slug = ANY(${slugs}::text[])
  `) as { slug: string; name: string }[];
  return new Map(rows.map((r) => [r.slug, r.name]));
}

function emptyPayload(asOfDate: string): ChainsPagePayload {
  return {
    asOfDate,
    chains: [],
    series: [],
    table: [],
    summary: { asOfDate },
    subtitle: '',
  };
}

// ===========================================================================
// PART B. Loan-book-first surfaces for the /chains redesign.
//
// Metric vocabulary (see the build spec. These labels are canonical):
//   Active Loans              = Σ borrow_assets_usd
//   Borrow Interest (Ann.)    = Σ borrow_assets_usd × LEAST(borrow_apy, 1.0)
//   Net Interest Margin (NIM) = weighted borrow APY − weighted supply APY
//   Utilization               = Σ borrows ÷ Total Deposits
//   Total Deposits            = Σ supply_assets_usd + Σ collateral_assets_usd
//   Total Supply              = Σ supply_assets_usd
//   TVL                       = Total Deposits − Active Loans
//   Curator Fees (Ann.)       = Σ vault.total_assets_usd × apy × fee
// APYs are clamped to <1.0 everywhere; LENDING_PROTOCOLS is global-only.
// ===========================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// neon's HTTP client exposes no `.query()`; to run a parameterless raw SQL
// string we hand the tag a synthetic TemplateStringsArray (one chunk, no
// values). Only ever pass trusted, literal SQL here. Never user input.
function rawQuery(sql: ReturnType<typeof getDb>, q: string): Promise<unknown> {
  const tag = sql as unknown as (s: TemplateStringsArray) => Promise<unknown>;
  return tag(Object.assign([q], { raw: [q] }) as unknown as TemplateStringsArray);
}

// ---------- Shared metric math ----------

/** 30-day growth as a fraction (e.g. 0.25 = +25%). null when no baseline. */
function growth30d(now: number, ago: number | null): number | null {
  if (ago == null || ago <= 0) return null;
  return (now - ago) / ago;
}

/**
 * Active-loan doubling time in DAYS: 30 × ln(2) / ln(1 + 30d_growth_rate).
 * Returns null when shrinking/flat (caller renders "N/A") and clamps the display
 * ceiling at 1000 (caller renders "1000+").
 */
function doublingTimeDays(growthRate: number | null): number | null {
  if (growthRate == null || growthRate <= 0) return null;
  const periods = Math.log(2) / Math.log(1 + growthRate); // in 30-day periods
  const days = periods * 30;
  if (!Number.isFinite(days) || days <= 0) return null;
  return days;
}

// ---------- Core per-chain economics ----------

export interface ChainEconomics {
  chainSlug: string;
  chainName: string;
  activeLoans: number;
  borrowInterest: number;        // annualized
  totalSupply: number;
  totalCollateral: number;
  totalDeposits: number;
  tvl: number;
  nim: number | null;            // weighted borrow APY − weighted supply APY
  weightedBorrowApy: number | null;
  weightedSupplyApy: number | null;
  utilization: number | null;    // active loans ÷ total deposits
  curatorFees: number;           // annualized
  marketCount: number;
  activeLoans30dAgo: number | null;
  activeLoans30dDeltaPct: number | null;
  doublingTimeDays: number | null;
}

const ECON_SQL = `
  WITH ls AS (
    SELECT m.chain_id,
           s.borrow_assets_usd::float8        AS b,
           s.supply_assets_usd::float8        AS sup,
           s.collateral_assets_usd::float8    AS col,
           LEAST(s.borrow_apy, 1.0)::float8   AS bapy,
           LEAST(s.supply_apy, 1.0)::float8   AS sapy
    FROM morpho_.markets m
    JOIN LATERAL (
      SELECT * FROM morpho_.market_state_daily x
      WHERE x.market_unique_key = m.unique_key
      ORDER BY x.snapshot_date DESC LIMIT 1
    ) s ON TRUE
    -- Drop bad-oracle markets entirely: an APY above 100% means the price feed
    -- is broken, which also inflates the USD figures (a single BONDUSD/USR
    -- market reported $9B of "loans"). Excluding them reconciles every chain to
    -- Morpho's official loans-by-chain numbers within ~2%.
    WHERE (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
      AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
  ),
  cur AS (
    SELECT chain_id,
      COALESCE(SUM(b), 0)::float8                                   AS active_loans,
      COALESCE(SUM(b * bapy), 0)::float8                            AS borrow_interest,
      COALESCE(SUM(sup), 0)::float8                                 AS total_supply,
      COALESCE(SUM(col), 0)::float8                                 AS total_collateral,
      COALESCE(SUM(sup * sapy), 0)::float8                          AS supply_interest,
      COUNT(*) FILTER (WHERE b > 0 OR sup > 0)::int                 AS market_count
    FROM ls GROUP BY chain_id
  ),
  ls30 AS (
    SELECT m.chain_id, s.b
    FROM morpho_.markets m
    JOIN LATERAL (
      SELECT borrow_assets_usd::float8 AS b, borrow_apy, supply_apy FROM morpho_.market_state_daily x
      WHERE x.market_unique_key = m.unique_key
        AND x.snapshot_date <= (CURRENT_DATE - INTERVAL '30 days')
      ORDER BY x.snapshot_date DESC LIMIT 1
    ) s ON TRUE
    WHERE (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
      AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
  ),
  prev AS (
    SELECT chain_id, COALESCE(SUM(b), 0)::float8 AS active_loans_30 FROM ls30 GROUP BY chain_id
  ),
  vf AS (
    SELECT v.chain_id,
      COALESCE(SUM(
        s.total_assets_usd * LEAST(COALESCE(s.apy, 0), 1.0) * (COALESCE(s.fee_bps, 0)::numeric / 10000)
      ), 0)::float8 AS curator_fees
    FROM morpho_.vaults v
    JOIN LATERAL (
      SELECT total_assets_usd, apy, fee_bps FROM morpho_.vault_state_daily x
      WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
      ORDER BY x.snapshot_date DESC LIMIT 1
    ) s ON TRUE
    WHERE (s.apy IS NULL OR s.apy <= 1.0)   -- drop bad-data vaults (apy > 100%)
    GROUP BY v.chain_id
  )
  SELECT ch.slug AS chain_slug, ch.name AS chain_name,
    cur.active_loans, cur.borrow_interest, cur.total_supply, cur.total_collateral,
    cur.supply_interest, cur.market_count,
    prev.active_loans_30,
    COALESCE(vf.curator_fees, 0)::float8 AS curator_fees
  FROM cur
  JOIN morpho_.chains ch ON ch.chain_id = cur.chain_id
  LEFT JOIN prev ON prev.chain_id = cur.chain_id
  LEFT JOIN vf   ON vf.chain_id   = cur.chain_id
  WHERE cur.active_loans > 0
  ORDER BY cur.active_loans DESC
`;

/** All chains with live Morpho borrowing, with the full metric set. Cached. */
export const getChainEconomicsMatrix = unstable_cache(
  async (): Promise<ChainEconomics[]> => {
    const sql = getDb();
    const rows = (await rawQuery(sql, ECON_SQL)) as {
      chain_slug: string; chain_name: string;
      active_loans: number; borrow_interest: number; total_supply: number;
      total_collateral: number; supply_interest: number; market_count: number;
      active_loans_30: number | null; curator_fees: number;
    }[];
    return rows.map((r) => {
      const totalDeposits = r.total_supply + r.total_collateral;
      const weightedBorrowApy = r.active_loans > 0 ? r.borrow_interest / r.active_loans : null;
      const weightedSupplyApy = r.total_supply > 0 ? r.supply_interest / r.total_supply : null;
      const nim = weightedBorrowApy != null && weightedSupplyApy != null
        ? weightedBorrowApy - weightedSupplyApy : null;
      const delta = growth30d(r.active_loans, r.active_loans_30);
      return {
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        activeLoans: r.active_loans,
        borrowInterest: r.borrow_interest,
        totalSupply: r.total_supply,
        totalCollateral: r.total_collateral,
        totalDeposits,
        tvl: totalDeposits - r.active_loans,
        nim,
        weightedBorrowApy,
        weightedSupplyApy,
        utilization: totalDeposits > 0 ? r.active_loans / totalDeposits : null,
        curatorFees: r.curator_fees,
        marketCount: r.market_count,
        activeLoans30dAgo: r.active_loans_30,
        activeLoans30dDeltaPct: delta,
        doublingTimeDays: doublingTimeDays(delta),
      };
    });
  },
  [LB_CACHE_VERSION, 'economics'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- Collateral class breakdown per chain (structural identity) ----------

export interface ChainClassCell {
  assetClass: AssetClass;
  usd: number;
  pct: number;          // of the chain's collateral
  marketCount: number;
}

export interface ChainStructuralRow {
  chainSlug: string;
  chainName: string;
  totalCollateral: number;
  byClass: Record<AssetClass, ChainClassCell>;
  topClass: AssetClass;
  topPct: number;
}

async function loadCollateralByChain(
  sql: ReturnType<typeof getDb>,
): Promise<Map<string, { name: string; rows: { symbol: string | null; usd: number; key: string }[] }>> {
  const rows = (await sql`
    SELECT ch.slug AS chain_slug, ch.name AS chain_name,
           m.collateral_asset_symbol AS symbol, m.unique_key AS key,
           s.collateral_assets_usd::float8 AS usd
    FROM morpho_.markets m
    JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
    JOIN LATERAL (
      SELECT collateral_assets_usd, borrow_apy, supply_apy FROM morpho_.market_state_daily x
      WHERE x.market_unique_key = m.unique_key
      ORDER BY x.snapshot_date DESC LIMIT 1
    ) s ON TRUE
    WHERE m.lltv IS NOT NULL AND m.lltv > 0
      AND m.collateral_asset_address IS NOT NULL
      AND m.collateral_asset_address <> ${ZERO_ADDRESS}
      AND s.collateral_assets_usd IS NOT NULL AND s.collateral_assets_usd > 0
      AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
      AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
  `) as { chain_slug: string; chain_name: string; symbol: string | null; key: string; usd: number }[];

  const byChain = new Map<string, { name: string; rows: { symbol: string | null; usd: number; key: string }[] }>();
  for (const r of rows) {
    if (!byChain.has(r.chain_slug)) byChain.set(r.chain_slug, { name: r.chain_name, rows: [] });
    byChain.get(r.chain_slug)!.rows.push({ symbol: r.symbol, usd: r.usd, key: r.key });
  }
  return byChain;
}

function emptyClassRecord(): Record<AssetClass, ChainClassCell> {
  const rec = {} as Record<AssetClass, ChainClassCell>;
  for (const c of ASSET_CLASS_ORDER) rec[c] = { assetClass: c, usd: 0, pct: 0, marketCount: 0 };
  return rec;
}

export const getStructuralIdentityMatrix = unstable_cache(
  async (): Promise<ChainStructuralRow[]> => {
    const sql = getDb();
    const [byChain, econ] = await Promise.all([loadCollateralByChain(sql), getChainEconomicsMatrix()]);
    const loanRank = new Map(econ.map((e, i) => [e.chainSlug, i] as const));

    const out: ChainStructuralRow[] = [];
    for (const [slug, { name, rows }] of byChain) {
      const byClass = emptyClassRecord();
      const seenKeys = new Map<AssetClass, Set<string>>();
      let total = 0;
      for (const r of rows) {
        const cls = categorizeAsset(r.symbol);
        byClass[cls].usd += r.usd;
        total += r.usd;
        if (!seenKeys.has(cls)) seenKeys.set(cls, new Set());
        seenKeys.get(cls)!.add(r.key);
      }
      let topClass: AssetClass = 'other';
      let topPct = 0;
      for (const c of ASSET_CLASS_ORDER) {
        byClass[c].pct = total > 0 ? byClass[c].usd / total : 0;
        byClass[c].marketCount = seenKeys.get(c)?.size ?? 0;
        if (byClass[c].pct > topPct) { topPct = byClass[c].pct; topClass = c; }
      }
      out.push({ chainSlug: slug, chainName: name, totalCollateral: total, byClass, topClass, topPct });
    }
    // Sort by active loans desc (chains absent from econ sink to the bottom).
    out.sort((a, b) => (loanRank.get(a.chainSlug) ?? 999) - (loanRank.get(b.chainSlug) ?? 999));
    return out;
  },
  [LB_CACHE_VERSION, 'structural'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- Headline KPIs (6 superlatives) ----------

export interface ChainSuperlative {
  key: string;
  label: string;
  chainSlug: string | null;
  chainName: string | null;
  caption: string;         // the metric value + context
}

export const getChainsHeadlineKpis = unstable_cache(
  async (): Promise<ChainSuperlative[]> => {
    const [econ, structural] = await Promise.all([
      getChainEconomicsMatrix(),
      getStructuralIdentityMatrix(),
    ]);
    if (econ.length === 0) return [];

    const totalActiveLoans = econ.reduce((s, e) => s + e.activeLoans, 0);
    const usdC = (v: number) => fmtUsdLocal(v);
    const pickMax = <T,>(arr: T[], val: (t: T) => number | null): T | null => {
      let best: T | null = null; let bestV = -Infinity;
      for (const t of arr) { const v = val(t); if (v != null && Number.isFinite(v) && v > bestV) { bestV = v; best = t; } }
      return best;
    };

    const largest = econ[0]!; // already sorted by active loans desc
    const fastest = pickMax(econ.filter((e) => e.activeLoans30dDeltaPct != null), (e) => e.activeLoans30dDeltaPct);
    const topInterest = pickMax(econ, (e) => e.borrowInterest);
    const topNim = pickMax(econ, (e) => e.nim);
    const topUtil = pickMax(econ, (e) => e.utilization);
    const mostConc = pickMax(structural, (s) => s.topPct);

    const out: ChainSuperlative[] = [
      {
        key: 'largest-active-loans',
        label: 'Largest Active Loans',
        chainSlug: largest.chainSlug, chainName: largest.chainName,
        caption: `${usdC(largest.activeLoans)} · ${(totalActiveLoans > 0 ? (largest.activeLoans / totalActiveLoans) * 100 : 0).toFixed(1)}% of Morpho-wide`,
      },
      {
        key: 'fastest-growth',
        label: 'Fastest Active-Loans Growth',
        chainSlug: fastest?.chainSlug ?? null, chainName: fastest?.chainName ?? null,
        caption: fastest?.activeLoans30dDeltaPct != null
          ? `+${(fastest.activeLoans30dDeltaPct * 100).toFixed(1)}% over 30d`
          : 'no 30d baseline',
      },
      {
        key: 'highest-borrow-interest',
        label: 'Highest Borrow Interest',
        chainSlug: topInterest?.chainSlug ?? null, chainName: topInterest?.chainName ?? null,
        caption: topInterest ? `${usdC(topInterest.borrowInterest)} annualized` : 'N/A',
      },
      {
        key: 'highest-nim',
        label: 'Highest NIM',
        chainSlug: topNim?.chainSlug ?? null, chainName: topNim?.chainName ?? null,
        caption: topNim?.nim != null ? `${Math.round(topNim.nim * 10000)} bps spread` : 'N/A',
      },
      {
        key: 'most-concentrated-collateral',
        label: 'Most Concentrated Collateral',
        chainSlug: mostConc?.chainSlug ?? null, chainName: mostConc?.chainName ?? null,
        caption: mostConc
          ? `${(mostConc.topPct * 100).toFixed(0)}% ${assetClassShortLabel(mostConc.topClass)}`
          : 'N/A',
      },
      {
        key: 'highest-utilization',
        label: 'Highest Utilization',
        chainSlug: topUtil?.chainSlug ?? null, chainName: topUtil?.chainName ?? null,
        caption: topUtil?.utilization != null ? `${(topUtil.utilization * 100).toFixed(1)}% loans ÷ deposits` : 'N/A',
      },
    ];
    return out;
  },
  [LB_CACHE_VERSION, 'headline-kpis'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- Active-loans-by-chain time series (4 metric toggles) ----------

export type ChainMetricKey = 'ACTIVE_LOANS' | 'BORROW_INTEREST' | 'NIM' | 'DEPOSITS' | 'TVL';

export interface ByChainSeriesPoint {
  date: string;
  [chainKey: string]: string | number | null;
}

export interface ActiveLoanSeriesPayload {
  defaultMetric: ChainMetricKey;
  topChains: { slug: string; name: string; color: string }[];
  /** Recharts-ready series per metric. Stacked metrics (ACTIVE_LOANS,
   *  BORROW_INTEREST, DEPOSITS) include an "Other" long-tail band; NIM/TVL are
   *  rendered as per-chain lines. */
  byMetric: Record<ChainMetricKey, ByChainSeriesPoint[]>;
  topChainLeader: { name: string; value: number; pct: number } | null;
}

const TOP_N_CHAINS = 8;

export const getActiveLoanByChainSeries = unstable_cache(
  async (metric: ChainMetricKey = 'ACTIVE_LOANS', days = 730): Promise<ActiveLoanSeriesPayload> => {
    const sql = getDb();
    const econ = await getChainEconomicsMatrix();
    if (econ.length === 0) {
      return { defaultMetric: metric, topChains: [], byMetric: { ACTIVE_LOANS: [], BORROW_INTEREST: [], NIM: [], DEPOSITS: [], TVL: [] }, topChainLeader: null };
    }
    const top = econ.slice(0, TOP_N_CHAINS);
    const topSlugs = new Set(top.map((e) => e.chainSlug));
    const palette = tokens.colors.chart;
    const topChains = top.map((e, i) => ({ slug: e.chainSlug, name: e.chainName, color: palette[i % palette.length]! }));

    const rows = (await sql`
      SELECT s.snapshot_date::text AS date, ch.slug AS chain_slug,
        SUM(s.borrow_assets_usd)::float8                              AS borrow,
        SUM(s.borrow_assets_usd * LEAST(s.borrow_apy, 1.0))::float8   AS interest,
        SUM(s.supply_assets_usd)::float8                              AS supply,
        SUM(s.supply_assets_usd * LEAST(s.supply_apy, 1.0))::float8   AS supply_interest,
        SUM(s.collateral_assets_usd)::float8                          AS collateral
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.snapshot_date >= (CURRENT_DATE - (${days} * INTERVAL '1 day'))
        -- exclude bad-oracle market-days (APY > 100%) so historical loans match Morpho
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      GROUP BY s.snapshot_date, ch.slug
      ORDER BY s.snapshot_date ASC
    `) as { date: string; chain_slug: string; borrow: number | null; interest: number | null; supply: number | null; supply_interest: number | null; collateral: number | null }[];

    const loans = new Map<string, ByChainSeriesPoint>();
    const intr = new Map<string, ByChainSeriesPoint>();
    const nim = new Map<string, ByChainSeriesPoint>();
    const deposits = new Map<string, ByChainSeriesPoint>();
    const tvl = new Map<string, ByChainSeriesPoint>();
    const ensure = (m: Map<string, ByChainSeriesPoint>, d: string) => {
      let p = m.get(d); if (!p) { p = { date: d }; m.set(d, p); } return p;
    };
    for (const r of rows) {
      const inTop = topSlugs.has(r.chain_slug);
      const key = inTop ? r.chain_slug : 'Other';
      const b = r.borrow ?? 0, it = r.interest ?? 0, sup = r.supply ?? 0, col = r.collateral ?? 0;
      // stacked metrics (top + Other)
      const lp = ensure(loans, r.date); lp[key] = ((lp[key] as number) ?? 0) + b;
      const ip = ensure(intr, r.date); ip[key] = ((ip[key] as number) ?? 0) + it;
      const dp = ensure(deposits, r.date); dp[key] = ((dp[key] as number) ?? 0) + (sup + col);
      const tp = ensure(tvl, r.date); tp[key] = ((tp[key] as number) ?? 0) + (sup + col - b);
      // NIM lines (top chains only; weighted spread)
      if (inTop) {
        const np = ensure(nim, r.date);
        const wb = b > 0 ? it / b : null;
        const ws = sup > 0 ? (r.supply_interest ?? 0) / sup : null;
        np[r.chain_slug] = wb != null && ws != null ? wb - ws : null;
      }
    }
    const toSorted = (m: Map<string, ByChainSeriesPoint>) => [...m.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));

    const totalActive = econ.reduce((s, e) => s + e.activeLoans, 0);
    const leader = top[0]!;
    return {
      defaultMetric: metric,
      topChains,
      byMetric: { ACTIVE_LOANS: toSorted(loans), BORROW_INTEREST: toSorted(intr), NIM: toSorted(nim), DEPOSITS: toSorted(deposits), TVL: toSorted(tvl) },
      topChainLeader: { name: leader.chainName, value: leader.activeLoans, pct: totalActive > 0 ? leader.activeLoans / totalActive : 0 },
    };
  },
  [LB_CACHE_VERSION, 'active-loan-series'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- Cross-chain curator network ----------

export interface CuratorChainMatrix {
  curators: { id: string; name: string; globalTvl: number }[];
  chains: { slug: string; name: string }[];
  /** cells[curatorId][chainSlug] = { tvl, vaultCount, pctOfGlobal } */
  cells: Record<string, Record<string, { tvl: number; vaultCount: number; pctOfGlobal: number }>>;
}

export const getCuratorChainMatrix = unstable_cache(
  async (topCurators = 10, topChains = 8): Promise<CuratorChainMatrix> => {
    const sql = getDb();
    const econ = await getChainEconomicsMatrix();
    const chainOrder = econ.slice(0, topChains);
    const chainSet = new Set(chainOrder.map((c) => c.chainSlug));

    const rows = (await sql`
      WITH vl AS (
        SELECT v.curator_id, v.chain_id, v.address, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
      )
      SELECT vl.curator_id, c.name AS curator_name, ch.slug AS chain_slug,
             SUM(vl.tvl)::float8 AS tvl, COUNT(*)::int AS vault_count
      FROM vl
      JOIN morpho_.chains ch ON ch.chain_id = vl.chain_id
      LEFT JOIN morpho_.curators c ON c.id = vl.curator_id
      WHERE vl.tvl IS NOT NULL AND vl.tvl > 0
      GROUP BY vl.curator_id, c.name, ch.slug
    `) as { curator_id: string; curator_name: string | null; chain_slug: string; tvl: number; vault_count: number }[];

    const globalTvl = new Map<string, number>();
    const nameOf = new Map<string, string>();
    for (const r of rows) {
      globalTvl.set(r.curator_id, (globalTvl.get(r.curator_id) ?? 0) + r.tvl);
      if (r.curator_name) nameOf.set(r.curator_id, r.curator_name);
    }
    const topCuratorIds = [...globalTvl.entries()].sort((a, b) => b[1] - a[1]).slice(0, topCurators).map(([id]) => id);
    const topCuratorSet = new Set(topCuratorIds);

    const cells: CuratorChainMatrix['cells'] = {};
    for (const r of rows) {
      if (!topCuratorSet.has(r.curator_id) || !chainSet.has(r.chain_slug)) continue;
      (cells[r.curator_id] ??= {})[r.chain_slug] = {
        tvl: r.tvl,
        vaultCount: r.vault_count,
        pctOfGlobal: (globalTvl.get(r.curator_id) ?? 0) > 0 ? r.tvl / globalTvl.get(r.curator_id)! : 0,
      };
    }

    return {
      curators: topCuratorIds.map((id) => ({ id, name: nameOf.get(id) ?? id, globalTvl: globalTvl.get(id) ?? 0 })),
      chains: chainOrder.map((c) => ({ slug: c.chainSlug, name: c.chainName })),
      cells,
    };
  },
  [LB_CACHE_VERSION, 'curator-chain-matrix'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- Expanded all-chains table ----------

export interface ChainsTableExpandedRow extends ChainEconomics {
  morphoShare: number | null;       // Morpho's share of chain lending TVL (compat)
  share12moDeltaPp: number | null;  // pp change over 12 months (compat)
}

export const getChainsTableExpanded = unstable_cache(
  async (): Promise<ChainsTableExpandedRow[]> => {
    const sql = getDb();
    const econ = await getChainEconomicsMatrix();

    // Compatibility share columns from the existing TVL series.
    const shareRows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d FROM morpho_.chain_lending_tvl_daily
      ),
      now AS (
        SELECT m.chain_slug,
               (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8 AS share
        FROM morpho_.protocol_tvl_daily m
        JOIN morpho_.chain_lending_tvl_daily l ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
        WHERE m.protocol_slug = 'morpho-blue' AND m.snapshot_date = (SELECT d FROM latest)
      ),
      ago AS (
        SELECT DISTINCT ON (m.chain_slug) m.chain_slug,
               (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8 AS share
        FROM morpho_.protocol_tvl_daily m
        JOIN morpho_.chain_lending_tvl_daily l ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
        WHERE m.protocol_slug = 'morpho-blue'
          AND m.snapshot_date <= ((SELECT d FROM latest) - INTERVAL '365 days')
        ORDER BY m.chain_slug, m.snapshot_date DESC
      )
      SELECT now.chain_slug, now.share AS share_now, ago.share AS share_ago
      FROM now LEFT JOIN ago USING (chain_slug)
    `) as { chain_slug: string; share_now: number | null; share_ago: number | null }[];
    const shareBy = new Map(shareRows.map((r) => [r.chain_slug, r] as const));

    return econ.map((e) => {
      const s = shareBy.get(e.chainSlug);
      return {
        ...e,
        morphoShare: s?.share_now ?? null,
        share12moDeltaPp: s?.share_now != null && s?.share_ago != null ? (s.share_now - s.share_ago) * 100 : null,
      };
    });
  },
  [LB_CACHE_VERSION, 'table-expanded'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

/** Latest market-state snapshot date. The "as of" for loan-book surfaces. */
export const getLoanbookAsOf = unstable_cache(
  async (): Promise<string> => {
    const sql = getDb();
    const rows = (await sql`SELECT MAX(snapshot_date)::text AS d FROM morpho_.market_state_daily`) as { d: string | null }[];
    return rows[0]?.d ?? '';
  },
  [LB_CACHE_VERSION, 'as-of'],
  { revalidate: REVALIDATE_SECONDS, tags: ['chains'] },
);

// ---------- local helpers ----------

function fmtUsdLocal(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function assetClassShortLabel(c: AssetClass): string {
  // local copy to avoid importing the label map into a server module twice
  const map: Record<AssetClass, string> = {
    stablecoin: 'stablecoin', lst: 'LST', lrt: 'LRT', btc: 'BTC', eth: 'ETH', rwa: 'RWA', other: 'other',
  };
  return map[c];
}

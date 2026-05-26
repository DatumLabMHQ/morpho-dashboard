// Chains-surface queries. All cached via unstable_cache (15 min revalidate) per
// the build spec. Numbers come from Neon only — no external fetches at render time.
//
// We anchor "latest" to yesterday (MAX(snapshot_date) - 1 day) because the
// current day's chain_lending_tvl_daily is artificially low: DefiLlama indexes
// long-tail protocols with ~1-day lag, so the day-strict rebuild SQL
// undercounts today's denominator. Yesterday is fully populated.

import { unstable_cache } from 'next/cache';

import { tokens } from '../brand/tokens.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'chains-v4';
const REVALIDATE_SECONDS = 900;
const ELIGIBLE_TVL_THRESHOLD = 50_000_000;       // $50M peak
const SERIES_START_DATE = '2024-06-01';

// Brand-aligned chain coloring — Base + Ethereum highlighted with the same
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
  if (v == null || !Number.isFinite(v)) return '—';
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

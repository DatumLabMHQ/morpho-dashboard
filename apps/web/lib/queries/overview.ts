import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

// 5 KPI cards for the Overview header. "Morpho TVL" uses yesterday's data
// (latest fully-populated day — DefiLlama's long-tail indexing lags ~1 day).
// All others are timeless counts.

export interface OverviewKpis {
  morphoTvlUsd: number | null;
  marketCount: number;
  vaultCount: number;
  curatorCount: number;
  chainsLiveCount: number;
  asOfDate: string | null;
  hasData: boolean;
}

export const getOverviewKpis = unstable_cache(
  async (): Promise<OverviewKpis> => {
    const sql = getDb();

    // Yesterday in protocol_tvl_daily for morpho-blue, summed across chains.
    const tvlRows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue'
      )
      SELECT
        COALESCE(SUM(tvl_usd), 0)::float8 AS tvl,
        (SELECT d::text FROM latest)      AS as_of
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue'
        AND snapshot_date = (SELECT d FROM latest)
    `) as { tvl: number; as_of: string | null }[];

    const counts = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM morpho_.markets)                              AS markets,
        (SELECT COUNT(*)::int FROM morpho_.vaults)                               AS vaults,
        (SELECT COUNT(*)::int FROM morpho_.curators)                             AS curators,
        (SELECT COUNT(DISTINCT chain_id)::int FROM morpho_.markets)              AS chains_live
    `) as { markets: number; vaults: number; curators: number; chains_live: number }[];

    const c = counts[0] ?? { markets: 0, vaults: 0, curators: 0, chains_live: 0 };
    const tvl = tvlRows[0]?.tvl ?? 0;
    const asOf = tvlRows[0]?.as_of ?? null;

    return {
      morphoTvlUsd: tvl > 0 ? tvl : null,
      marketCount: c.markets,
      vaultCount: c.vaults,
      curatorCount: c.curators,
      chainsLiveCount: c.chains_live,
      asOfDate: asOf,
      hasData: c.markets > 0 || tvl > 0,
    };
  },
  ['overview-kpis-v2'],
  { revalidate: 900, tags: ['overview'] },
);

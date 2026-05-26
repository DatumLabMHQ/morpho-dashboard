// BONDUSD sanity check + global collateral-asset audit.
// Determines whether BONDUSD is a real $3B+ position or a pricing artifact,
// and surfaces the actual top collateral assets so we know what to classify.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const fmt = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K`
  : `$${Math.round(v).toLocaleString()}`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // 1. Top 10 collateral assets by aggregate SUM
    const sumTop = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, collateral_assets_usd, borrow_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.collateral_asset_symbol                  AS symbol,
        COUNT(*)::int                               AS markets,
        SUM(l.collateral_assets_usd)::float8        AS total_collateral_usd,
        SUM(l.borrow_assets_usd)::float8            AS total_borrows_against
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE m.collateral_asset_symbol IS NOT NULL
      GROUP BY m.collateral_asset_symbol
      ORDER BY total_collateral_usd DESC NULLS LAST
      LIMIT 10
    `);
    console.log('\n=== TOP 10 by SUM(collateral_assets_usd) — aggregate USD locked ===\n');
    console.table(
      sumTop.rows.map((r) => ({
        symbol: r.symbol,
        markets: r.markets,
        total_collateral: fmt(r.total_collateral_usd ?? 0),
        backing_borrows: fmt(r.total_borrows_against ?? 0),
      })),
    );

    // 2. Top 10 single-market collateral positions
    const maxPos = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, collateral_assets_usd, borrow_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key,
        m.collateral_asset_symbol AS collateral,
        m.loan_asset_symbol       AS loan,
        m.chain_id,
        l.collateral_assets_usd::float8 AS pos_usd,
        l.borrow_assets_usd::float8     AS borrow_usd
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
      ORDER BY l.collateral_assets_usd DESC NULLS LAST
      LIMIT 10
    `);
    console.log('\n=== TOP 10 single-market collateral positions ===\n');
    console.table(
      maxPos.rows.map((r) => ({
        unique_key: (r.unique_key as string).slice(0, 12) + '...',
        pair: `${r.collateral} / ${r.loan}`,
        chain: r.chain_id,
        position: fmt(r.pos_usd ?? 0),
        borrowed: fmt(r.borrow_usd ?? 0),
      })),
    );

    // 3. BONDUSD deep dive
    const bondusd = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, collateral_assets_usd, borrow_assets_usd, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key,
        m.chain_id,
        m.loan_asset_symbol AS loan,
        m.collateral_asset_address,
        m.oracle_address,
        m.lltv::float8 AS lltv,
        l.collateral_assets_usd::float8 AS coll_usd,
        l.borrow_assets_usd::float8     AS borrow_usd,
        l.supply_assets_usd::float8     AS supply_usd
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE UPPER(m.collateral_asset_symbol) = 'BONDUSD'
      ORDER BY l.collateral_assets_usd DESC NULLS LAST
    `);
    console.log('\n=== BONDUSD deep dive ===\n');
    if (bondusd.rows.length === 0) {
      console.log('No BONDUSD markets found.');
    } else {
      const total = bondusd.rows.reduce((s, r) => s + Number(r.coll_usd ?? 0), 0);
      const largest = bondusd.rows[0]!;
      console.log(`Markets backing borrows with BONDUSD: ${bondusd.rows.length}`);
      console.log(`Total BONDUSD collateral: ${fmt(total)}`);
      console.log(`Largest single position: ${fmt(largest.coll_usd ?? 0)} (${largest.unique_key.slice(0, 14)}...)`);
      console.log(`  → chain ${largest.chain_id} · loan ${largest.loan} · oracle ${largest.oracle_address ?? 'null'}`);
      console.log('\nFull list:');
      console.table(
        bondusd.rows.map((r) => ({
          key: (r.unique_key as string).slice(0, 12) + '...',
          chain: r.chain_id,
          loan: r.loan,
          coll: fmt(r.coll_usd ?? 0),
          borrowed: fmt(r.borrow_usd ?? 0),
          oracle: (r.oracle_address ?? 'null').slice(0, 12),
        })),
      );
    }

    // 4. Outlier-by-asset detector: any single position > 10× next-largest of same asset?
    const outliers = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      ranked AS (
        SELECT
          m.unique_key, m.collateral_asset_symbol AS symbol, m.chain_id,
          l.collateral_assets_usd::float8 AS usd,
          ROW_NUMBER() OVER (PARTITION BY m.collateral_asset_symbol ORDER BY l.collateral_assets_usd DESC) AS rn
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL AND l.collateral_assets_usd > 100000000
      ),
      pairs AS (
        SELECT
          a.symbol, a.unique_key AS top_key, a.chain_id, a.usd AS top_usd,
          b.usd AS next_usd,
          a.usd / NULLIF(b.usd, 0) AS ratio
        FROM ranked a LEFT JOIN ranked b ON b.symbol = a.symbol AND b.rn = 2
        WHERE a.rn = 1
      )
      SELECT * FROM pairs
      WHERE ratio IS NULL OR ratio > 10
      ORDER BY top_usd DESC
    `);
    console.log('\n=== OUTLIERS — single position > 10× next-largest for same asset (over $100M) ===\n');
    if (outliers.rows.length === 0) {
      console.log('No outliers — distribution is reasonable.');
    } else {
      console.table(
        outliers.rows.map((r) => ({
          symbol: r.symbol,
          chain: r.chain_id,
          top_position: fmt(r.top_usd ?? 0),
          next_position: r.next_usd ? fmt(r.next_usd) : 'none (single market)',
          ratio: r.ratio == null ? '∞ (only one market)' : `${Number(r.ratio).toFixed(1)}x`,
        })),
      );
    }

    // 5. Top 25 uncategorized symbols on either side over $10M
    const uncats = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      loan_other AS (
        SELECT m.loan_asset_symbol AS symbol, 'loan' AS side,
               SUM(l.supply_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        GROUP BY m.loan_asset_symbol
      ),
      coll_other AS (
        SELECT m.collateral_asset_symbol AS symbol, 'collateral' AS side,
               SUM(l.collateral_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL
        GROUP BY m.collateral_asset_symbol
      ),
      combined AS (
        SELECT symbol, side, usd FROM loan_other
        UNION ALL
        SELECT symbol, side, usd FROM coll_other
      ),
      filtered AS (
        SELECT * FROM combined
        WHERE usd >= 10000000
          AND UPPER(symbol) NOT IN (
            'USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD',
            'FDUSD','TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD',
            'USDD','USDM','GUSD','USDX','USDY','USDTB','BOLD','GUSDC',
            'WSTETH','STETH','RETH','CBETH','SFRXETH','ETHX','SWETH','OSETH','ANKRETH',
            'WEETH','EZETH','RSETH','PUFETH','EETH','RSTETH','AMPHRETH','KINGETH','UNIETH',
            'WBTC','CBBTC','LBTC','TBTC','EBTC','SOLVBTC','STBTC','FBTC','M-BTC','UNIBTC','ENZOBTC','KBTC',
            'PUMPBTC','SOLVBTC.BBN','BTCB','XBTC','WBTC18',
            'WETH','ETH','SDAI','PAXG','USTB','OUSG','UDUSD','SBUIDL'
          )
          AND UPPER(symbol) NOT LIKE 'PT-%'
          AND UPPER(symbol) NOT LIKE 'YT-%'
          AND UPPER(symbol) NOT LIKE '%RWA%'
      )
      SELECT * FROM filtered ORDER BY usd DESC LIMIT 30
    `);
    console.log('\n=== UNCATEGORIZED OVER $10M (excluding already-classified) ===\n');
    console.table(
      uncats.rows.map((r) => ({
        symbol: r.symbol,
        side: r.side,
        usd: fmt(r.usd ?? 0),
      })),
    );
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

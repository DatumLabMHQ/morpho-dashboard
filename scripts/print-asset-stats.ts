// Paste-ready asset stats: Ethena, cbBTC, LST+LRT, per-chain identities.
// SQL mirrors lib/queries/assets.ts so numbers match the dashboard.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const CASE_CLS = (col: string) => `
  CASE
    WHEN UPPER(${col}) LIKE 'PT-%' THEN
      CASE
        WHEN UPPER(${col}) LIKE 'PT-SUSDE%' OR UPPER(${col}) LIKE 'PT-USDE%' OR UPPER(${col}) LIKE 'PT-USDC%'
          OR UPPER(${col}) LIKE 'PT-USDS%' OR UPPER(${col}) LIKE 'PT-USDT%' OR UPPER(${col}) LIKE 'PT-USR%'
          OR UPPER(${col}) LIKE 'PT-USD0%' OR UPPER(${col}) LIKE 'PT-GHO%' OR UPPER(${col}) LIKE 'PT-DAI%'
          THEN 'stablecoin'
        WHEN UPPER(${col}) LIKE 'PT-WEETH%' OR UPPER(${col}) LIKE 'PT-EZETH%' OR UPPER(${col}) LIKE 'PT-RSETH%'
          OR UPPER(${col}) LIKE 'PT-PUFETH%' OR UPPER(${col}) LIKE 'PT-EETH%'
          THEN 'lrt'
        WHEN UPPER(${col}) LIKE 'PT-WSTETH%' OR UPPER(${col}) LIKE 'PT-STETH%' OR UPPER(${col}) LIKE 'PT-CBETH%' OR UPPER(${col}) LIKE 'PT-RETH%' THEN 'lst'
        WHEN UPPER(${col}) LIKE 'PT-CBBTC%' OR UPPER(${col}) LIKE 'PT-WBTC%' OR UPPER(${col}) LIKE 'PT-LBTC%' OR UPPER(${col}) LIKE 'PT-TBTC%' OR UPPER(${col}) LIKE 'PT-EBTC%' THEN 'btc'
        ELSE 'other'
      END
    WHEN UPPER(${col}) IN ('USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD','USDD','USDM','GUSD','USDX','USDY','USDTB','BOLD','GUSDC','SYRUPUSDC','AA_FALCONXUSDC','EURCV','WSRUSD','AUSD','VBUSDC','VBUSDT','SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD','MSUSD','VUSD') THEN 'stablecoin'
    WHEN UPPER(${col}) IN ('WSTETH','STETH','RETH','CBETH','SFRXETH','ETHX','SWETH','OSETH','ANKRETH','KHYPE','STHYPE','OETH') THEN 'lst'
    WHEN UPPER(${col}) IN ('WEETH','EZETH','RSETH','PUFETH','EETH','RSTETH','AMPHRETH','KINGETH','UNIETH') THEN 'lrt'
    WHEN UPPER(${col}) IN ('WBTC','CBBTC','LBTC','TBTC','EBTC','SOLVBTC','STBTC','FBTC','M-BTC','UNIBTC','ENZOBTC','KBTC','PUMPBTC','SOLVBTC.BBN','BTCB','XBTC','WBTC18','VBWBTC') THEN 'btc'
    WHEN UPPER(${col}) IN ('WETH','ETH','VBETH') THEN 'eth'
    WHEN UPPER(${col}) IN ('SDAI','PAXG','USTB','OUSG','UDUSD','SBUIDL','XAUT') OR UPPER(${col}) LIKE 'YT-%' OR UPPER(${col}) LIKE '%RWA%' THEN 'rwa'
    ELSE 'other'
  END
`;

const fmtUsd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : `$${Math.round(v).toLocaleString()}`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // Ethena footprint
    const ethena = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      stable_total AS (
        SELECT SUM(l.supply_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD','USDD','USDM','GUSD','USDX','USDY','USDTB','BOLD','GUSDC')
      ),
      ethena AS (
        SELECT m.loan_asset_symbol AS sym, SUM(l.supply_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE UPPER(m.loan_asset_symbol) IN ('USDE','SUSDE','USDTB')
        GROUP BY m.loan_asset_symbol
      )
      SELECT
        (SELECT usd FROM stable_total)                AS stable_total,
        (SELECT SUM(usd) FROM ethena)::float8         AS ethena_combined,
        (SELECT json_agg(json_build_object('sym',sym,'usd',usd) ORDER BY usd DESC) FROM ethena) AS breakdown
    `);
    const e = ethena.rows[0]!;
    const ethenaShare = e.stable_total ? e.ethena_combined / e.stable_total : 0;
    console.log('\n=== ETHENA FOOTPRINT ===\n');
    console.log(`USDe + sUSDe + USDtb combined: ${fmtUsd(e.ethena_combined ?? 0)}`);
    console.log(`Morpho stablecoin supply total: ${fmtUsd(e.stable_total ?? 0)}`);
    console.log(`Ethena share of Morpho stablecoin supply: ${(ethenaShare * 100).toFixed(1)}%`);
    if (e.breakdown) console.log('Breakdown:', e.breakdown.map((b: any) => `${b.sym}=${fmtUsd(b.usd)}`).join(' · '));

    // cbBTC footprint
    const cbbtc = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, borrow_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        SUM(l.borrow_assets_usd)::float8     AS collateralizing,
        SUM(l.collateral_assets_usd)::float8 AS deposited,
        COUNT(*)::int                          AS market_count,
        COUNT(DISTINCT m.chain_id)::int        AS chain_count
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE UPPER(m.collateral_asset_symbol) = 'CBBTC'
    `);
    const cb = cbbtc.rows[0]!;
    console.log('\n=== cbBTC FOOTPRINT ===\n');
    console.log(`cbBTC collateralizing borrows: ${fmtUsd(cb.collateralizing ?? 0)}`);
    console.log(`cbBTC deposited as collateral: ${fmtUsd(cb.deposited ?? 0)}`);
    console.log(`Used in ${cb.market_count} markets across ${cb.chain_count} chains`);

    // LST + LRT share of collateral
    const lst = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      classed AS (
        SELECT ${CASE_CLS('m.collateral_asset_symbol')} AS cat, SUM(l.collateral_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL
        GROUP BY ${CASE_CLS('m.collateral_asset_symbol')}
      ),
      total AS (SELECT SUM(usd)::float8 AS t FROM classed)
      SELECT
        (SELECT SUM(usd) FROM classed WHERE cat IN ('lst','lrt'))::float8 AS lst_lrt,
        (SELECT t FROM total)                                              AS total,
        (SELECT json_agg(json_build_object('c',cat,'u',usd) ORDER BY usd DESC) FROM classed) AS breakdown
    `);
    const l = lst.rows[0]!;
    const lstShare = l.total ? l.lst_lrt / l.total : 0;
    console.log('\n=== LST + LRT COLLATERAL ===\n');
    console.log(`LST + LRT combined: ${fmtUsd(l.lst_lrt ?? 0)}`);
    console.log(`Total Morpho collateral: ${fmtUsd(l.total ?? 0)}`);
    console.log(`LST + LRT share of collateral: ${(lstShare * 100).toFixed(1)}%`);
    if (l.breakdown) {
      console.log('Full collateral breakdown:', l.breakdown.map((b: any) => `${b.c}=${(b.u / l.total * 100).toFixed(1)}%`).join(' · '));
    }

    // Per-chain identities
    const ids = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      mix AS (
        SELECT ch.slug, ch.name,
               ${CASE_CLS('m.collateral_asset_symbol')} AS cat,
               SUM(l.collateral_assets_usd)::float8 AS usd
        FROM morpho_.markets m
        JOIN latest l ON l.market_unique_key = m.unique_key
        LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
        WHERE m.collateral_asset_symbol IS NOT NULL
          AND ch.slug IN ('Base','Ethereum','Hyperliquid L1')
        GROUP BY ch.slug, ch.name, ${CASE_CLS('m.collateral_asset_symbol')}
      ),
      ranked AS (
        SELECT slug, name, cat, usd, SUM(usd) OVER (PARTITION BY slug) AS chain_total,
               ROW_NUMBER() OVER (PARTITION BY slug ORDER BY usd DESC) AS rnk
        FROM mix
      )
      SELECT name, cat, usd, chain_total
      FROM ranked WHERE rnk = 1
    `);
    console.log('\n=== PER-CHAIN COLLATERAL IDENTITY ===\n');
    const LABEL: Record<string, string> = {
      stablecoin: 'stablecoin-collateralized',
      lst: 'LST-collateralized',
      lrt: 'LRT-collateralized',
      btc: 'BTC-collateralized',
      eth: 'ETH-collateralized',
      rwa: 'RWA-collateralized',
      other: 'other-collateralized',
    };
    for (const r of ids.rows) {
      const pct = r.chain_total ? (r.usd / r.chain_total) * 100 : 0;
      console.log(`${r.name} is ${pct.toFixed(0)}% ${LABEL[r.cat] ?? r.cat}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

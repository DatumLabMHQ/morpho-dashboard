-- Aave V3 reserve rates, sourced from DefiLlama's yields API
-- (https://yields.llama.fi/pools?project=aave-v3). One row per
-- (chain_id, asset_symbol, snapshot_date). Daily granularity so we can join
-- against morpho_.market_state_daily for spread analysis on /rates.
--
-- We deliberately store only the four target assets the report cares about
-- (USDC, USDT, DAI, WETH) across the four chains Morpho is largest on
-- (Ethereum, Base, Arbitrum, Polygon). Adding more is just a config change in
-- the worker job.

CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.aave_rates_daily (
  chain_id        INTEGER NOT NULL,
  asset_symbol    TEXT    NOT NULL,
  snapshot_date   DATE    NOT NULL,
  supply_apy      NUMERIC(12, 8),
  borrow_apy      NUMERIC(12, 8),
  utilization     NUMERIC(8, 6),
  supply_usd      NUMERIC(38, 2),
  borrow_usd      NUMERIC(38, 2),
  pool_id         TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, asset_symbol, snapshot_date)
);

CREATE INDEX IF NOT EXISTS aave_rates_date_idx
  ON morpho_.aave_rates_daily (snapshot_date);

CREATE INDEX IF NOT EXISTS aave_rates_asset_chain_idx
  ON morpho_.aave_rates_daily (asset_symbol, chain_id);

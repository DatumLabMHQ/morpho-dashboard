-- Competitor lending rates from DefiLlama yields, generalized from the
-- Aave-only aave_rates_daily to the full overcollateralized sector:
-- aave-v3, sparklend, compound-v3, fluid-lending, euler-v2.
--
-- One row per (chain_id, protocol_slug, asset_symbol, snapshot_date). Pulled by
-- the `competitor-rates` worker job (6h cron). supply_apy/borrow_apy are
-- fractions (0.05 = 5%); utilization 0..1. The /rates "Sector Avg" is the
-- supply-USD-weighted average across these protocols for a given (asset, chain).

CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.competitor_rates_daily (
  chain_id        INTEGER NOT NULL,
  protocol_slug   TEXT    NOT NULL,
  asset_symbol    TEXT    NOT NULL,
  snapshot_date   DATE    NOT NULL,
  supply_apy      NUMERIC(12, 8),
  borrow_apy      NUMERIC(12, 8),
  utilization     NUMERIC(8, 6),
  supply_usd      NUMERIC(38, 2),
  borrow_usd      NUMERIC(38, 2),
  pool_id         TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, protocol_slug, asset_symbol, snapshot_date)
);

CREATE INDEX IF NOT EXISTS competitor_rates_date_idx
  ON morpho_.competitor_rates_daily (snapshot_date);
CREATE INDEX IF NOT EXISTS competitor_rates_lookup_idx
  ON morpho_.competitor_rates_daily (asset_symbol, chain_id, protocol_slug);

-- Seed the new table with the existing Aave V3 history so the sector view has
-- data before the multi-protocol worker backfill runs in prod. Idempotent.
INSERT INTO morpho_.competitor_rates_daily
  (chain_id, protocol_slug, asset_symbol, snapshot_date, supply_apy, borrow_apy, utilization, supply_usd, borrow_usd, pool_id)
SELECT chain_id, 'aave-v3', asset_symbol, snapshot_date, supply_apy, borrow_apy, utilization, supply_usd, borrow_usd, pool_id
FROM morpho_.aave_rates_daily
ON CONFLICT (chain_id, protocol_slug, asset_symbol, snapshot_date) DO NOTHING;

CREATE SCHEMA IF NOT EXISTS morpho_;

-- Per-vault per-market supply allocation, snapshotted daily.
-- supply_share_pct is allocation_usd / vault_total_usd at the same snapshot_date.
CREATE TABLE IF NOT EXISTS morpho_.vault_allocations_daily (
  chain_id           INTEGER NOT NULL,
  vault_address      TEXT NOT NULL,
  market_unique_key  TEXT NOT NULL REFERENCES morpho_.markets(unique_key) ON DELETE CASCADE,
  snapshot_date      DATE NOT NULL,
  supply_assets      NUMERIC(78, 0),
  supply_assets_usd  NUMERIC(38, 8),
  supply_cap         NUMERIC(78, 0),
  supply_share_pct   NUMERIC(8, 6),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, vault_address, market_unique_key, snapshot_date),
  FOREIGN KEY (chain_id, vault_address)
    REFERENCES morpho_.vaults(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vault_alloc_date_idx
  ON morpho_.vault_allocations_daily (snapshot_date);
CREATE INDEX IF NOT EXISTS vault_alloc_market_idx
  ON morpho_.vault_allocations_daily (market_unique_key, snapshot_date);

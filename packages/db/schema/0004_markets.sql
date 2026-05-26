CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.markets (
  unique_key                TEXT PRIMARY KEY,
  chain_id                  INTEGER NOT NULL REFERENCES morpho_.chains(chain_id),
  loan_asset_address        TEXT NOT NULL,
  collateral_asset_address  TEXT,
  oracle_address            TEXT,
  irm_address               TEXT,
  lltv                      NUMERIC(38, 18),
  loan_asset_symbol         TEXT,
  collateral_asset_symbol   TEXT,
  created_at                TIMESTAMPTZ,
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS markets_chain_idx
  ON morpho_.markets (chain_id);
CREATE INDEX IF NOT EXISTS markets_loan_idx
  ON morpho_.markets (chain_id, loan_asset_address);
CREATE INDEX IF NOT EXISTS markets_collat_idx
  ON morpho_.markets (chain_id, collateral_asset_address);

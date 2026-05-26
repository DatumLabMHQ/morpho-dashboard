CREATE SCHEMA IF NOT EXISTS morpho_;

-- Asset category overrides. Matched in order:
--   1. (address, chain_id)
--   2. (symbol, chain_id)
--   3. (symbol)
-- Unmatched assets default to 'other' and are logged via sync_runs.notes for triage.
CREATE TABLE IF NOT EXISTS morpho_.asset_categories (
  id           BIGSERIAL PRIMARY KEY,
  symbol       TEXT NOT NULL,
  address      TEXT,
  chain_id     INTEGER REFERENCES morpho_.chains(chain_id),
  category     TEXT NOT NULL
    CHECK (category IN ('stablecoin','lst','lrt','btc','eth','rwa','other')),
  subcategory  TEXT,
  notes        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes encode the three match tiers without overlap.
CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_address_chain_uq
  ON morpho_.asset_categories (address, chain_id)
  WHERE address IS NOT NULL AND chain_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_symbol_chain_uq
  ON morpho_.asset_categories (symbol, chain_id)
  WHERE address IS NULL AND chain_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asset_categories_symbol_uq
  ON morpho_.asset_categories (symbol)
  WHERE address IS NULL AND chain_id IS NULL;

CREATE INDEX IF NOT EXISTS asset_categories_symbol_idx
  ON morpho_.asset_categories (symbol);

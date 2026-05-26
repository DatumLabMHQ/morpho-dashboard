CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.assets (
  chain_id        INTEGER NOT NULL REFERENCES morpho_.chains(chain_id),
  address         TEXT NOT NULL,
  symbol          TEXT NOT NULL,
  name            TEXT,
  decimals        SMALLINT NOT NULL,
  logo_uri        TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ,
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX IF NOT EXISTS assets_symbol_idx ON morpho_.assets (symbol);

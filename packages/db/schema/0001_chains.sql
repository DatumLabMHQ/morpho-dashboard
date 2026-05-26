CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.chains (
  chain_id        INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  network         TEXT,
  slug            TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chains_active_idx
  ON morpho_.chains (is_active) WHERE is_active;

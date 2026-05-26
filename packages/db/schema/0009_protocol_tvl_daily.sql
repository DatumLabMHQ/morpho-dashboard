CREATE SCHEMA IF NOT EXISTS morpho_;

-- Per-protocol per-chain TVL from DefiLlama.
-- Holds Morpho Blue, Aave V3, SparkLend, Fluid, Euler V2, Compound V3, etc.
-- chain_slug is the DefiLlama chain key as it appears in /protocol/{slug}.chainTvls.
CREATE TABLE IF NOT EXISTS morpho_.protocol_tvl_daily (
  protocol_slug   TEXT NOT NULL,
  chain_slug      TEXT NOT NULL,
  snapshot_date   DATE NOT NULL,
  tvl_usd         NUMERIC(38, 2),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (protocol_slug, chain_slug, snapshot_date)
);

CREATE INDEX IF NOT EXISTS protocol_tvl_chain_date_idx
  ON morpho_.protocol_tvl_daily (chain_slug, snapshot_date);
CREATE INDEX IF NOT EXISTS protocol_tvl_protocol_date_idx
  ON morpho_.protocol_tvl_daily (protocol_slug, snapshot_date);

CREATE SCHEMA IF NOT EXISTS morpho_;

-- Per-chain lending TVL = SUM(tvl) across DefiLlama protocols where category IN ('Lending','CDP').
-- Built by the defillama-lending-denom job, which fans out per-protocol fetches gated by
-- the >1% delta check in defillama_protocols_snapshot.
CREATE TABLE IF NOT EXISTS morpho_.chain_lending_tvl_daily (
  chain_slug        TEXT NOT NULL,
  snapshot_date     DATE NOT NULL,
  lending_tvl_usd   NUMERIC(38, 2) NOT NULL,
  protocol_count    INTEGER NOT NULL,
  source            TEXT NOT NULL DEFAULT 'defillama_sum',
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_slug, snapshot_date)
);

CREATE INDEX IF NOT EXISTS chain_lending_date_idx
  ON morpho_.chain_lending_tvl_daily (snapshot_date);

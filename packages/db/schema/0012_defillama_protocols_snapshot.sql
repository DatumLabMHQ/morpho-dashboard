CREATE SCHEMA IF NOT EXISTS morpho_;

-- Cache + delta gate for DefiLlama's protocol list. Updated daily by the
-- defillama-comparators job. last_history_synced_at records the last time we
-- pulled the per-protocol historical series; the lending-denom job uses
-- |tvl_now - last_tvl_usd| / last_tvl_usd > 0.01 to decide whether to refetch.
CREATE TABLE IF NOT EXISTS morpho_.defillama_protocols_snapshot (
  protocol_slug           TEXT PRIMARY KEY,
  name                    TEXT,
  category                TEXT,
  last_tvl_usd            NUMERIC(38, 2),
  last_fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_history_synced_at  TIMESTAMPTZ,
  raw                     JSONB
);

CREATE INDEX IF NOT EXISTS dl_proto_category_idx
  ON morpho_.defillama_protocols_snapshot (category);

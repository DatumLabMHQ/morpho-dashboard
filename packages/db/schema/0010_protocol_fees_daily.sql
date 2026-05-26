CREATE SCHEMA IF NOT EXISTS morpho_;

-- Daily fees + revenue per protocol (DefiLlama /overview/fees/{slug}).
-- Pulled for: morpho-blue, aave-v3, sparklend, fluid-protocol, euler-v2, compound-v3.
CREATE TABLE IF NOT EXISTS morpho_.protocol_fees_daily (
  protocol_slug   TEXT NOT NULL,
  snapshot_date   DATE NOT NULL,
  fees_usd        NUMERIC(38, 2),
  revenue_usd     NUMERIC(38, 2),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (protocol_slug, snapshot_date)
);

CREATE INDEX IF NOT EXISTS protocol_fees_date_idx
  ON morpho_.protocol_fees_daily (snapshot_date);

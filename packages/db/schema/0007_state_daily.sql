CREATE SCHEMA IF NOT EXISTS morpho_;

-- Daily snapshot of every Morpho Blue market's state.
-- Idempotent on (market_unique_key, snapshot_date) so reruns are safe.
CREATE TABLE IF NOT EXISTS morpho_.market_state_daily (
  market_unique_key      TEXT NOT NULL REFERENCES morpho_.markets(unique_key) ON DELETE CASCADE,
  snapshot_date          DATE NOT NULL,
  supply_assets          NUMERIC(78, 0),
  supply_assets_usd      NUMERIC(38, 8),
  borrow_assets          NUMERIC(78, 0),
  borrow_assets_usd      NUMERIC(38, 8),
  collateral_assets_usd  NUMERIC(38, 8),
  liquidity_assets_usd   NUMERIC(38, 8),
  bad_debt_assets_usd            NUMERIC(38, 8),  -- Market.badDebt.usd (unrealized)
  realized_bad_debt_assets_usd   NUMERIC(38, 8),  -- Market.realizedBadDebt.usd
  bad_debt_source                TEXT CHECK (bad_debt_source IN ('graphql','computed')),
  supply_apy             NUMERIC(12, 8),
  borrow_apy             NUMERIC(12, 8),
  net_supply_apy         NUMERIC(12, 8),
  net_borrow_apy         NUMERIC(12, 8),
  utilization            NUMERIC(8, 6),
  price                  NUMERIC(38, 18),
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_unique_key, snapshot_date)
);

CREATE INDEX IF NOT EXISTS market_state_date_idx
  ON morpho_.market_state_daily (snapshot_date);

-- Daily snapshot of every MetaMorpho vault's state.
CREATE TABLE IF NOT EXISTS morpho_.vault_state_daily (
  chain_id          INTEGER NOT NULL,
  vault_address     TEXT NOT NULL,
  snapshot_date     DATE NOT NULL,
  total_assets      NUMERIC(78, 0),
  total_assets_usd  NUMERIC(38, 8),
  total_supply      NUMERIC(78, 0),
  share_price       NUMERIC(38, 18),
  apy               NUMERIC(12, 8),
  net_apy           NUMERIC(12, 8),
  fee_bps           INTEGER,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, vault_address, snapshot_date),
  FOREIGN KEY (chain_id, vault_address)
    REFERENCES morpho_.vaults(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS vault_state_date_idx
  ON morpho_.vault_state_daily (snapshot_date);

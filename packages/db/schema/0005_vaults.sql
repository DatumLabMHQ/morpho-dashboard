CREATE SCHEMA IF NOT EXISTS morpho_;

-- MetaMorpho V1 vaults. (V2 multi-curator vaults are captured in vault_curators_extra.)
-- curator_id is resolved from curator_address_raw via curator_addresses; left as a soft
-- TEXT reference (no FK) so a vault can land before its Curator metadata is synced.
CREATE TABLE IF NOT EXISTS morpho_.vaults (
  chain_id               INTEGER NOT NULL REFERENCES morpho_.chains(chain_id),
  address                TEXT NOT NULL,
  symbol                 TEXT,
  name                   TEXT,
  asset_address          TEXT NOT NULL,
  asset_symbol           TEXT,
  curator_id             TEXT,
  curator_address_raw    TEXT,
  fee_recipient_address  TEXT,
  performance_fee_bps    INTEGER,
  listed                 BOOLEAN,
  featured               BOOLEAN,
  created_at             TIMESTAMPTZ,
  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at         TIMESTAMPTZ,
  PRIMARY KEY (chain_id, address)
);

CREATE INDEX IF NOT EXISTS vaults_curator_idx
  ON morpho_.vaults (curator_id);
CREATE INDEX IF NOT EXISTS vaults_curator_raw_idx
  ON morpho_.vaults (curator_address_raw);
CREATE INDEX IF NOT EXISTS vaults_fee_recipient_idx
  ON morpho_.vaults (fee_recipient_address);
CREATE INDEX IF NOT EXISTS vaults_asset_idx
  ON morpho_.vaults (chain_id, asset_address);

-- V2 vaults can have multiple curators. Primary curator is on vaults.curator_id;
-- additional curators live here.
CREATE TABLE IF NOT EXISTS morpho_.vault_curators_extra (
  chain_id       INTEGER NOT NULL,
  vault_address  TEXT NOT NULL,
  curator_id     TEXT NOT NULL,
  PRIMARY KEY (chain_id, vault_address, curator_id),
  FOREIGN KEY (chain_id, vault_address)
    REFERENCES morpho_.vaults(chain_id, address) ON DELETE CASCADE
);

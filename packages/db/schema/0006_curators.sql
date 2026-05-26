CREATE SCHEMA IF NOT EXISTS morpho_;

-- Canonical curator registry. id is the Morpho curator slug (e.g. 'mev-capital').
-- A single curator may control multiple multisigs across chains; addresses live in
-- curator_addresses.
CREATE TABLE IF NOT EXISTS morpho_.curators (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  image_url       TEXT,
  url             TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  owner_only      BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS curators_name_idx ON morpho_.curators (name);

-- chain_id NULL means the address is asserted cross-chain or its chain isn't recorded.
CREATE TABLE IF NOT EXISTS morpho_.curator_addresses (
  curator_id   TEXT NOT NULL REFERENCES morpho_.curators(id) ON DELETE CASCADE,
  chain_id     INTEGER REFERENCES morpho_.chains(chain_id),
  address      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS curator_addresses_uq_chain
  ON morpho_.curator_addresses (curator_id, chain_id, address)
  WHERE chain_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS curator_addresses_uq_nochain
  ON morpho_.curator_addresses (curator_id, address)
  WHERE chain_id IS NULL;
CREATE INDEX IF NOT EXISTS curator_addresses_address_idx
  ON morpho_.curator_addresses (address);
CREATE INDEX IF NOT EXISTS curator_addresses_chain_address_idx
  ON morpho_.curator_addresses (chain_id, address);

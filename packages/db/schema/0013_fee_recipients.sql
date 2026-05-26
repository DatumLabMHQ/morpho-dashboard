CREATE SCHEMA IF NOT EXISTS morpho_;

-- Maps a vault's on-chain feeRecipient to a curator attribution.
-- label = 'curator'        → revenue counts toward curator_id
-- label = 'dao_treasury'   → revenue counts toward Morpho DAO bucket (not curator)
-- label = 'unattributed'   → recipient is known but not classifiable
-- Vaults whose feeRecipient is missing from this table also default to 'unattributed'
-- in vw_vault_attribution.
CREATE TABLE IF NOT EXISTS morpho_.fee_recipients (
  address     TEXT PRIMARY KEY,
  curator_id  TEXT REFERENCES morpho_.curators(id),
  label       TEXT NOT NULL
    CHECK (label IN ('curator','dao_treasury','unattributed')),
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fee_recipients_curator_idx
  ON morpho_.fee_recipients (curator_id);

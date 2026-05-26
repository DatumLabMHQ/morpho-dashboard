-- APY/utilization/price columns were originally too tight:
--   * NUMERIC(12,8) APYs cap at 9999.99... and overflow during liquidation
--     spikes when the API briefly emits huge computed rates.
--   * NUMERIC(38,18) price can't hold a uint256-scaled oracle value (the
--     integer part is bounded at 20 digits; some scaled prices need more).
-- Widening to NUMERIC(20,8) for APYs/utilization and NUMERIC(78,0) for price.
--
-- ALTER COLUMN TYPE requires dropping dependent views first. The CREATE OR
-- REPLACE VIEW statements at the bottom are copy-equivalents of 0016 so the
-- views are restored within this file (and 0016 staying as CREATE OR REPLACE
-- keeps re-running apply-schema idempotent).

DROP VIEW IF EXISTS morpho_.vw_market_with_chain;
DROP VIEW IF EXISTS morpho_.vw_market_latest;
DROP VIEW IF EXISTS morpho_.vw_vault_latest;

ALTER TABLE morpho_.market_state_daily
  ALTER COLUMN supply_apy     TYPE NUMERIC(20, 8),
  ALTER COLUMN borrow_apy     TYPE NUMERIC(20, 8),
  ALTER COLUMN net_supply_apy TYPE NUMERIC(20, 8),
  ALTER COLUMN net_borrow_apy TYPE NUMERIC(20, 8),
  ALTER COLUMN utilization    TYPE NUMERIC(20, 8),
  ALTER COLUMN price          TYPE NUMERIC(78, 0);

ALTER TABLE morpho_.vault_state_daily
  ALTER COLUMN apy     TYPE NUMERIC(20, 8),
  ALTER COLUMN net_apy TYPE NUMERIC(20, 8);

CREATE OR REPLACE VIEW morpho_.vw_market_latest AS
SELECT DISTINCT ON (m.unique_key)
  m.unique_key,
  m.chain_id,
  m.loan_asset_address,
  m.collateral_asset_address,
  m.loan_asset_symbol,
  m.collateral_asset_symbol,
  m.lltv,
  s.snapshot_date,
  s.supply_assets_usd,
  s.borrow_assets_usd,
  s.collateral_assets_usd,
  s.liquidity_assets_usd,
  s.bad_debt_assets_usd,
  s.realized_bad_debt_assets_usd,
  s.bad_debt_source,
  s.supply_apy,
  s.borrow_apy,
  s.net_supply_apy,
  s.net_borrow_apy,
  s.utilization
FROM morpho_.markets m
LEFT JOIN morpho_.market_state_daily s ON s.market_unique_key = m.unique_key
ORDER BY m.unique_key, s.snapshot_date DESC NULLS LAST;

CREATE OR REPLACE VIEW morpho_.vw_vault_latest AS
SELECT DISTINCT ON (v.chain_id, v.address)
  v.chain_id,
  v.address,
  v.name,
  v.symbol,
  v.asset_address,
  v.asset_symbol,
  v.curator_id,
  v.curator_address_raw,
  v.fee_recipient_address,
  v.performance_fee_bps,
  s.snapshot_date,
  s.total_assets_usd,
  s.apy,
  s.net_apy,
  s.fee_bps
FROM morpho_.vaults v
LEFT JOIN morpho_.vault_state_daily s
  ON s.chain_id = v.chain_id AND s.vault_address = v.address
ORDER BY v.chain_id, v.address, s.snapshot_date DESC NULLS LAST;

CREATE OR REPLACE VIEW morpho_.vw_market_with_chain AS
SELECT
  ml.*,
  c.name AS chain_name,
  c.slug AS chain_slug
FROM morpho_.vw_market_latest ml
JOIN morpho_.chains c ON c.chain_id = ml.chain_id;

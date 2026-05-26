CREATE SCHEMA IF NOT EXISTS morpho_;

-- Latest snapshot per market. LEFT JOIN + NULLS LAST keeps markets that have
-- no snapshot yet visible.
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

-- Latest snapshot per vault.
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

-- Resolved curator attribution per vault.
-- attribution_label = 'unattributed' when feeRecipient isn't in fee_recipients.
-- attributed_curator_id is the value to GROUP BY for curator-revenue aggregations.
CREATE OR REPLACE VIEW morpho_.vw_vault_attribution AS
SELECT
  v.chain_id,
  v.address                          AS vault_address,
  v.curator_id                       AS declared_curator_id,
  v.fee_recipient_address,
  fr.curator_id                      AS resolved_curator_id,
  COALESCE(fr.label, 'unattributed') AS attribution_label,
  CASE
    WHEN fr.label = 'curator'      THEN fr.curator_id
    WHEN fr.label = 'dao_treasury' THEN NULL
    ELSE NULL
  END                                AS attributed_curator_id
FROM morpho_.vaults v
LEFT JOIN morpho_.fee_recipients fr
  ON fr.address = v.fee_recipient_address;

-- Latest market state joined with chain name/slug — convenient for table views.
CREATE OR REPLACE VIEW morpho_.vw_market_with_chain AS
SELECT
  ml.*,
  c.name AS chain_name,
  c.slug AS chain_slug
FROM morpho_.vw_market_latest ml
JOIN morpho_.chains c ON c.chain_id = ml.chain_id;

-- Weekly net supply flows per (chain, asset) for /overview's Sankey.
--
-- "Supply footprint" of an asset on a chain = Σ supply_assets_usd over
-- markets where it's the loan asset + Σ collateral_assets_usd over markets
-- where it's the collateral asset. Net flow over a week = footprint on the
-- last snapshot of the week minus the first snapshot of the week.
--
-- NOTE on "constant prices": market_state_daily stores raw token amounts
-- only for the supply side (supply_assets); collateral has USD only. We
-- therefore compute net flow in USD terms — it includes price drift, not
-- just volume. The Sankey labels this honestly. A true volume-only flow
-- would need per-asset token quantities on both sides, which the upstream
-- Morpho snapshot doesn't expose for collateral.
--
-- Rebuilt daily by `aggregate-asset-flows-weekly`. Keyed on
-- (week_start, chain_id, asset_symbol).

CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.morpho_asset_flows_weekly (
  week_start    DATE    NOT NULL,
  chain_id      INTEGER NOT NULL,
  asset_symbol  TEXT    NOT NULL,
  net_flow_usd  NUMERIC(38, 2),
  footprint_end_usd NUMERIC(38, 2),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week_start, chain_id, asset_symbol)
);

CREATE INDEX IF NOT EXISTS asset_flows_week_idx
  ON morpho_.morpho_asset_flows_weekly (week_start);

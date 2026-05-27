-- Pre-aggregated weekly chain metrics for the /overview hero charts.
--
-- The raw computation — Σ borrow_assets_usd × borrow_apy and Σ vault TVL ×
-- vault APY × vault fee, grouped by (day, chain) and rolled up to weekly —
-- spans 730 days × ~1000 markets / ~500 vaults. Running that on every
-- page load (even with unstable_cache(900)) is too slow on cold load.
--
-- This table is rebuilt nightly by `aggregate-overview-weekly` and read
-- straight by /overview's weekly bar charts. Idempotent: PK on
-- (week_start, chain_slug); the job ON CONFLICT updates.
--
-- borrow_interest_usd: dollar interest paid to suppliers (= what borrowers
--   pay) on Morpho Blue markets during that week, per chain. Computed daily
--   as Σ borrow_assets_usd × borrow_apy / 365 then summed across the week's
--   7 daily snapshots. Markets with supply_apy >= 100% are excluded as the
--   same saturated-util IRM blow-ups we filter on /rates and /markets.
--
-- curation_fees_usd: dollar fees realized by MetaMorpho vault curators
--   during that week, per chain. Computed daily as Σ total_assets_usd ×
--   pre-fee apy × fee_bps/10000 / 365 then summed across the week.
--
-- "Week" is ISO week starting Monday. week_start is the Monday date.

CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.overview_weekly_chain_metrics (
  week_start            DATE         NOT NULL,
  chain_slug            TEXT         NOT NULL,
  borrow_interest_usd   NUMERIC(38, 2),
  curation_fees_usd     NUMERIC(38, 2),
  recorded_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (week_start, chain_slug)
);

CREATE INDEX IF NOT EXISTS overview_weekly_chain_week_idx
  ON morpho_.overview_weekly_chain_metrics (week_start);

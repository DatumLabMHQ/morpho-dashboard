-- 3-month US Treasury bill rate (FRED series DTB3), daily.
--
-- Used by /overview's "% real yield spread" KPI: Morpho's volume-weighted
-- stablecoin supply APY minus this risk-free rate. Pulled by the
-- `fred-tbill` worker job, which no-ops gracefully when FRED_API_KEY is
-- unset (the KPI then renders "—").
--
-- rate_pct is the annualized rate in percent (e.g. 5.25 = 5.25%). FRED
-- reports DTB3 in percent already; we store it verbatim.

CREATE SCHEMA IF NOT EXISTS morpho_;

CREATE TABLE IF NOT EXISTS morpho_.tbill_rates_daily (
  day          DATE NOT NULL PRIMARY KEY,
  rate_pct     NUMERIC(8, 4),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

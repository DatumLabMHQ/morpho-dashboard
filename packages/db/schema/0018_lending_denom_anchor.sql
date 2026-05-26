-- Fix the lending-denom flapping-delta bug.
--
-- Bug: the delta gate compared the latest /protocols summary TVL against
-- last_tvl_usd, but last_tvl_usd was being updated FROM the same summary on
-- every tick. Tiny price drift in /protocols (rounding, intraday updates)
-- caused ~105 long-tail protocols to flap above/below the 1% threshold
-- indefinitely.
--
-- Fix: introduce a separate anchor column updated ONLY when we actually
-- refetch /protocol/{slug} history. Delta gate compares the noisy summary
-- against the stable anchor.
--
-- Idempotent — safe to re-run.

ALTER TABLE morpho_.defillama_protocols_snapshot
  ADD COLUMN IF NOT EXISTS last_fetched_history_tvl_usd NUMERIC(38, 2);

-- Backfill: protocols already history-synced get the existing last_tvl_usd
-- promoted to the anchor. They won't be refetched on the next tick (delta = 0).
UPDATE morpho_.defillama_protocols_snapshot
SET last_fetched_history_tvl_usd = last_tvl_usd
WHERE last_history_synced_at IS NOT NULL
  AND last_fetched_history_tvl_usd IS NULL;

-- Protocols still in the backfill queue have last_history_synced_at IS NULL.
-- Their anchor stays NULL → delta gate's null check forces a refetch.

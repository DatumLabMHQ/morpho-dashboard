-- Add borrowed (active loans) to the per-protocol per-chain series so the
-- Overview's sector chart can show Deposits and Active Loans, not just TVL.
--
-- DefiLlama exposes borrowed separately from net TVL: chainTvls["{Chain}-borrowed"].
-- For lending protocols net tvl = supplied − borrowed, so:
--   active loans (borrows) = borrowed_usd
--   deposits (supplied)    = tvl_usd + borrowed_usd
-- Populated by the defillama-tvl worker job + scripts/backfill-protocol-borrowed.ts.
ALTER TABLE morpho_.protocol_tvl_daily
  ADD COLUMN IF NOT EXISTS borrowed_usd NUMERIC(38, 2);

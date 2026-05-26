CREATE SCHEMA IF NOT EXISTS morpho_;

-- One row per sync invocation (cron, backfill tick, or manual). notes is JSONB
-- so each job can stash custom stats (unmatched-asset symbols, slugs skipped by
-- the >1% delta gate, etc.) without schema changes.
CREATE TABLE IF NOT EXISTS morpho_.sync_runs (
  id              BIGSERIAL PRIMARY KEY,
  job             TEXT NOT NULL,
  trigger         TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','ok','partial','error')),
  rows_written    INTEGER,
  error_message   TEXT,
  notes           JSONB
);

CREATE INDEX IF NOT EXISTS sync_runs_job_started_idx
  ON morpho_.sync_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_status_idx
  ON morpho_.sync_runs (status) WHERE status IN ('running','error');

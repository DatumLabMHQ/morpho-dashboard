CREATE SCHEMA IF NOT EXISTS morpho_;

-- Resumable cursors for backfill jobs that can't complete in one Worker tick
-- (CF free plan: 30s CPU, 50 subrequests). Each (job, scope_key) row stores
-- where the next tick should resume. scope_key is empty for global jobs and
-- carries chain_id / protocol_slug / address for sharded ones.
CREATE TABLE IF NOT EXISTS morpho_.sync_cursors (
  job           TEXT NOT NULL,
  scope_key     TEXT NOT NULL DEFAULT '',
  cursor_value  TEXT,
  done          BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job, scope_key)
);

CREATE INDEX IF NOT EXISTS sync_cursors_pending_idx
  ON morpho_.sync_cursors (job) WHERE NOT done;

import type { SqlClient } from '@morpho-dashboard/db';

export type SyncRunId = bigint;
export type SyncTrigger = 'cron' | 'backfill' | 'manual';
export type SyncStatus = 'ok' | 'partial' | 'error';

export async function startSyncRun(
  sql: SqlClient,
  args: { job: string; trigger: SyncTrigger },
): Promise<SyncRunId> {
  const rows = (await sql`
    INSERT INTO morpho_.sync_runs (job, trigger, status)
    VALUES (${args.job}, ${args.trigger}, 'running')
    RETURNING id
  `) as { id: bigint | string | number }[];
  if (rows.length === 0) throw new Error('sync_runs INSERT returned no rows');
  return BigInt(rows[0]!.id);
}

export async function finishSyncRun(
  sql: SqlClient,
  runId: SyncRunId,
  args: {
    status: SyncStatus;
    rowsWritten?: number;
    errorMessage?: string;
    notes?: unknown;
  },
): Promise<void> {
  const notesJson = args.notes != null ? JSON.stringify(args.notes) : null;
  await sql`
    UPDATE morpho_.sync_runs
    SET finished_at   = NOW(),
        status        = ${args.status},
        rows_written  = ${args.rowsWritten ?? null},
        error_message = ${args.errorMessage ?? null},
        notes         = ${notesJson}::jsonb
    WHERE id = ${runId.toString()}::bigint
  `;
}

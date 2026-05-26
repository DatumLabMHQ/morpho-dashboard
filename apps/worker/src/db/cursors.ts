import type { SqlClient } from '@morpho-dashboard/db';

export interface CursorRow {
  cursorValue: string | null;
  done: boolean;
}

export async function getCursor(
  sql: SqlClient,
  job: string,
  scopeKey = '',
): Promise<CursorRow | null> {
  const rows = (await sql`
    SELECT cursor_value, done
    FROM morpho_.sync_cursors
    WHERE job = ${job} AND scope_key = ${scopeKey}
  `) as { cursor_value: string | null; done: boolean }[];
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return { cursorValue: row.cursor_value, done: row.done };
}

export async function setCursor(
  sql: SqlClient,
  args: {
    job: string;
    scopeKey?: string;
    cursorValue: string | null;
    done?: boolean;
  },
): Promise<void> {
  const scopeKey = args.scopeKey ?? '';
  const done = args.done ?? false;
  await sql`
    INSERT INTO morpho_.sync_cursors (job, scope_key, cursor_value, done, updated_at)
    VALUES (${args.job}, ${scopeKey}, ${args.cursorValue}, ${done}, NOW())
    ON CONFLICT (job, scope_key) DO UPDATE SET
      cursor_value = EXCLUDED.cursor_value,
      done         = EXCLUDED.done,
      updated_at   = NOW()
  `;
}

export async function clearCursors(sql: SqlClient, job: string): Promise<void> {
  await sql`DELETE FROM morpho_.sync_cursors WHERE job = ${job}`;
}

export async function listPendingScopes(
  sql: SqlClient,
  job: string,
  limit = 25,
): Promise<(CursorRow & { scopeKey: string })[]> {
  const rows = (await sql`
    SELECT scope_key, cursor_value, done
    FROM morpho_.sync_cursors
    WHERE job = ${job} AND NOT done
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `) as { scope_key: string; cursor_value: string | null; done: boolean }[];
  return rows.map((r) => ({
    scopeKey: r.scope_key,
    cursorValue: r.cursor_value,
    done: r.done,
  })) as (CursorRow & { scopeKey: string })[];
}

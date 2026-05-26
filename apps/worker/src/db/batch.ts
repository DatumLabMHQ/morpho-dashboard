import type { SqlClient } from '@morpho-dashboard/db';

// Postgres caps a single statement at 65535 parameters. Stay well under to
// leave headroom for future columns.
const MAX_PG_PARAMS = 32_000;

export interface BatchInsertOptions {
  // Raw SQL appended after the VALUES clause, starting with "ON CONFLICT ...".
  // Omit for plain INSERT (will fail on PK collision).
  onConflict?: string;
}

// Generic batched INSERT. Splits into chunks so we never exceed Postgres's
// parameter cap, and issues one HTTP roundtrip per chunk via Neon's HTTP driver.
//
// Each `row` array length must equal `columns.length`. Values are passed as
// parameterized $N placeholders — no SQL injection from values.
export async function batchInsert(
  sql: SqlClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  options: BatchInsertOptions = {},
): Promise<number> {
  if (rows.length === 0) return 0;

  const nc = columns.length;
  const chunkSize = Math.max(1, Math.floor(MAX_PG_PARAMS / nc));
  const colList = columns.join(', ');
  const conflict = options.onConflict ? ` ${options.onConflict}` : '';

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map(
        (_, ri) =>
          `(${columns.map((_, ci) => `$${ri * nc + ci + 1}`).join(', ')})`,
      )
      .join(', ');
    const query = `INSERT INTO ${table} (${colList}) VALUES ${placeholders}${conflict}`;
    const params = chunk.flat();
    // Function-call form of the neon() client: sql(text, params).
    // (The tagged-template form sql`...` doesn't allow dynamic placeholder counts.)
    await sql(query, params);
    written += chunk.length;
  }
  return written;
}

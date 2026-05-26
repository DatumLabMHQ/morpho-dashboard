// Drains 3 backfill loops concurrently:
//   - defillama-lending-denom  (~75 ticks of long-tail lending protocols)
//   - backfill-market-history  (~100 ticks of 12mo state per market)
//   - backfill-vault-history   (~50 ticks of 12mo state per vault)
//
// Each loop:
//   * one in-flight request at a time
//   * retry 3x with backoff (5s, 30s, 2min) on error; on exhaustion, log + skip the tick
//   * stop when the worker reports hasMore=false
//
// When all three finish, prints a verification summary.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const WORKER_URL = process.env.WORKER_URL!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN!;
if (!WORKER_URL || !ADMIN_TOKEN) {
  console.error('WORKER_URL and ADMIN_TOKEN must be set in .env');
  process.exit(1);
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

interface TickResponse {
  status: string;
  job: string;
  runId?: string;
  written: number;
  hasMore: boolean;
  notes?: Record<string, unknown>;
}

interface ProgressShape {
  processed: number;
  total: number;
  remaining: number;
}

type ProgressExtractor = (res: TickResponse, cumulative: number) => ProgressShape;

class JobLoop {
  private cumProcessed = 0;
  private recentMs: number[] = [];
  private ticks = 0;
  private skippedTicks = 0;
  done = false;

  constructor(
    readonly name: string,
    private fallbackTotal: number,
    private readonly perTick: number,
    private readonly extractProgress: ProgressExtractor,
  ) {}

  private avgMs(): number {
    if (this.recentMs.length === 0) return 0;
    return this.recentMs.reduce((s, x) => s + x, 0) / this.recentMs.length;
  }

  private async tickWithRetry(): Promise<{ res: TickResponse; ms: number } | null> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const t0 = Date.now();
      try {
        const r = await fetch(`${WORKER_URL}/backfill/tick?job=${this.name}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
        });
        const ms = Date.now() - t0;
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        }
        return { res: (await r.json()) as TickResponse, ms };
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt]!;
          console.warn(
            `[${this.name}] tick error (attempt ${attempt + 1}): ${
              err instanceof Error ? err.message : String(err)
            }. Retrying in ${delay / 1000}s.`,
          );
          await sleep(delay);
        } else {
          console.error(
            `[${this.name}] retry exhausted — skipping this tick. Last error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    return null;
  }

  private printProgress(progress: ProgressShape, ms: number): void {
    const pct = progress.total > 0 ? ((progress.processed / progress.total) * 100).toFixed(1) : '?';
    const avgMs = this.avgMs() || ms;
    const etaSec =
      progress.remaining > 0 ? Math.ceil((progress.remaining / this.perTick) * (avgMs / 1000)) : 0;
    const etaMin = Math.ceil(etaSec / 60);
    console.log(
      `[${this.name}] ${progress.processed}/${progress.total} (${pct}%) | last batch ${ms}ms | est remaining ${etaMin}m`,
    );
  }

  async run(): Promise<void> {
    while (true) {
      const result = await this.tickWithRetry();
      if (!result) {
        this.skippedTicks++;
        await sleep(5_000);
        continue;
      }
      const { res, ms } = result;
      this.recentMs.push(ms);
      if (this.recentMs.length > 10) this.recentMs.shift();
      this.ticks++;
      const progress = this.extractProgress(res, this.cumProcessed);
      this.cumProcessed = progress.processed;
      this.printProgress(progress, ms);
      if (!res.hasMore) {
        console.log(
          `[${this.name}] ✓ DONE after ${this.ticks} ticks (${this.skippedTicks} skipped)`,
        );
        this.done = true;
        return;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEntityTotals(pool: Pool): Promise<{ markets: number; vaults: number }> {
  const c = await pool.connect();
  try {
    const m = await c.query<{ c: number }>(`SELECT COUNT(*)::int c FROM morpho_.markets`);
    const v = await c.query<{ c: number }>(`SELECT COUNT(*)::int c FROM morpho_.vaults`);
    return { markets: m.rows[0]!.c, vaults: v.rows[0]!.c };
  } finally {
    c.release();
  }
}

async function printVerificationSummary(pool: Pool): Promise<void> {
  console.log('\n=========================================================');
  console.log(' VERIFICATION SUMMARY ');
  console.log('=========================================================\n');
  const c = await pool.connect();
  try {
    // 1. Row counts
    const counts = await c.query(`
      SELECT 'market_state_daily' t, COUNT(*)::bigint c FROM morpho_.market_state_daily UNION ALL
      SELECT 'vault_state_daily',     COUNT(*)::bigint   FROM morpho_.vault_state_daily   UNION ALL
      SELECT 'protocol_tvl_daily',    COUNT(*)::bigint   FROM morpho_.protocol_tvl_daily
    `);
    console.log('Row counts:');
    console.table(counts.rows.map((r) => ({ table: r.t, rows: String(r.c) })));

    // 2. Market history coverage
    const mh = await c.query(`
      SELECT
        MIN(snapshot_date)::text  AS min_day,
        MAX(snapshot_date)::text  AS max_day,
        COUNT(DISTINCT market_unique_key)::int AS distinct_markets
      FROM morpho_.market_state_daily
    `);
    const mh30 = await c.query(`
      SELECT COUNT(*)::int c FROM (
        SELECT market_unique_key FROM morpho_.market_state_daily
        GROUP BY market_unique_key HAVING COUNT(*) >= 30
      ) x
    `);
    console.log('Market state history:');
    console.table([
      {
        min_day: mh.rows[0]!.min_day,
        max_day: mh.rows[0]!.max_day,
        distinct_markets: mh.rows[0]!.distinct_markets,
        markets_with_30d_plus: mh30.rows[0]!.c,
      },
    ]);

    // 3. Vault history coverage
    const vh = await c.query(`
      SELECT
        MIN(snapshot_date)::text  AS min_day,
        MAX(snapshot_date)::text  AS max_day,
        COUNT(DISTINCT chain_id || ':' || vault_address)::int AS distinct_vaults
      FROM morpho_.vault_state_daily
    `);
    const vh30 = await c.query(`
      SELECT COUNT(*)::int c FROM (
        SELECT chain_id, vault_address FROM morpho_.vault_state_daily
        GROUP BY chain_id, vault_address HAVING COUNT(*) >= 30
      ) x
    `);
    console.log('Vault state history:');
    console.table([
      {
        min_day: vh.rows[0]!.min_day,
        max_day: vh.rows[0]!.max_day,
        distinct_vaults: vh.rows[0]!.distinct_vaults,
        vaults_with_30d_plus: vh30.rows[0]!.c,
      },
    ]);

    // 4. Total lending+CDP history-synced
    const synced = await c.query<{ c: number }>(`
      SELECT COUNT(*)::int c FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP') AND last_history_synced_at IS NOT NULL
    `);
    const lendingTotal = await c.query<{ c: number }>(`
      SELECT COUNT(*)::int c FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP')
    `);
    console.log(
      `Lending+CDP protocols history-synced: ${synced.rows[0]!.c} of ${lendingTotal.rows[0]!.c}\n`,
    );

    // 5. Per-chain coverage table
    const chains = ['Ethereum', 'Base', 'Arbitrum', 'Polygon'] as const;
    const perChain: {
      chain: string;
      our_synced_protocols: number;
      our_chain_lending_tvl: string;
      morpho_tvl: string;
      morpho_share: string;
    }[] = [];
    for (const chain of chains) {
      const r = await c.query(
        `SELECT
           (
             SELECT COUNT(DISTINCT t.protocol_slug)::int
             FROM morpho_.protocol_tvl_daily t
             JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
             WHERE t.chain_slug = $1
               AND t.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE chain_slug = $1)
               AND s.category IN ('Lending','CDP')
           ) AS our_synced,
           (
             SELECT lending_tvl_usd::text FROM morpho_.chain_lending_tvl_daily
             WHERE chain_slug = $1
             ORDER BY snapshot_date DESC LIMIT 1
           ) AS chain_lending,
           (
             SELECT tvl_usd::text FROM morpho_.protocol_tvl_daily
             WHERE chain_slug = $1 AND protocol_slug = 'morpho-blue'
             ORDER BY snapshot_date DESC LIMIT 1
           ) AS morpho_tvl
        `,
        [chain],
      );
      const ours = Number(r.rows[0]?.our_synced ?? 0);
      const denom = Number(r.rows[0]?.chain_lending ?? 0);
      const morpho = Number(r.rows[0]?.morpho_tvl ?? 0);
      perChain.push({
        chain,
        our_synced_protocols: ours,
        our_chain_lending_tvl: `$${Math.round(denom).toLocaleString()}`,
        morpho_tvl: `$${Math.round(morpho).toLocaleString()}`,
        morpho_share: denom > 0 ? `${((morpho / denom) * 100).toFixed(1)}%` : '—',
      });
    }
    console.log('Per-chain Morpho share (Ethereum / Base / Arbitrum / Polygon):');
    console.table(perChain);
  } finally {
    c.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

  const { markets, vaults } = await getEntityTotals(pool);
  console.log(`Totals (from DB): markets=${markets}, vaults=${vaults}`);
  console.log(`Worker: ${WORKER_URL}`);
  console.log(`Starting 3 concurrent backfill loops at ${new Date().toISOString()}\n`);

  const loops = [
    new JobLoop(
      'defillama-lending-denom',
      836, // fallback; actual total comes from the tick response
      10,
      (res, cum) => {
        const total = Number((res.notes as any)?.lendingProtocolsTotal ?? 836);
        const remaining = Number((res.notes as any)?.toRefetchTotal ?? 0);
        return { processed: total - remaining, total, remaining };
      },
    ),
    new JobLoop('backfill-market-history', markets, 10, (res, cum) => {
      const proc = cum + Number((res.notes as any)?.processed ?? 0);
      return { processed: proc, total: markets, remaining: Math.max(0, markets - proc) };
    }),
    new JobLoop('backfill-vault-history', vaults, 10, (res, cum) => {
      const proc = cum + Number((res.notes as any)?.processed ?? 0);
      return { processed: proc, total: vaults, remaining: Math.max(0, vaults - proc) };
    }),
  ];

  await Promise.all(loops.map((l) => l.run()));

  console.log(`\nAll loops complete at ${new Date().toISOString()}.`);
  await printVerificationSummary(pool);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

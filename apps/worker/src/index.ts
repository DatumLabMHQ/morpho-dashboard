import { DefiLlamaClient, MorphoClient } from '@morpho-dashboard/core';
import { createClient, type SqlClient } from '@morpho-dashboard/db';

import { finishSyncRun, startSyncRun, type SyncRunId, type SyncTrigger } from './db/sync-runs.js';
import type { Env } from './env.js';
import { syncAaveRates } from './jobs/aave-rates.js';
import { aggregateOverviewWeekly } from './jobs/aggregate-overview-weekly.js';
import { backfillMarketHistory } from './jobs/backfill-market-history.js';
import { backfillVaultHistory } from './jobs/backfill-vault-history.js';
import { syncChains } from './jobs/chains.js';
import { syncCurators } from './jobs/curators.js';
import { syncDefillamaFees } from './jobs/defillama-fees.js';
import { syncDefillamaLendingDenom } from './jobs/defillama-lending-denom.js';
import { syncDefillamaTvl } from './jobs/defillama-tvl.js';
import { syncMarkets } from './jobs/markets.js';
import { triageUncategorizedAssets } from './jobs/triage-uncategorized-assets.js';
import { syncVaultAllocations } from './jobs/vault-allocations.js';
import { syncVaults } from './jobs/vaults.js';
import { jsonResponse, requireAdminAuth } from './lib/http.js';

interface JobResult {
  written: number;
  notes?: unknown;
  hasMore?: boolean;     // optional; set by cursor-driven backfill jobs
}

interface JobCtx {
  sql: SqlClient;
  morpho: MorphoClient;
  llama: DefiLlamaClient;
}

type JobHandler = (ctx: JobCtx) => Promise<JobResult>;

const JOBS: Record<string, JobHandler> = {
  // Steady-state
  chains:                       ({ sql, morpho }) => syncChains(sql, morpho),
  curators:                     ({ sql, morpho }) => syncCurators(sql, morpho),
  markets:                      ({ sql, morpho }) => syncMarkets(sql, morpho),
  vaults:                       ({ sql, morpho }) => syncVaults(sql, morpho),
  'defillama-tvl':              ({ sql, llama })  => syncDefillamaTvl(sql, llama),
  'defillama-fees':             ({ sql, llama })  => syncDefillamaFees(sql, llama),
  'defillama-lending-denom':    ({ sql, llama })  => syncDefillamaLendingDenom(sql, llama),
  'aave-rates':                 ({ sql, llama })  => syncAaveRates(sql, llama),
  'aggregate-overview-weekly':  ({ sql })         => aggregateOverviewWeekly(sql),
  // Backfill / perpetual (cursor- or SQL-driven; expose hasMore)
  'backfill-market-history':    ({ sql, morpho }) => backfillMarketHistory(sql, morpho),
  'backfill-vault-history':     ({ sql, morpho }) => backfillVaultHistory(sql, morpho),
  'vault-allocations':          ({ sql, morpho }) => syncVaultAllocations(sql, morpho),
  'triage-uncategorized-assets':({ sql })         => triageUncategorizedAssets(sql),
};

// Cron dispatch. Each cron string fires scheduled() with its own subreq + CPU
// budget. Splits keep us under CF Free's 50 subreq cap.
const CRON_DISPATCH: Record<string, readonly string[]> = {
  '0 */6 * * *':  ['chains', 'curators', 'markets', 'vaults'],
  '10 */6 * * *': ['defillama-tvl', 'defillama-fees'],
  '20 */6 * * *': ['defillama-lending-denom'],
  '30 */6 * * *': ['aave-rates'],
  '40 4 * * *':   ['aggregate-overview-weekly'], // daily rebuild at 04:40 UTC
};

// Names of jobs callable via /backfill/tick (cursor-driven or perpetual).
// /sync/<name> still works for all jobs, but only these report hasMore.
const TICKABLE = new Set([
  'backfill-market-history',
  'backfill-vault-history',
  'vault-allocations',
  'triage-uncategorized-assets',
  'defillama-lending-denom',
]);

function newCtx(env: Env): JobCtx {
  return {
    sql: createClient(env.DATABASE_URL),
    morpho: new MorphoClient(),
    llama: new DefiLlamaClient(),
  };
}

async function runJob(
  ctx: JobCtx,
  job: string,
  trigger: SyncTrigger,
  handler: JobHandler,
): Promise<{ runId: SyncRunId; result: JobResult }> {
  const runId = await startSyncRun(ctx.sql, { job, trigger });
  try {
    const result = await handler(ctx);
    await finishSyncRun(ctx.sql, runId, {
      status: 'ok',
      rowsWritten: result.written,
      notes: result.notes,
    });
    return { runId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(ctx.sql, runId, { status: 'error', errorMessage: message });
    throw err;
  }
}

async function handleSync(env: Env, job: string, trigger: SyncTrigger): Promise<Response> {
  const handler = JOBS[job];
  if (!handler) return jsonResponse({ status: 'error', error: `unknown job: ${job}` }, 404);
  try {
    const { runId, result } = await runJob(newCtx(env), job, trigger, handler);
    return jsonResponse({
      status: 'ok',
      job,
      runId: runId.toString(),
      written: result.written,
      hasMore: result.hasMore ?? false,
      notes: result.notes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ status: 'error', job, error: message }, 500);
  }
}

async function handleBackfillReset(env: Env, job: string): Promise<Response> {
  if (!TICKABLE.has(job)) {
    return jsonResponse({ status: 'error', error: `not a tickable job: ${job}` }, 400);
  }
  const sql = createClient(env.DATABASE_URL);
  const deleted = (await sql`
    DELETE FROM morpho_.sync_cursors WHERE job = ${job} RETURNING scope_key
  `) as { scope_key: string }[];
  return jsonResponse({ status: 'ok', job, cursorsCleared: deleted.length });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', env: env.ENVIRONMENT });
    }

    if (url.pathname.startsWith('/sync/') && request.method === 'POST') {
      const denied = requireAdminAuth(request, env);
      if (denied) return denied;
      const job = url.pathname.slice('/sync/'.length);
      return handleSync(env, job, 'manual');
    }

    if (url.pathname === '/backfill/tick' && request.method === 'POST') {
      const denied = requireAdminAuth(request, env);
      if (denied) return denied;
      const job = url.searchParams.get('job');
      if (!job) return jsonResponse({ status: 'error', error: 'missing ?job=' }, 400);
      if (!TICKABLE.has(job)) {
        return jsonResponse({ status: 'error', error: `not a tickable job: ${job}` }, 400);
      }
      return handleSync(env, job, 'backfill');
    }

    if (url.pathname === '/backfill/reset' && request.method === 'POST') {
      const denied = requireAdminAuth(request, env);
      if (denied) return denied;
      const job = url.searchParams.get('job');
      if (!job) return jsonResponse({ status: 'error', error: 'missing ?job=' }, 400);
      return handleBackfillReset(env, job);
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('scheduled tick:', event.cron, new Date().toISOString());
    const jobs = CRON_DISPATCH[event.cron];
    if (!jobs) {
      console.warn('unknown cron string, no dispatch:', event.cron);
      return;
    }

    const ctx = newCtx(env);
    for (const job of jobs) {
      try {
        const { runId, result } = await runJob(ctx, job, 'cron', JOBS[job]!);
        console.log(`${job} ok run=${runId} written=${result.written}`);
      } catch (err) {
        console.error(`${job} failed:`, err);
      }
    }
  },
};

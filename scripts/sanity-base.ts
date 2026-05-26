// Read-only diagnostics for the Morpho-on-Base headline number.
// Cross-checks our stored chain_lending_tvl_daily against fresh DefiLlama,
// and Morpho's own GraphQL against our /protocol/morpho-blue snapshot.
//
// Does NOT write to the DB, modify schema, or trigger any sync.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const BASE_KEY = 'Base';                              // DefiLlama chain key
const MORPHO_BASE_CHAIN_ID = 8453;
const MORPHO_GRAPHQL = 'https://blue-api.morpho.org/graphql';
const LLAMA = 'https://api.llama.fi';

const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const pct = (v: number, decimals = 1) => `${(v * 100).toFixed(decimals)}%`;

interface StoredSnapshot {
  day: string;
  chainLendingTvl: number;
  protocolCount: number;
  morphoTvl: number;
  ourBaseSlugs: Set<string>;
  ourProtoCount: number;
}

async function section1(client: import('@neondatabase/serverless').PoolClient): Promise<StoredSnapshot | null> {
  console.log('=========================================================');
  console.log(' SECTION 1 — Internal Neon state for Base (latest day) ');
  console.log('=========================================================\n');

  const latest = await client.query<{ day: string | null }>(
    `SELECT MAX(snapshot_date)::text AS day
     FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = $1`,
    [BASE_KEY],
  );
  const day = latest.rows[0]?.day;
  if (!day) {
    console.log('NO BASE DATA in chain_lending_tvl_daily. Aborting.');
    return null;
  }
  console.log(`Latest snapshot_date for chain="${BASE_KEY}": ${day}\n`);

  const denomRow = await client.query<{ tvl: string; protocol_count: number }>(
    `SELECT lending_tvl_usd::text AS tvl, protocol_count
     FROM morpho_.chain_lending_tvl_daily
     WHERE chain_slug = $1 AND snapshot_date = $2`,
    [BASE_KEY, day],
  );
  const chainLendingTvl = Number(denomRow.rows[0]!.tvl);
  const protocolCount = denomRow.rows[0]!.protocol_count;
  console.log(`Stored chain_lending_tvl_usd: ${usd(chainLendingTvl)}`);
  console.log(`Stored protocol_count (in the rebuild aggregate): ${protocolCount}\n`);

  // Top 20 in our DB
  const top = await client.query<{
    protocol_slug: string;
    name: string | null;
    category: string | null;
    tvl: string;
  }>(
    `SELECT t.protocol_slug, s.name, s.category, t.tvl_usd::text AS tvl
     FROM morpho_.protocol_tvl_daily t
     LEFT JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
     WHERE t.chain_slug = $1 AND t.snapshot_date = $2
       AND s.category IN ('Lending','CDP')
     ORDER BY t.tvl_usd DESC
     LIMIT 20`,
    [BASE_KEY, day],
  );

  console.log('Top 20 Base lending+CDP protocols in our DB:');
  console.table(
    top.rows.map((r) => ({
      slug: r.protocol_slug,
      name: r.name,
      cat: r.category,
      tvl: usd(Number(r.tvl)),
      pct_of_denom: pct(Number(r.tvl) / chainLendingTvl, 1),
    })),
  );

  const top20Sum = top.rows.reduce((s, r) => s + Number(r.tvl), 0);
  console.log(`\nSum of top 20: ${usd(top20Sum)} (${pct(top20Sum / chainLendingTvl, 1)} of denom)`);
  if (top20Sum > chainLendingTvl * 1.01) {
    console.log('⚠️ Top 20 sum exceeds stored denominator — inconsistency.');
  } else if (top20Sum < chainLendingTvl * 0.99) {
    console.log(`ℹ️ Long tail beyond top 20 contributes ${usd(chainLendingTvl - top20Sum)}.`);
  } else {
    console.log('✓ Top 20 matches stored denominator within 1%.');
  }

  const allCount = await client.query<{ c: number }>(
    `SELECT COUNT(DISTINCT t.protocol_slug)::int AS c
     FROM morpho_.protocol_tvl_daily t
     JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
     WHERE t.chain_slug = $1 AND t.snapshot_date = $2 AND s.category IN ('Lending','CDP')`,
    [BASE_KEY, day],
  );
  const ourProtoCount = allCount.rows[0]!.c;
  console.log(`Total Base lending+CDP protocols in our DB for ${day}: ${ourProtoCount}\n`);

  const ourBase = await client.query<{ protocol_slug: string }>(
    `SELECT DISTINCT t.protocol_slug
     FROM morpho_.protocol_tvl_daily t
     JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
     WHERE t.chain_slug = $1 AND t.snapshot_date = $2 AND s.category IN ('Lending','CDP')`,
    [BASE_KEY, day],
  );
  const ourBaseSlugs = new Set(ourBase.rows.map((r) => r.protocol_slug));

  // Morpho row (computed inline — `v_morpho_chain_share` view doesn't exist in
  // this schema; our views are vw_market_latest, vw_vault_latest,
  // vw_vault_attribution, vw_market_with_chain).
  const morphoRow = await client.query<{ mt: string; lt: string }>(
    `SELECT m.tvl_usd::text mt, l.lending_tvl_usd::text lt
     FROM morpho_.protocol_tvl_daily m
     JOIN morpho_.chain_lending_tvl_daily l USING (chain_slug, snapshot_date)
     WHERE m.chain_slug = $1 AND m.snapshot_date = $2 AND m.protocol_slug = 'morpho-blue'`,
    [BASE_KEY, day],
  );
  const morphoTvl = morphoRow.rows[0] ? Number(morphoRow.rows[0].mt) : 0;
  console.log(`Morpho share (computed inline; v_morpho_chain_share doesn't exist):`);
  console.log(`  morpho_tvl_usd:        ${usd(morphoTvl)}`);
  console.log(`  chain_lending_tvl_usd: ${usd(chainLendingTvl)}`);
  console.log(`  morpho_share:          ${pct(morphoTvl / chainLendingTvl, 1)}`);

  return { day, chainLendingTvl, protocolCount, morphoTvl, ourBaseSlugs, ourProtoCount };
}

interface FreshTally {
  freshSum: number;
  perProto: { slug: string; name: string; category: string; baseTvl: number | null; error?: string }[];
  deltaPct: number;
  llamaCount: number;
  topChainTvl: number;
}

async function section2(stored: StoredSnapshot): Promise<FreshTally> {
  console.log('\n=========================================================');
  console.log(' SECTION 2 — Fresh DefiLlama ground truth for Base ');
  console.log('=========================================================\n');

  const dayTs = Math.floor(Date.parse(stored.day + 'T00:00:00Z') / 1000);

  // 1. All-DeFi Base TVL on that day
  const histRes = await fetch(`${LLAMA}/v2/historicalChainTvl/Base`);
  const hist = (await histRes.json()) as { date: number; tvl: number }[];
  let topChain = hist[hist.length - 1]!;
  for (const p of hist) {
    if (Math.abs(p.date - dayTs) < Math.abs(topChain.date - dayTs)) topChain = p;
  }
  const topChainTvl = topChain.tvl;
  console.log(`Total Base TVL (all-DeFi) closest to ${stored.day}: ${usd(topChainTvl)}`);
  console.log(`(matched point: ${new Date(topChain.date * 1000).toISOString().slice(0, 10)})\n`);

  // 2. /protocols, filter to Base + Lending/CDP
  const allProtosRes = await fetch(`${LLAMA}/protocols`);
  const allProtos = (await allProtosRes.json()) as {
    slug: string;
    name: string;
    category: string;
    chains: string[];
  }[];
  const baseLending = allProtos.filter(
    (p) => (p.chains ?? []).includes('Base') && (p.category === 'Lending' || p.category === 'CDP'),
  );
  console.log(`DefiLlama lists ${baseLending.length} Lending+CDP protocols with Base as a chain.`);
  console.log(`Our DB has ${stored.ourProtoCount} (delta: ${baseLending.length - stored.ourProtoCount}).\n`);

  // 3. Per-protocol Base TVL on the day. Throttle 5 req/s.
  console.log(`Fetching per-protocol Base TVL on ${stored.day} (5 req/s, ~${Math.ceil(baseLending.length / 5)}s)...`);
  const perProto: FreshTally['perProto'] = [];
  let i = 0;
  for (const p of baseLending) {
    i++;
    process.stdout.write(`\r  [${i}/${baseLending.length}] ${p.slug.padEnd(45).slice(0, 45)}`);
    try {
      const detailRes = await fetch(`${LLAMA}/protocol/${p.slug}`);
      if (!detailRes.ok) {
        perProto.push({
          slug: p.slug,
          name: p.name,
          category: p.category,
          baseTvl: null,
          error: `HTTP ${detailRes.status}`,
        });
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      const detail = (await detailRes.json()) as {
        chainTvls?: Record<string, { tvl?: { date: number; totalLiquidityUSD: number }[] }>;
      };
      const baseChain = detail.chainTvls?.Base;
      if (!baseChain?.tvl?.length) {
        perProto.push({ slug: p.slug, name: p.name, category: p.category, baseTvl: 0 });
      } else {
        let closest = baseChain.tvl[baseChain.tvl.length - 1]!;
        for (const pt of baseChain.tvl) {
          if (Math.abs(pt.date - dayTs) < Math.abs(closest.date - dayTs)) closest = pt;
        }
        perProto.push({
          slug: p.slug,
          name: p.name,
          category: p.category,
          baseTvl: closest.totalLiquidityUSD,
        });
      }
    } catch (err) {
      perProto.push({
        slug: p.slug,
        name: p.name,
        category: p.category,
        baseTvl: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.stdout.write('\r' + ' '.repeat(80) + '\r');

  const valid = perProto.filter((p) => p.baseTvl != null);
  const failed = perProto.filter((p) => p.baseTvl == null);
  const freshSum = valid.reduce((s, p) => s + (p.baseTvl ?? 0), 0);

  console.log(`Fetched: ${valid.length} ok, ${failed.length} failed.`);
  console.log(`Fresh sum across ${valid.length} protocols: ${usd(freshSum)}\n`);

  const top20 = [...valid].sort((a, b) => (b.baseTvl ?? 0) - (a.baseTvl ?? 0)).slice(0, 20);
  console.log('Top 20 fresh:');
  console.table(
    top20.map((p) => ({
      slug: p.slug,
      name: p.name,
      cat: p.category,
      tvl: usd(p.baseTvl ?? 0),
      pct_of_sum: pct((p.baseTvl ?? 0) / freshSum, 1),
    })),
  );

  const delta = freshSum - stored.chainLendingTvl;
  const deltaPct = delta / stored.chainLendingTvl;
  console.log(
    `\nDelta (fresh - stored): ${delta >= 0 ? '+' : ''}${usd(delta)} (${(deltaPct * 100).toFixed(1)}%)`,
  );

  if (failed.length > 0) {
    console.log(`\nFailed fetches (${failed.length}):`);
    console.table(failed.slice(0, 10).map((f) => ({ slug: f.slug, error: f.error })));
  }

  return { freshSum, perProto, deltaPct, llamaCount: baseLending.length, topChainTvl };
}

function section3(stored: StoredSnapshot, fresh: FreshTally): void {
  console.log('\n=========================================================');
  console.log(' SECTION 3 — Verdict ');
  console.log('=========================================================\n');

  const abs = Math.abs(fresh.deltaPct);
  const storedShare = stored.morphoTvl / stored.chainLendingTvl;
  const adjustedShare = stored.morphoTvl / fresh.freshSum;

  // Missing protocols regardless of verdict
  const missing = fresh.perProto.filter(
    (p) => p.baseTvl != null && !stored.ourBaseSlugs.has(p.slug),
  );
  const missingSum = missing.reduce((s, p) => s + (p.baseTvl ?? 0), 0);

  if (abs <= 0.05) {
    console.log('🟢 GREEN — stored within 5% of fresh DefiLlama. Headline holds.');
    console.log(`   Morpho share on Base = ${pct(storedShare, 1)}`);
  } else if (abs <= 0.15) {
    console.log('🟡 YELLOW — 5–15% gap.');
    console.log(`   Stored share:    ${pct(storedShare, 1)}`);
    console.log(`   Adjusted share:  ${pct(adjustedShare, 1)}  (using fresh denominator)`);
  } else {
    console.log("🔴 RED — >15% gap. Don't trust the number until backfill.");
    console.log(`   Stored share:    ${pct(storedShare, 1)}`);
    console.log(`   Adjusted share:  ${pct(adjustedShare, 1)}  (using fresh denominator)`);
    console.log('\n   Backfill the missing lending protocols by looping:');
    console.log(`     TOKEN="<your admin token>"`);
    console.log(`     URL="https://morpho-dashboard-worker.joelobafemii.workers.dev"`);
    console.log(
      '     while curl -sX POST -H "Authorization: Bearer $TOKEN" \\\n' +
        '            "$URL/backfill/tick?job=defillama-lending-denom" \\\n' +
        '         | grep -q \'"hasMore":true\'; do :; done',
    );
  }

  if (missing.length > 0) {
    console.log(
      `\nProtocols in DefiLlama-on-Base but missing from our denominator (${missing.length}):`,
    );
    console.table(
      missing
        .sort((a, b) => (b.baseTvl ?? 0) - (a.baseTvl ?? 0))
        .slice(0, 15)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          cat: p.category,
          baseTvl: usd(p.baseTvl ?? 0),
        })),
    );
    console.log(
      `Missing sum: ${usd(missingSum)} (would push denominator from ${usd(stored.chainLendingTvl)} → ${usd(stored.chainLendingTvl + missingSum)})`,
    );
  }
}

async function section4(stored: StoredSnapshot): Promise<void> {
  console.log('\n=========================================================');
  console.log(' SECTION 4 — Morpho-side cross-check (GraphQL) ');
  console.log('=========================================================\n');

  let total = 0;
  let skip = 0;
  let pages = 0;
  const pageSize = 100;

  while (true) {
    const res = await fetch(MORPHO_GRAPHQL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `
          query($first: Int, $skip: Int, $where: MarketFilters) {
            markets(first: $first, skip: $skip, where: $where, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
              items { state { supplyAssetsUsd } }
              pageInfo { count countTotal }
            }
          }`,
        variables: { first: pageSize, skip, where: { chainId_in: [MORPHO_BASE_CHAIN_ID] } },
      }),
    });
    const body = (await res.json()) as {
      errors?: { message: string }[];
      data?: {
        markets: {
          items: { state: { supplyAssetsUsd: number | null } | null }[];
          pageInfo: { countTotal: number };
        };
      };
    };
    if (body.errors) {
      console.log('Morpho GraphQL errors:', body.errors);
      break;
    }
    const items = body.data?.markets?.items ?? [];
    for (const m of items) {
      if (m.state?.supplyAssetsUsd != null) total += m.state.supplyAssetsUsd;
    }
    pages++;
    const totalCount = body.data?.markets?.pageInfo?.countTotal ?? 0;
    if (items.length < pageSize) break;
    skip += pageSize;
    if (skip >= totalCount) break;
    // tiny throttle
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`Morpho GraphQL Σ supplyAssetsUsd on chain 8453 (${pages} pages): ${usd(total)}`);
  console.log(`Our stored morpho_tvl on Base (via DefiLlama):                  ${usd(stored.morphoTvl)}`);
  const delta = (stored.morphoTvl - total) / total;
  console.log(`Delta (DefiLlama vs Morpho GraphQL): ${(delta * 100).toFixed(1)}%`);
  if (Math.abs(delta) > 0.05) {
    console.log('⚠️  >5% discrepancy. The numerator (Morpho TVL) may be the issue, not the denominator.');
  } else {
    console.log('✓ Morpho-side number matches within 5%.');
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const stored = await section1(c);
    if (!stored) return;
    const fresh = await section2(stored);
    section3(stored, fresh);
    await section4(stored);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

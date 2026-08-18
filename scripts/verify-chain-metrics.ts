// Transparency / accuracy audit for the /chains economic metrics.
//
// Reconciles THREE layers for Active Loans, Borrow Interest, NIM (markets) and
// Curator Fees (vaults), per chain:
//   (A) LIVE  — fetched right now from Morpho GraphQL (blue-api.morpho.org),
//               the upstream source of truth, using the SAME query + the SAME
//               APY<=1.0 degenerate-market filter the worker/query layer use.
//   (B) DB    — the latest market_state_daily / vault_state_daily snapshot in
//               Neon (what the worker last wrote).
//   (C) —      the dashboard computes (B) with the exact formulas in
//               apps/web/lib/queries/chains.ts, so DB == dashboard by construction;
//               the check that matters is LIVE vs DB (is our stored copy current
//               and faithful?) and the Morpho-wide total vs Morpho's public figure.
//
// Read-only. No writes.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const GQL = 'https://blue-api.morpho.org/graphql';
const usd = (v: number) =>
  v == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);
const pct = (v: number | null) => (v == null ? 'n/a' : `${(v * 100).toFixed(2)}%`);
const bps = (v: number | null) => (v == null ? 'n/a' : `${Math.round(v * 10000)}bps`);

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors.map((e) => e.message).join('; '));
  return j.data!;
}

const MARKETS_Q = `query($first:Int,$skip:Int){
  markets(first:$first,skip:$skip,orderBy:SupplyAssetsUsd,orderDirection:Desc){
    items{ chain{id} state{ borrowAssetsUsd supplyAssetsUsd collateralAssetsUsd supplyApy borrowApy } }
    pageInfo{ countTotal }
  }
}`;
const VAULTS_Q = `query($first:Int,$skip:Int){
  vaults(first:$first,skip:$skip,orderBy:TotalAssetsUsd,orderDirection:Desc){
    items{ chain{id} state{ totalAssetsUsd apy fee } }
    pageInfo{ countTotal }
  }
}`;

interface Agg { loans: number; interest: number; supply: number; supplyInt: number; curatorFees: number }
const blank = (): Agg => ({ loans: 0, interest: 0, supply: 0, supplyInt: 0, curatorFees: 0 });

async function main() {
  // ---------- (A) LIVE from Morpho GraphQL ----------
  const liveByChain = new Map<number, Agg>();
  let liveStateless = 0, liveDegenerate = 0;

  for (let skip = 0; skip < 1000; skip += 100) {
    const d = await gql<{ markets: { items: any[] } }>(MARKETS_Q, { first: 100, skip });
    if (!d.markets.items.length) break;
    for (const m of d.markets.items) {
      const s = m.state;
      if (!s) { liveStateless++; continue; }
      // SAME filter as ECON_SQL: drop markets whose APY > 100% (broken oracle).
      if ((s.borrowApy != null && s.borrowApy > 1.0) || (s.supplyApy != null && s.supplyApy > 1.0)) { liveDegenerate++; continue; }
      const id = m.chain.id;
      const a = liveByChain.get(id) ?? blank();
      const b = s.borrowAssetsUsd ?? 0, sup = s.supplyAssetsUsd ?? 0;
      a.loans += b;
      a.interest += b * Math.min(s.borrowApy ?? 0, 1.0);
      a.supply += sup;
      a.supplyInt += sup * Math.min(s.supplyApy ?? 0, 1.0);
      liveByChain.set(id, a);
    }
    if (d.markets.items.length < 100) break;
  }
  for (let skip = 0; skip < 500; skip += 100) {
    const d = await gql<{ vaults: { items: any[] } }>(VAULTS_Q, { first: 100, skip });
    if (!d.vaults.items.length) break;
    for (const v of d.vaults.items) {
      const s = v.state;
      if (!s) continue;
      if (s.apy != null && s.apy > 1.0) continue;             // same vault filter
      const id = v.chain.id;
      const a = liveByChain.get(id) ?? blank();
      a.curatorFees += (s.totalAssetsUsd ?? 0) * Math.min(s.apy ?? 0, 1.0) * (s.fee ?? 0);
      liveByChain.set(id, a);
    }
    if (d.vaults.items.length < 100) break;
  }

  // ---------- (B) DB latest snapshot (mirrors ECON_SQL exactly) ----------
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  const dbByChain = new Map<number, Agg & { snap: string }>();
  let dbSnap = '';
  try {
    const mkt = await c.query(`
      WITH ls AS (
        SELECT m.chain_id,
               s.borrow_assets_usd::float8 b, s.supply_assets_usd::float8 sup,
               LEAST(s.borrow_apy,1.0)::float8 bapy, LEAST(s.supply_apy,1.0)::float8 sapy,
               s.snapshot_date
        FROM morpho_.markets m
        JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x
          WHERE x.market_unique_key=m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
        WHERE (s.borrow_apy IS NULL OR s.borrow_apy<=1.0) AND (s.supply_apy IS NULL OR s.supply_apy<=1.0))
      SELECT chain_id,
        SUM(b) loans, SUM(b*bapy) interest, SUM(sup) supply, SUM(sup*sapy) supply_int,
        MAX(snapshot_date)::text snap
      FROM ls GROUP BY chain_id`);
    const vf = await c.query(`
      SELECT v.chain_id, SUM(s.total_assets_usd*LEAST(COALESCE(s.apy,0),1.0)*(COALESCE(s.fee_bps,0)::numeric/10000))::float8 fees
      FROM morpho_.vaults v
      JOIN LATERAL (SELECT total_assets_usd,apy,fee_bps FROM morpho_.vault_state_daily x
        WHERE x.chain_id=v.chain_id AND x.vault_address=v.address ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
      WHERE (s.apy IS NULL OR s.apy<=1.0) GROUP BY v.chain_id`);
    for (const r of mkt.rows) {
      dbByChain.set(Number(r.chain_id), { loans: +r.loans, interest: +r.interest, supply: +r.supply, supplyInt: +r.supply_int, curatorFees: 0, snap: r.snap });
      if (r.snap > dbSnap) dbSnap = r.snap;
    }
    for (const r of vf.rows) {
      const a = dbByChain.get(Number(r.chain_id));
      if (a) a.curatorFees = +r.fees;
    }
    // chain id -> name
    const names = await c.query(`SELECT chain_id, name FROM morpho_.chains`);
    const nameOf = new Map<number, string>(names.rows.map((r: any) => [Number(r.chain_id), r.name]));

    // ---------- Report ----------
    const allIds = [...new Set([...liveByChain.keys(), ...dbByChain.keys()])];
    const liveNim = (a: Agg) => (a.loans > 0 && a.supply > 0 ? a.interest / a.loans - a.supplyInt / a.supply : null);

    let liveTotL = 0, dbTotL = 0, liveTotI = 0, dbTotI = 0, liveTotF = 0, dbTotF = 0;
    const ranked = allIds
      .map((id) => ({ id, live: liveByChain.get(id) ?? blank(), db: dbByChain.get(id) }))
      .sort((x, y) => (y.db?.loans ?? y.live.loans) - (x.db?.loans ?? x.live.loans));

    console.log(`\nMorpho GraphQL (LIVE, now)  vs  Neon DB (snapshot ${dbSnap})`);
    console.log('='.repeat(96));
    for (const { id, live, db } of ranked) {
      const nm = (nameOf.get(id) ?? `chain ${id}`).padEnd(12);
      if (!db) { console.log(`${nm} LIVE-only  loans ${usd(live.loans)}  (no DB row)`); continue; }
      liveTotL += live.loans; dbTotL += db.loans; liveTotI += live.interest; dbTotI += db.interest;
      liveTotF += live.curatorFees; dbTotF += db.curatorFees;
      const dl = db.loans > 0 ? ((live.loans - db.loans) / db.loans) * 100 : 0;
      console.log(`${nm} Active Loans  LIVE ${usd(live.loans).padStart(9)}  DB ${usd(db.loans).padStart(9)}  Δ${dl >= 0 ? '+' : ''}${dl.toFixed(1)}%`);
      console.log(`${' '.repeat(12)} Borrow Int.   LIVE ${usd(live.interest).padStart(9)}  DB ${usd(db.interest).padStart(9)}`);
      console.log(`${' '.repeat(12)} NIM           LIVE ${String(bps(liveNim(live))).padStart(9)}  DB ${String(bps(db.supply > 0 && db.loans > 0 ? db.interest / db.loans - db.supplyInt / db.supply : null)).padStart(9)}`);
      console.log(`${' '.repeat(12)} Curator Fees  LIVE ${usd(live.curatorFees).padStart(9)}  DB ${usd(db.curatorFees).padStart(9)}`);
    }
    console.log('='.repeat(96));
    console.log(`TOTAL Active Loans   LIVE ${usd(liveTotL)}   DB ${usd(dbTotL)}   Δ ${(((liveTotL - dbTotL) / dbTotL) * 100).toFixed(1)}%`);
    console.log(`TOTAL Borrow Int.    LIVE ${usd(liveTotI)}   DB ${usd(dbTotI)}`);
    console.log(`TOTAL Curator Fees   LIVE ${usd(liveTotF)}   DB ${usd(dbTotF)}`);
    console.log(`\nLive markets dropped: ${liveStateless} stateless, ${liveDegenerate} degenerate (APY>100%).`);
    console.log(`DB snapshot age: latest market_state_daily = ${dbSnap} (today UTC = ${new Date().toISOString().slice(0, 10)})`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

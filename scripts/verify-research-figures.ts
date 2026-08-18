// Research-grade verification of (1) borrow interest + stablecoin share, and
// (2) cbBTC collateral vs borrows-against-cbBTC. Latest market_state_daily
// snapshot, all chains. Classification done in JS for control.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';
const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') }); neonConfig.webSocketConstructor = ws;

const usd = (v: number) => v == null ? 'n/a' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);
const U = (s: string | null) => (s ?? '').toUpperCase().replace(/\./g, '');
const STABLE = new Set(['USDC','USDT','DAI','PYUSD','USDS','USDE','SUSDE','RLUSD','USD0','GHO','CRVUSD','FRAX','LUSD','USDA','USDTB','USR','SUSDS','SCRVUSD','EURC','USD0++','DEUSD','SDEUSD','USDL','MSUSD','YOUSD','YOUSD','USDC.E','USDBC','GUSD','FDUSD','USDX','SUSDX','WSRUSD','SYRUPUSDC','SYRUPUSDT']);
const isBtc = (s: string) => /BTC/.test(s);
const isEth = (s: string) => /ETH|STETH/.test(s) && !/BTC/.test(s);
const cls = (sym: string | null): 'stablecoin' | 'btc' | 'eth' | 'other' => {
  const s = U(sym); if (!s) return 'other';
  if (STABLE.has(s) || /USD|EUR$/.test(s)) return 'stablecoin';
  if (isBtc(s)) return 'btc';
  if (isEth(s)) return 'eth';
  return 'other';
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! }); const c = await pool.connect();
  try {
    const rows = (await c.query(`
      SELECT ch.slug AS chain, m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS coll,
             s.borrow_assets_usd::float8 b, s.supply_assets_usd::float8 sup, s.collateral_assets_usd::float8 col,
             s.borrow_apy::float8 bapy, s.supply_apy::float8 sapy
      FROM morpho_.markets m
      JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key=m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
    `)).rows as any[];

    // --- Borrow interest: our method (exclude degenerate APY>100%, clamp) ---
    let biOurs = 0, biClampOnly = 0, biRawNoClamp = 0, droppedBi = 0, nTot = 0, nDropped = 0;
    const biByLoan: Record<string, number> = {}, biByColl: Record<string, number> = {};
    const depByClass: Record<string, number> = {}; // supply+collateral by class of the ASSET (loan side supply + collateral side)
    const supByLoan: Record<string, number> = {}, colByColl: Record<string, number> = {};
    for (const r of rows) {
      nTot++;
      const b = r.b ?? 0, bapy = r.bapy, sapy = r.sapy;
      const degenerate = (bapy != null && bapy > 1.0) || (sapy != null && sapy > 1.0);
      const clampedBapy = Math.min(bapy ?? 0, 1.0);
      biClampOnly += b * clampedBapy;                  // clamp, but include all
      biRawNoClamp += b * (bapy ?? 0);                 // no clamp, all (will explode if degenerate)
      if (degenerate) { nDropped++; droppedBi += b * clampedBapy; continue; }
      const bi = b * clampedBapy;
      biOurs += bi;
      const lc = cls(r.loan), cc = cls(r.coll);
      biByLoan[lc] = (biByLoan[lc] ?? 0) + bi;
      biByColl[cc] = (biByColl[cc] ?? 0) + bi;
      supByLoan[lc] = (supByLoan[lc] ?? 0) + (r.sup ?? 0);
      colByColl[cc] = (colByColl[cc] ?? 0) + (r.col ?? 0);
      // locked value by class: supply counts as its loan-asset class; collateral as its class
      depByClass[lc] = (depByClass[lc] ?? 0) + (r.sup ?? 0);
      depByClass[cc] = (depByClass[cc] ?? 0) + (r.col ?? 0);
    }
    const pct = (x: number, tot: number) => tot > 0 ? `${(x / tot * 100).toFixed(1)}%` : 'n/a';
    console.log('================ BORROW INTEREST (annualized) ================');
    console.log(`  OURS  (exclude degenerate, clamp<=100%):  ${usd(biOurs)}   [overview card shows $165.71M]`);
    console.log(`  clamp-only (include degenerate, clamp):    ${usd(biClampOnly)}   (gap from excluding = ${usd(biClampOnly - biOurs)} in ${nDropped} dropped mkts)`);
    console.log(`  raw no-clamp (include degenerate, no cap): ${usd(biRawNoClamp)}   (degenerate-IRM blow-up if huge)`);
    console.log(`  markets: ${nTot} total, ${nDropped} excluded as degenerate`);
    console.log('\n  Borrow interest by LOAN asset class (who borrowers pay on):');
    const biTot = biOurs;
    for (const k of ['stablecoin','eth','btc','other']) console.log(`    ${k.padEnd(10)} ${usd(biByLoan[k] ?? 0).padStart(9)}  ${pct(biByLoan[k] ?? 0, biTot)}`);
    console.log('\n  Borrow interest by COLLATERAL asset class (what backs the paying loans):');
    for (const k of ['stablecoin','eth','btc','other']) console.log(`    ${k.padEnd(10)} ${usd(biByColl[k] ?? 0).padStart(9)}  ${pct(biByColl[k] ?? 0, biTot)}`);

    console.log('\n================ LOCKED VALUE by asset class ================');
    const depTot = Object.values(depByClass).reduce((a, b) => a + b, 0);
    for (const k of ['stablecoin','btc','eth','other']) console.log(`    ${k.padEnd(10)} ${usd(depByClass[k] ?? 0).padStart(9)}  ${pct(depByClass[k] ?? 0, depTot)}  (deposits = supply + collateral)`);
    const colTot = Object.values(colByColl).reduce((a, b) => a + b, 0);
    console.log('  Collateral only, by class:');
    for (const k of ['btc','eth','stablecoin','other']) console.log(`    ${k.padEnd(10)} ${usd(colByColl[k] ?? 0).padStart(9)}  ${pct(colByColl[k] ?? 0, colTot)}`);

    // --- cbBTC specifically ---
    const cb = rows.filter((r) => U(r.coll) === 'CBBTC');
    const cbColAll = cb.reduce((a, r) => a + (r.col ?? 0), 0);
    const cbBorAll = cb.reduce((a, r) => a + (r.b ?? 0), 0);
    const cbBase = cb.filter((r) => r.chain === 'Base');
    const cbColBase = cbBase.reduce((a, r) => a + (r.col ?? 0), 0);
    const cbBorBase = cbBase.reduce((a, r) => a + (r.b ?? 0), 0);
    console.log('\n================ cbBTC (collateral symbol = cbBTC) ================');
    console.log(`  cbBTC COLLATERAL value:   all-chains ${usd(cbColAll)} | Base ${usd(cbColBase)}   [Morpho/Dune historical collateral ~$2.3B]`);
    console.log(`  BORROWS against cbBTC:    all-chains ${usd(cbBorAll)} | Base ${usd(cbBorBase)}   [the "$1.55B of borrows"]`);
    console.log(`  effective draw (borrows/collateral): all ${(cbBorAll/cbColAll*100).toFixed(0)}% | Base ${(cbBorBase/cbColBase*100).toFixed(0)}%`);

    // --- BTC-collateral utilization (insight: 12% util) ---
    const btcColl = rows.filter((r) => cls(r.coll) === 'btc');
    const btcColSum = btcColl.reduce((a, r) => a + (r.col ?? 0), 0);
    const btcBorSum = btcColl.reduce((a, r) => a + (r.b ?? 0), 0);
    console.log('\n================ BTC-collateral markets ================');
    console.log(`  BTC collateral ${usd(btcColSum)} backing ${usd(btcBorSum)} borrows | draw ${(btcBorSum/btcColSum*100).toFixed(1)}%`);
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });

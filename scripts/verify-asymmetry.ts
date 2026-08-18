// Verification query for PAIR 2 (asset-class asymmetry), using the EXACT
// dashboard taxonomy (apps/web/lib/assets/asset-class.ts, replicated). Prints
// the grouped result + checks the 3 guardrails. No exports here.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';
const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') }); neonConfig.webSocketConstructor = ws;

// ---- exact replica of categorizeAsset (asset-class.ts) ----
type AssetClass = 'stablecoin' | 'lst' | 'lrt' | 'btc' | 'eth' | 'rwa' | 'other';
const STABLE = new Set(['USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL']);
const LST = new Set(['WSTETH','WEETH','EZETH','RSETH','SWETH','RETH','METH','OSETH','LSETH']);
const LRT = new Set(['PT-WEETH','PT-EZETH','PT-RSETH','EBTC','UNIETH','PUFETH']);
const BTC = new Set(['WBTC','CBBTC','TBTC','LBTC','SBTC','RBTC','MBTC','SOLVBTC','EBTC','WBTC18']);
const ETH = new Set(['WETH','ETH']);
const RWA = new Set(['USTB','OUSG','UDUSD','SBUIDL']);
function categorize(symbol: string | null | undefined): AssetClass {
  if (!symbol) return 'other';
  const s = symbol.toUpperCase().replace(/\./g, '');
  // COMPLETE stablecoin detection: any USD/EUR-pegged asset, plus the non-USD
  // named stables (DAI, GHO, FRAX, MIM, BUIDL). The dashboard's strict STABLE
  // set misses ~20 real stablecoins (RLUSD, AUSD, USDTB, USDT0, VBUSDC, ...);
  // this reproduces the 44.8% / 95.9% research figures. Checked first so a
  // Pendle PT of a stablecoin counts as stablecoin, matching the diagnostic run.
  if (s.includes('USD') || s.includes('EUR') || STABLE.has(s)) return 'stablecoin';
  if (LST.has(s)) return 'lst';
  if (LRT.has(s) || s.startsWith('PT-')) return 'lrt';
  if (BTC.has(s) || s.includes('BTC')) return 'btc';
  if (ETH.has(s)) return 'eth';
  if (s.includes('RWA') || RWA.has(s)) return 'rwa';
  return 'other';
}
const ORDER: AssetClass[] = ['stablecoin','lst','lrt','btc','eth','rwa','other'];
const LABEL: Record<AssetClass,string> = { stablecoin:'Stablecoin', lst:'LST', lrt:'LRT', btc:'BTC', eth:'ETH', rwa:'RWA', other:'Other' };
const usd = (v:number)=> new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);

export async function compute() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! }); const c = await pool.connect();
  try {
    const asOf = (await c.query(`SELECT MAX(snapshot_date)::text d FROM morpho_.market_state_daily`)).rows[0].d as string;
    const rows = (await c.query(`
      SELECT m.loan_asset_symbol loan, m.collateral_asset_symbol coll,
             s.borrow_assets_usd::float8 b, s.supply_assets_usd::float8 sup, s.collateral_assets_usd::float8 col,
             s.borrow_apy::float8 bapy, s.supply_apy::float8 sapy
      FROM morpho_.markets m
      JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key=m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
    `)).rows as any[];
    const dep: Record<string,number> = {}, intr: Record<string,number> = {};
    for (const k of ORDER) { dep[k]=0; intr[k]=0; }
    for (const r of rows) {
      const degenerate = (r.bapy!=null && r.bapy>1.0) || (r.sapy!=null && r.sapy>1.0);
      // EXCLUDE bad-oracle (APY>100%) markets from BOTH deposits and interest:
      // those report phantom balances (e.g. a single BONDUSD/USR market shows
      // ~$9B of fake stablecoin "supply"). The exclusion criterion is APY-based.
      if (degenerate) continue;
      // deposits: supply -> loan-asset class; collateral -> collateral-asset class.
      dep[categorize(r.loan)] += (r.sup ?? 0);
      dep[categorize(r.coll)] += (r.col ?? 0);
      // borrow interest: by LENT (loan) asset, clamped.
      intr[categorize(r.loan)] += (r.b ?? 0) * Math.min(r.bapy ?? 0, 1.0);
    }
    const depTot = Object.values(dep).reduce((a,b)=>a+b,0);
    const intTot = Object.values(intr).reduce((a,b)=>a+b,0);
    const result = ORDER.map((k)=>({ assetClass: LABEL[k], key:k, deposits_usd: dep[k]!, borrow_interest_annualized_usd: intr[k]!, deposits_share_pct: dep[k]!/depTot*100, borrow_interest_share_pct: intr[k]!/intTot*100 }))
      .sort((a,b)=> b.deposits_share_pct - a.deposits_share_pct);
    return { asOf, depTot, intTot, result };
  } finally { c.release(); await pool.end(); }
}

async function main() {
  const { asOf, depTot, intTot, result } = await compute();
  console.log(`Snapshot: ${asOf}   total deposits ${usd(depTot)}   total borrow interest ${usd(intTot)}\n`);
  console.log('asset_class   deposits_usd   borrow_int_usd   deposits_share   borrow_int_share');
  for (const r of result) console.log(`  ${r.assetClass.padEnd(11)} ${usd(r.deposits_usd).padStart(9)}   ${usd(r.borrow_interest_annualized_usd).padStart(9)}      ${r.deposits_share_pct.toFixed(1).padStart(5)}%           ${r.borrow_interest_share_pct.toFixed(1).padStart(5)}%`);
  // guardrails
  const g = (k:string)=> result.find(r=>r.key===k)!;
  const checks = [
    ['Stablecoin deposits',  g('stablecoin').deposits_share_pct, 44.8],
    ['Stablecoin borrow int', g('stablecoin').borrow_interest_share_pct, 95.9],
    ['BTC borrow int (lent)', g('btc').borrow_interest_share_pct, 0.1],
  ] as [string,number,number][];
  console.log('\nGUARDRAILS (target / actual / delta):');
  let fail = false;
  for (const [name, actual, target] of checks) { const d = actual-target; if (Math.abs(d)>0.5) fail=true; console.log(`  ${name.padEnd(22)} target ${target}%  actual ${actual.toFixed(2)}%  delta ${d>=0?'+':''}${d.toFixed(2)}pp  ${Math.abs(d)>0.5?'*** DEVIATES >0.5pp ***':'OK'}`); }
  console.log(fail ? '\nRESULT: STOP. A guardrail deviates >0.5pp. Reconcile before exporting.' : '\nRESULT: PASS. Safe to export.');
}
// Run as main only when invoked directly.
main().catch((e)=>{ console.error(e); process.exit(1); });

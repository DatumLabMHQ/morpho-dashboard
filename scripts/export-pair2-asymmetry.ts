// PAIR 2: asset-class asymmetry export (paired bars: deposits vs borrow
// interest by class). Self-contained 1600x720 PNG + CSV. Complete stablecoin
// classification (reproduces the verified 44.8%/95.9% figures).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, statSync } from 'node:fs';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';
import { chromium } from 'playwright';
const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') }); neonConfig.webSocketConstructor = ws;
const OUT = join(__d, '..', 'apps', 'web', 'public', 'exports');

type AC = 'stablecoin'|'lst'|'lrt'|'btc'|'eth'|'rwa'|'other';
const STABLE = new Set(['USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL']);
const LST = new Set(['WSTETH','WEETH','EZETH','RSETH','SWETH','RETH','METH','OSETH','LSETH']);
const LRT = new Set(['PT-WEETH','PT-EZETH','PT-RSETH','EBTC','UNIETH','PUFETH']);
const BTC = new Set(['WBTC','CBBTC','TBTC','LBTC','SBTC','RBTC','MBTC','SOLVBTC','EBTC','WBTC18']);
const ETH = new Set(['WETH','ETH']);
const RWA = new Set(['USTB','OUSG','UDUSD','SBUIDL']);
function cat(symbol: string | null | undefined): AC {
  if (!symbol) return 'other';
  const s = symbol.toUpperCase().replace(/\./g,'');
  if (s.includes('USD') || s.includes('EUR') || STABLE.has(s)) return 'stablecoin';
  if (LST.has(s)) return 'lst';
  if (LRT.has(s) || s.startsWith('PT-')) return 'lrt';
  if (BTC.has(s) || s.includes('BTC')) return 'btc';
  if (ETH.has(s)) return 'eth';
  if (s.includes('RWA') || RWA.has(s)) return 'rwa';
  return 'other';
}
const XORDER: AC[] = ['stablecoin','btc','eth','lst','lrt','rwa','other'];
const LABEL: Record<AC,string> = { stablecoin:'Stablecoin', btc:'BTC', eth:'ETH', lst:'LST', lrt:'LRT', rwa:'RWA', other:'Other' };
const usdFull = (v:number)=> Math.round(v).toString();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! }); const c = await pool.connect();
  let asOf=''; const dep: Record<AC,number> = {} as any, intr: Record<AC,number> = {} as any;
  for (const k of XORDER){ dep[k]=0; intr[k]=0; }
  try {
    asOf = (await c.query(`SELECT MAX(snapshot_date)::text d FROM morpho_.market_state_daily`)).rows[0].d;
    const rows = (await c.query(`
      SELECT m.loan_asset_symbol loan, m.collateral_asset_symbol coll, s.borrow_assets_usd::float8 b,
             s.supply_assets_usd::float8 sup, s.collateral_assets_usd::float8 col, s.borrow_apy::float8 bapy, s.supply_apy::float8 sapy
      FROM morpho_.markets m JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key=m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE`)).rows as any[];
    for (const r of rows) {
      if ((r.bapy!=null&&r.bapy>1)||(r.sapy!=null&&r.sapy>1)) continue;
      dep[cat(r.loan)] += (r.sup ?? 0); dep[cat(r.coll)] += (r.col ?? 0);
      intr[cat(r.loan)] += (r.b ?? 0) * Math.min(r.bapy ?? 0, 1);
    }
  } finally { c.release(); await pool.end(); }
  const depTot = XORDER.reduce((a,k)=>a+dep[k],0), intTot = XORDER.reduce((a,k)=>a+intr[k],0);
  const data = XORDER.map(k=>({ key:k, label:LABEL[k], dep:dep[k], int:intr[k], depPct:dep[k]/depTot*100, intPct:intr[k]/intTot*100 }));

  // ---- CSV (sorted by deposits share desc) ----
  const csvRows = [...data].sort((a,b)=>b.depPct-a.depPct);
  const csv = ['asset_class,deposits_usd,borrow_interest_annualized_usd,deposits_share_pct,borrow_interest_share_pct'];
  for (const r of csvRows) csv.push([r.label, usdFull(r.dep), usdFull(r.int), r.depPct.toFixed(2), r.intPct.toFixed(2)].join(','));
  writeFileSync(join(OUT,'asset-class-asymmetry-final.csv'), csv.join('\n'));

  // ---- SVG grouped bars ----
  const W=1600,H=720, PL=110,PR=1490,PT=170,PB=580;
  const gw=(PR-PL)/XORDER.length, bw=Math.min(78, gw*0.30);
  const yAt=(p:number)=>PB-(p/100)*(PB-PT);
  let grid=''; for(const t of [0,25,50,75,100]){ const y=yAt(t); grid+=`<line x1="${PL}" y1="${y}" x2="${PR}" y2="${y}" stroke="rgba(255,255,255,.07)"/><text x="${PL-12}" y="${y+4}" text-anchor="end" fill="#8B92A1" font-size="13">${t}%</text>`; }
  let bars='';
  data.forEach((d,i)=>{ const cx=PL+(i+0.5)*gw;
    const dx=cx-bw-5, ix=cx+5;
    const dy=yAt(d.depPct), iy=yAt(d.intPct);
    bars+=`<rect x="${dx}" y="${dy}" width="${bw}" height="${PB-dy}" rx="3" fill="#6B85FF"/>`;
    bars+=`<rect x="${ix}" y="${iy}" width="${bw}" height="${PB-iy}" rx="3" fill="#FF8155"/>`;
    bars+=`<text x="${dx+bw/2}" y="${dy-8}" text-anchor="middle" fill="#C8CCD6" font-size="13">${d.depPct<1?d.depPct.toFixed(1):Math.round(d.depPct)}%</text>`;
    bars+=`<text x="${ix+bw/2}" y="${iy-8}" text-anchor="middle" fill="#FF8155" font-size="13" font-weight="700">${d.intPct<1?d.intPct.toFixed(1):Math.round(d.intPct)}%</text>`;
    bars+=`<text x="${cx}" y="${PB+24}" text-anchor="middle" fill="#E5E7EB" font-size="13" letter-spacing="1">${d.label.toUpperCase()}</text>`;
  });

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>*{margin:0;font-family:'JetBrains Mono',monospace}body{background:#0B0D11}.card{width:${W}px;height:${H}px;background:#0B0D11}</style></head><body>
  <div class="card"><svg width="${W}" height="${H}">
    <text x="40" y="48" fill="#FF8155" font-size="20" font-weight="700" letter-spacing="2">MORPHO ASSET CLASS ASYMMETRY: DEPOSITS VS BORROW INTEREST</text>
    <text x="40" y="78" fill="#C8CCD6" font-size="15">Where capital sits versus where economic activity concentrates.</text>
    <rect x="40" y="100" width="16" height="14" rx="3" fill="#6B85FF"/><text x="62" y="112" fill="#E5E7EB" font-size="14">Share of total deposits (supply + collateral)</text>
    <rect x="470" y="100" width="16" height="14" rx="3" fill="#FF8155"/><text x="492" y="112" fill="#E5E7EB" font-size="14">Share of total annualized borrow interest</text>
    ${grid}
    <line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="rgba(255,255,255,.16)"/>
    ${bars}
    <text x="40" y="${H-44}" fill="#8B92A1" font-size="12">Source: Morpho GraphQL API and DefiLlama. Snapshot: ${asOf}. Borrow interest excludes markets with non-economic APYs above 100%.</text>
    <text x="40" y="${H-24}" fill="#8B92A1" font-size="12">Stablecoins are 45% of deposits but 96% of borrow interest. BTC is 32% of deposits but 0.1% as a borrowed asset. Datum Labs.</text>
  </svg></div></body></html>`;

  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:2 });
  await p.setContent(html,{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  await p.locator('.card').screenshot({ path: join(OUT,'asset-class-asymmetry-final.png') });
  await b.close();

  const png=statSync(join(OUT,'asset-class-asymmetry-final.png')), csvf=statSync(join(OUT,'asset-class-asymmetry-final.csv'));
  console.log('PAIR 2 exported:');
  console.log(`  asset-class-asymmetry-final.png  ${W}x${H} @2x (=${W*2}x${H*2})  ${(png.size/1024).toFixed(0)} KB`);
  console.log(`  asset-class-asymmetry-final.csv  ${csvRows.length} rows  ${(csvf.size/1024).toFixed(0)} KB`);
  console.log('  CSV (sorted by deposits share):');
  for (const r of csvRows) console.log(`    ${r.label.padEnd(11)} dep ${r.depPct.toFixed(1)}%  int ${r.intPct.toFixed(1)}%`);
}
main().catch(e=>{console.error(e);process.exit(1)});

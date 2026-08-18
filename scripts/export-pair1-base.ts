// PAIR 1: self-contained Base "active loans & market share" export.
// Writes the CSV and renders a 1600x720 self-contained PNG (title, subtitle,
// legend, both axes, 50% crossover annotation, snapshot date + source footers).
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

const fmtUsdAxis = (v: number) => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${Math.round(v/1e6)}M` : `$${Math.round(v/1e3)}K`;
const fmtUsdSub = (v: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(v);
const ma7 = (arr: (number|null)[]): (number|null)[] => { const w:number[]=[]; return arr.map(v=>{ if(v!=null){w.push(v); if(w.length>7)w.shift();} return w.length?w.reduce((a,b)=>a+b,0)/w.length:null; }); };
const monthsBetween = (a: string, b: string) => { const d1=new Date(a), d2=new Date(b); return Math.max(1,(d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth())); };
const monShort = (iso: string) => new Date(iso+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'2-digit',timeZone:'UTC'}).toUpperCase();
const monYear = (iso: string) => new Date(iso+'T00:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! }); const c = await pool.connect();
  let rows: any[] = [];
  try {
    rows = (await c.query(`
      WITH bounds AS (
        SELECT (SELECT MIN(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE chain_slug='Base' AND protocol_slug='morpho-blue' AND tvl_usd>0) AS start_d,
               (SELECT (MAX(snapshot_date)-INTERVAL '1 day')::date FROM morpho_.chain_lending_tvl_daily WHERE chain_slug='Base') AS end_d),
      days AS (SELECT generate_series((SELECT start_d FROM bounds),(SELECT end_d FROM bounds),'1 day')::date AS d),
      morpho_raw AS (SELECT snapshot_date::date d, tvl_usd::float8 tvl FROM morpho_.protocol_tvl_daily WHERE chain_slug='Base' AND protocol_slug='morpho-blue'),
      lend_raw AS (SELECT snapshot_date::date d, lending_tvl_usd::float8 tvl FROM morpho_.chain_lending_tvl_daily WHERE chain_slug='Base'),
      -- Active loans = morpho-blue Base borrowed (DefiLlama protocol_tvl_daily),
      -- which spans the full chain history (market_state_daily only retains ~13
      -- months) and matches the latest market-state value exactly. Same source
      -- family as the share denominator, so both lines cover the same window.
      bor_raw AS (SELECT snapshot_date::date d, borrowed_usd::float8 borrowed FROM morpho_.protocol_tvl_daily WHERE chain_slug='Base' AND protocol_slug='morpho-blue')
      SELECT days.d::text date,
        (SELECT borrowed FROM bor_raw bo WHERE bo.d<=days.d ORDER BY bo.d DESC LIMIT 1) active_loans,
        (SELECT tvl FROM morpho_raw m WHERE m.d<=days.d ORDER BY m.d DESC LIMIT 1) morpho_tvl,
        (SELECT tvl FROM lend_raw l WHERE l.d<=days.d ORDER BY l.d DESC LIMIT 1) lending_tvl
      FROM days ORDER BY days.d ASC`)).rows;
  } finally { c.release(); await pool.end(); }

  const dates = rows.map(r=>r.date);
  const loansRaw = rows.map(r=>r.active_loans as number|null);
  const morphoTvl = rows.map(r=>r.morpho_tvl as number|null);
  const lending = rows.map(r=>r.lending_tvl as number|null);
  const shareRaw = rows.map(r=> (r.morpho_tvl!=null && r.lending_tvl!=null && r.lending_tvl>0) ? r.morpho_tvl/r.lending_tvl : null);
  const loansMa = ma7(loansRaw);
  const shareMa = ma7(shareRaw);
  const asOf = dates[dates.length-1];

  // ---- CSV ----
  const cell = (v: number|null|undefined, dp=0) => v==null ? '' : (dp? (v as number).toFixed(dp) : Math.round(v as number).toString());
  // morpho_tvl_usd is the SHARE NUMERATOR (Morpho's own TVL), distinct from the
  // active-loans line. So a reviewer can verify morpho_share_pct = morpho_tvl_usd
  // / base_lending_tvl_usd, and not mistake active_loans/lending_tvl for share.
  // morpho_share_pct is the RAW ratio (morpho_tvl_usd / base_lending_tvl_usd),
  // so every derived column recomputes from the raw ones. The chart's share line
  // displays the 7-day moving average of this column (a display choice).
  const csv = ['snapshot_date,morpho_active_loans_usd,morpho_active_loans_usd_7d_ma,morpho_tvl_usd,base_lending_tvl_usd,morpho_share_pct'];
  for (let i=0;i<rows.length;i++) csv.push([dates[i], cell(loansRaw[i]), cell(loansMa[i]), cell(morphoTvl[i]), cell(lending[i]), shareRaw[i]==null?'':(shareRaw[i] as number*100).toFixed(4)].join(','));
  writeFileSync(join(OUT,'base-active-loans-share-final.csv'), csv.join('\n'));

  // ---- subtitle ----
  const firstLoan = rows.find(r=>r.active_loans!=null && r.active_loans>0);
  // Subtitle "grew to" uses the RAW latest active-loans value (matches the live
  // /chains/base header, e.g. $1.41B), not the 7-day MA endpoint ($1.40B).
  const lastLoanRaw = [...loansRaw].reverse().find(v=>v!=null) as number;
  const firstLoanV = firstLoan?.active_loans as number;
  const cross = dates.find((_,i)=> shareMa[i]!=null && (shareMa[i] as number)>=0.5);
  const lastShare = [...shareMa].reverse().find(v=>v!=null) as number;
  const fmt2 = (v: number) => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', notation:'compact', maximumFractionDigits:2 }).format(v);
  const fmtFrom = (v: number) => v < 1000 ? `$${Math.round(v)}` : fmt2(v);
  const subtitle = `Morpho's active loans on Base grew from ${fmtFrom(firstLoanV)} to ${fmt2(lastLoanRaw)}. Morpho's share of Base lending TVL (DefiLlama, lending + CDP) crossed 50% in ${monYear(cross!)} and reached ${(lastShare*100).toFixed(1)}% by ${monYear(asOf)}.`;

  // ---- SVG geometry ----
  const W=1600,H=720, PL=92,PR=1500,PT=128,PB=560;
  const n=dates.length;
  const maxLoans = Math.max(...loansMa.filter((v):v is number=>v!=null));
  const loanTop = Math.ceil(maxLoans/2e8)*2e8; // nice round
  const xAt=(i:number)=>PL+(i/(n-1))*(PR-PL);
  const yLoan=(v:number)=>PB-(v/loanTop)*(PB-PT);
  const yShare=(v:number)=>PB-(v)*(PB-PT); // share 0..1
  const pathOf=(vals:(number|null)[], yfn:(v:number)=>number)=>{ let d='',pen=false; vals.forEach((v,i)=>{ if(v==null){pen=false;return;} const x=xAt(i).toFixed(1), y=yfn(v).toFixed(1); d+= pen?` L${x} ${y}`:`M${x} ${y}`; pen=true; }); return d; };
  // gridlines + ticks
  const yticks=[0,.25,.5,.75,1];
  const gridL = yticks.map(t=>{ const y=PT+(1-t)*(PB-PT); return `<line x1="${PL}" y1="${y}" x2="${PR}" y2="${y}" stroke="rgba(255,255,255,.06)"/>`+
    `<text x="${PL-10}" y="${y+4}" text-anchor="end" fill="#8B92A1" font-size="13">${fmtUsdAxis(loanTop*t)}</text>`+
    `<text x="${PR+10}" y="${y+4}" text-anchor="start" fill="#8B92A1" font-size="13">${Math.round(t*100)}%</text>`; }).join('');
  // x ticks ~9
  const nTicks=9; let xt='';
  for(let k=0;k<nTicks;k++){ const i=Math.round(k/(nTicks-1)*(n-1)); const x=xAt(i); xt+=`<text x="${x}" y="${PB+24}" text-anchor="middle" fill="#8B92A1" font-size="12">${monShort(dates[i])}</text>`; }
  const ci = dates.indexOf(cross!); const cx=xAt(ci);
  const crossLine = `<line x1="${cx}" y1="${PT}" x2="${cx}" y2="${PB}" stroke="#8B92A1" stroke-dasharray="3 4"/>`+
    `<text x="${cx+8}" y="${PT+14}" fill="#C8CCD6" font-size="12">Morpho passes 50% of chain lending: ${monYear(cross!).toUpperCase()}</text>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>*{margin:0;font-family:'JetBrains Mono',monospace}body{background:#0B0D11}.card{width:${W}px;height:${H}px;background:#0B0D11;position:relative}
  text{font-family:'JetBrains Mono',monospace}</style></head><body>
  <div class="card"><svg width="${W}" height="${H}">
    <text x="40" y="46" fill="#FF8155" font-size="19" font-weight="700" letter-spacing="2">ACTIVE LOANS &amp; SHARE OF BASE LENDING TVL</text>
    <text x="40" y="74" fill="#C8CCD6" font-size="14">${subtitle.replace(/&/g,'&amp;')}</text>
    <!-- legend -->
    <rect x="40" y="92" width="16" height="4" rx="2" fill="#B97AFF"/><text x="62" y="100" fill="#E5E7EB" font-size="13">Morpho active loans, 7-day moving average (left axis)</text>
    <rect x="510" y="92" width="16" height="4" rx="2" fill="#FF8155"/><text x="532" y="100" fill="#E5E7EB" font-size="13">Morpho share of Base lending TVL, 7-day moving average (right axis)</text>
    ${gridL}
    <line x1="${PL}" y1="${PB}" x2="${PR}" y2="${PB}" stroke="rgba(255,255,255,.16)"/>
    ${xt}
    ${crossLine}
    <path d="${pathOf(loansMa,yLoan)}" fill="none" stroke="#B97AFF" stroke-width="2.5"/>
    <path d="${pathOf(shareMa,yShare)}" fill="none" stroke="#FF8155" stroke-width="2.5"/>
    <text x="40" y="${H-44}" fill="#8B92A1" font-size="12">Source: DefiLlama lending + CDP categories + Morpho GraphQL API</text>
    <text x="40" y="${H-24}" fill="#8B92A1" font-size="12">Snapshot: ${asOf} . Share = Morpho TVL divided by Base total lending TVL. Active loans = Morpho borrowed (left axis). Datum Labs.</text>
  </svg></div></body></html>`;

  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:W,height:H}, deviceScaleFactor:2 });
  await p.setContent(html,{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  await p.locator('.card').screenshot({ path: join(OUT,'base-active-loans-share-final.png') });
  await b.close();

  const png = statSync(join(OUT,'base-active-loans-share-final.png'));
  const csvf = statSync(join(OUT,'base-active-loans-share-final.csv'));
  console.log('PAIR 1 exported:');
  console.log(`  base-active-loans-share-final.png  ${W}x${H} @2x (=${W*2}x${H*2})  ${(png.size/1024).toFixed(0)} KB`);
  console.log(`  base-active-loans-share-final.csv  ${rows.length} data rows  ${(csvf.size/1024).toFixed(0)} KB`);
  console.log(`  range ${dates[0]} -> ${asOf}  | 50% crossover ${cross} | latest share ${(lastShare*100).toFixed(1)}%`);
}
main().catch(e=>{console.error(e);process.exit(1)});

// Renders the "stablecoin productivity asymmetry" chart as a high-res PNG,
// styled to the Morpho Research Terminal brand. Self-contained (no deploy).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const __d = dirname(fileURLToPath(import.meta.url));

// Verified figures (latest snapshot, all chains, bad-oracle markets excluded).
const DATA = [
  { cls: 'STABLECOINS', dep: 44.8, int: 95.9 },
  { cls: 'BTC',         dep: 32.1, int: 0.1 },
  { cls: 'ETH',         dep: 15.7, int: 2.8 },
  { cls: 'OTHER',       dep: 7.3,  int: 1.2 },
];
const ASOF = '2026-06-01';

const row = (d: { cls: string; dep: number; int: number }) => `
  <div class="row">
    <div class="cls">${d.cls}</div>
    <div class="bars">
      <div class="barline"><div class="bar dep" style="width:${d.dep}%"></div><span class="v">${d.dep}%</span></div>
      <div class="barline"><div class="bar int" style="width:${d.int}%"></div><span class="v hot">${d.int < 1 ? d.int.toFixed(1) : Math.round(d.int)}%</span></div>
    </div>
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0B0D11;--card:#14171D;--border:rgba(255,255,255,.10);--bright:rgba(255,255,255,.16);--fg:#E5E7EB;--muted:#8B92A1;--sec:#C8CCD6;--orange:#FF8155;--blue:#6B85FF;}
  *{margin:0;box-sizing:border-box;font-family:'JetBrains Mono',monospace;}
  body{background:var(--bg);padding:36px;}
  .card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:28px 32px;width:1180px;}
  h1{color:var(--orange);font-size:15px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;}
  .sub{color:var(--sec);font-size:13px;margin-top:8px;line-height:1.5;max-width:1050px;}
  .legend{display:flex;gap:24px;margin:22px 0 18px;}
  .legend span{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;}
  .sw{width:14px;height:14px;border-radius:3px;}
  .row{display:grid;grid-template-columns:130px 1fr;align-items:center;gap:18px;padding:14px 0;border-top:1px solid var(--border);}
  .cls{color:var(--fg);font-size:13px;letter-spacing:.1em;font-weight:500;}
  .bars{display:flex;flex-direction:column;gap:9px;}
  .barline{display:flex;align-items:center;gap:10px;}
  .bar{height:18px;border-radius:3px;min-width:3px;}
  .bar.dep{background:var(--blue);}
  .bar.int{background:var(--orange);}
  .v{font-size:12px;color:var(--sec);font-variant-numeric:tabular-nums;}
  .v.hot{color:var(--orange);font-weight:700;}
  .foot{margin-top:20px;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase;}
</style></head>
<body>
  <div class="card">
    <h1>Stablecoins Do The Work: Deposits vs Borrow Interest by Asset Class</h1>
    <div class="sub">Stablecoins are <b style="color:#E5E7EB">45% of deposits but 96% of borrow interest</b>. BTC is 32% of deposits but only 0.1% as a borrowed asset: it is pristine collateral that backs stablecoin borrowing, not a yield-bearing supplied asset. Morpho, all chains, ${ASOF}.</div>
    <div class="legend">
      <span><span class="sw" style="background:var(--blue)"></span>Share of locked value (deposits)</span>
      <span><span class="sw" style="background:var(--orange)"></span>Share of borrow interest (by loan asset)</span>
    </div>
    ${DATA.map(row).join('')}
    <div class="foot">Source: Morpho GraphQL market state, latest snapshot. Borrow interest = Sigma borrow_usd x APY (clamped, bad-oracle markets excluded). Datum Labs.</div>
  </div>
</body></html>`;

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1260, height: 700 }, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const card = p.locator('.card');
  await card.screenshot({ path: join(__d, '..', 'branding', 'morpho-stablecoin-productivity.png') });
  await card.screenshot({ path: join(__d, '..', 'apps', 'web', 'public', 'exports', 'morpho-stablecoin-productivity.png') });
  console.log('ok: branding/ + public/exports/morpho-stablecoin-productivity.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

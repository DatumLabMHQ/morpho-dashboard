// Generates static brand assets with Playwright (no dev server needed):
//   public/og.png        1200x630 social card (blue branding + cube + compact chart)
//   app/icon.png         32x32 favicon
//   app/apple-icon.png   180x180 apple touch icon
//   app/favicon.ico      ICO wrapping the 32x32 PNG
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const WEB = join(__d, '..', 'apps', 'web');
const iconB64 = readFileSync(join(WEB, 'public', 'branding', 'datumlabs-icon.png')).toString('base64');
const iconSrc = `data:image/png;base64,${iconB64}`;

// Compact stacked-area chart evoking "share by chain" (decorative, brand palette).
const CHART = `
<svg viewBox="0 0 520 150" width="520" height="150" preserveAspectRatio="none" style="display:block">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e79f5" stop-opacity="0.9"/><stop offset="1" stop-color="#2e79f5" stop-opacity="0.35"/></linearGradient>
  </defs>
  <path d="M0,150 L0,70 C90,66 150,52 220,55 C300,58 360,40 440,44 L520,42 L520,150 Z" fill="url(#g1)"/>
  <path d="M0,70 L0,44 C90,42 150,34 220,36 C300,38 360,28 440,30 L520,30 L520,42 C440,44 360,40 300,58 C150,52 90,66 0,70 Z" fill="#38bdf8" fill-opacity="0.85"/>
  <path d="M0,44 L0,26 C120,24 260,20 400,22 L520,22 L520,30 C360,28 300,38 220,36 C150,34 90,42 0,44 Z" fill="#34d399" fill-opacity="0.85"/>
  <path d="M0,26 L0,14 C160,13 320,11 520,12 L520,22 C260,20 120,24 0,26 Z" fill="#b97aff" fill-opacity="0.85"/>
</svg>`;

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;box-sizing:border-box;font-family:Geist,'Segoe UI',system-ui,sans-serif}
  body{width:1200px;height:630px;background:#090f1a;color:#eee;overflow:hidden}
  .wrap{width:1200px;height:630px;padding:64px 72px;display:flex;flex-direction:column;position:relative}
  .glow{position:absolute;inset:0;background:radial-gradient(900px 400px at 80% -10%, rgba(46,121,245,0.18), transparent 60%)}
  .eyebrow{display:flex;align-items:center;gap:14px;position:relative}
  .dot{width:10px;height:10px;border-radius:50%;background:#2e79f5}
  .eb-text{font-size:16px;letter-spacing:0.22em;text-transform:uppercase;color:#2e79f5;font-weight:600}
  .eb-sub{font-size:14px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(238,238,238,0.45)}
  .title{margin-top:40px;position:relative;display:flex;align-items:center;gap:28px}
  .cube{width:96px;height:96px;border-radius:18px;background:rgba(46,121,245,0.10);border:1px solid rgba(46,121,245,0.35);display:flex;align-items:center;justify-content:center}
  .cube img{width:64px;height:64px}
  .ttext{font-size:62px;font-weight:800;line-height:1.04;letter-spacing:-0.02em}
  .ttext .accent{color:#2e79f5}
  .mid{margin-top:38px;position:relative;display:flex;gap:40px;align-items:flex-end}
  .desc{font-size:24px;line-height:1.35;color:rgba(238,238,238,0.74);max-width:560px}
  .chartwrap{flex:1;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(18,24,36,0.7);padding:14px 16px 10px}
  .chartlabel{font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(238,238,238,0.5);margin-bottom:8px}
  .spacer{flex:1}
  .footer{display:flex;justify-content:space-between;align-items:center;padding-top:22px;border-top:1px solid rgba(255,255,255,0.12);font-size:16px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(238,238,238,0.6);position:relative}
  .footer .url{display:flex;align-items:center;gap:8px}
  .footer .gt{color:#2e79f5;font-weight:700}
</style></head><body>
  <div class="wrap">
    <div class="glow"></div>
    <div class="eyebrow"><div class="dot"></div><div class="eb-text">DatumLabs Research</div><div class="eb-sub">· Live terminal</div></div>
    <div class="title">
      <div class="cube"><img src="${iconSrc}"/></div>
      <div class="ttext">Morpho Research<br/><span class="accent">Terminal</span></div>
    </div>
    <div class="mid">
      <div class="desc">Active loans, curator economics, asset composition, and the lending sector position across every chain Morpho is live on.</div>
      <div class="chartwrap"><div class="chartlabel">Morpho by chain</div>${CHART}</div>
    </div>
    <div class="spacer"></div>
    <div class="footer"><span class="url"><span class="gt">&gt;</span><span>datumlab.xyz/morpho-terminal</span></span><span>Lending sector research by Datum Labs</span></div>
  </div>
</body></html>`;

function pngToIco(png) {
  const h = Buffer.alloc(6);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  const d = Buffer.alloc(16);
  d.writeUInt8(32, 0); d.writeUInt8(32, 1); d.writeUInt8(0, 2); d.writeUInt8(0, 3);
  d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
  d.writeUInt32LE(png.length, 8); d.writeUInt32LE(22, 12);
  return Buffer.concat([h, d, png]);
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // OG
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const og = await ctx.newPage();
  await og.setContent(OG_HTML, { waitUntil: 'networkidle' });
  await og.waitForTimeout(300);
  await og.screenshot({ path: join(WEB, 'public', 'og.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log('wrote public/og.png');

  // Favicons (transparent cube)
  const mk = async (size, out) => {
    const c = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const p = await c.newPage();
    await p.setContent(`<!doctype html><html><head><style>*{margin:0}html,body{width:${size}px;height:${size}px;background:transparent}img{width:${size}px;height:${size}px;display:block}</style></head><body><img src="${iconSrc}"/></body></html>`, { waitUntil: 'networkidle' });
    const buf = await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(out, buf);
    await c.close();
    return buf;
  };
  await mk(32, join(WEB, 'app', 'icon.png'));
  console.log('wrote app/icon.png (32)');
  await mk(180, join(WEB, 'app', 'apple-icon.png'));
  console.log('wrote app/apple-icon.png (180)');
  const png32 = readFileSync(join(WEB, 'app', 'icon.png'));
  writeFileSync(join(WEB, 'app', 'favicon.ico'), pngToIco(png32));
  console.log('wrote app/favicon.ico');

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

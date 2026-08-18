import { chromium } from 'playwright';
const PORT = process.env.PORT ?? '3000';
async function main() {
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(`http://localhost:${PORT}/vaults`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await p.waitForSelector('h1', { timeout: 30_000 });
const info = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const h1 = document.querySelector('h1');
  const num = document.querySelector('.tabular-nums');
  const portal = document.querySelector('nextjs-portal') ? 'nextjs-portal present' : 'none';
  return {
    accent: cs.getPropertyValue('--accent').trim(),
    background: cs.getPropertyValue('--background').trim(),
    fontSans: cs.getPropertyValue('--font-sans').trim().slice(0, 60),
    bodyFont: getComputedStyle(document.body).fontFamily,
    h1Font: h1 ? getComputedStyle(h1).fontFamily : 'none',
    numFont: num ? getComputedStyle(num).fontFamily : 'none',
    devOverlay: portal,
    fontsLoaded: [...document.fonts].map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i).slice(0, 8),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

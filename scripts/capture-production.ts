import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const BASE = process.env.PROD_URL ?? 'https://morpho-terminal.datumlabs.workers.dev';

const PAGES: { route: string; file: string }[] = [
  { route: '/', file: 'production-overview.png' },
  { route: '/chains', file: 'production-chains.png' },
  { route: '/chains/base', file: 'production-chains-base.png' },
  { route: '/curators', file: 'production-curators.png' },
  { route: '/curators/steakhouse-financial', file: 'production-curators-steakhouse.png' },
  { route: '/assets', file: 'production-assets.png' },
  { route: '/assets/cbBTC', file: 'production-assets-cbbtc.png' },
  { route: '/vaults', file: 'production-vaults.png' },
  { route: '/markets', file: 'production-markets.png' },
  { route: '/methodology', file: 'production-methodology.png' },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 2400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const { route, file } of PAGES) {
    const url = `${BASE}${route}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 20_000 }); } catch {}
      await page.waitForTimeout(2_000);
      const out = join(BRAND, file);
      await page.screenshot({ path: out, fullPage: true });
      const s = await stat(out);
      console.log(`  ok   ${route.padEnd(34)} -> ${file} (${Math.round(s.size / 1024)} KB)`);
    } catch (e) {
      console.log(`  FAIL ${route.padEnd(34)} ${(e as Error).message.split('\n')[0]}`);
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

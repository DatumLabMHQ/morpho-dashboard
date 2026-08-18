import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function shoot(route: string, file: string, full = true) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const url = `http://localhost:${PORT}${route}`;
  console.log(`capturing ${url}`);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await p.waitForTimeout(1200);
  const out = join(BRAND, file);
  await p.screenshot({ path: out, fullPage: full });
  const s = await stat(out);
  console.log(`  -> ${out} (${Math.round(s.size / 1024)} KB)`);
  await browser.close();
}

async function main() {
  await shoot('/methodology', 'methodology-v1.png', true);
  await shoot('/this-route-does-not-exist', 'notfound-v1.png', false);
}
main().catch((e) => { console.error(e); process.exit(1); });

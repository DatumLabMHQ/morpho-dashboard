// Full-page screenshots of /vaults + /markets at 1440 → branding/{vaults,markets}-v1.png
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function shoot(route: string, file: string) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 3000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `http://localhost:${PORT}/${route}`;
  console.log(`capturing ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 30_000 }); } catch {}
  await page.waitForTimeout(2_500);
  const out = join(BRAND, file);
  await page.screenshot({ path: out, fullPage: true });
  const s = await stat(out);
  console.log(`  → ${out}  (${Math.round(s.size / 1024)} KB)`);
  await browser.close();
}

async function main() {
  await shoot('vaults', 'vaults-v1.png');
  await shoot('markets', 'markets-v1.png');
}
main().catch((e) => { console.error(e); process.exit(1); });

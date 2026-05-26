// Full-page screenshot of /rates at 1440 wide. Saves to branding/rates.png.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const BRAND_DIR = join(REPO_ROOT, 'branding');

const WIDTH = 1440;
const PORT = process.env.PORT ?? '3001';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 3000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const url = `http://localhost:${PORT}/rates`;
  const out = join(BRAND_DIR, 'rates.png');

  console.log(`capturing ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  // Wait for at least one Recharts surface to be visible.
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 15_000 }); } catch {}
  // Extra settle for animations and tooltip layout.
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: out, fullPage: true });
  const s = await stat(out);
  console.log(`  → ${out}  (${Math.round(s.size / 1024)} KB)`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

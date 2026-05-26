// Full-page screenshot of /assets at 1440 wide.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const OUT = join(__d, '..', 'branding', 'assets.png');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 3200 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  console.log(`capturing /assets at 1440x*`);
  await page.goto('http://localhost:3000/assets', { waitUntil: 'networkidle', timeout: 60_000 });
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 12_000 }); } catch {}
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: OUT, fullPage: true });
  const s = await stat(OUT);
  console.log(`  → ${OUT}  (${Math.round(s.size / 1024)} KB)`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

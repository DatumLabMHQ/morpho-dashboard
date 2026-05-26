// Full-page screenshots of /vaults and /markets at 1440 wide.

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

  const targets: { url: string; out: string }[] = [
    { url: `http://localhost:${PORT}/vaults`,  out: join(BRAND_DIR, 'vaults.png') },
    { url: `http://localhost:${PORT}/markets`, out: join(BRAND_DIR, 'markets.png') },
  ];

  for (const t of targets) {
    console.log(`capturing ${t.url}`);
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60_000 });
    try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 15_000 }); } catch {}
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: t.out, fullPage: true });
    const s = await stat(t.out);
    console.log(`  → ${t.out}  (${Math.round(s.size / 1024)} KB)`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

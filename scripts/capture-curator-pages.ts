// Full-page screenshots of /curators and /curators/steakhouse-financial at 1440 wide.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const BRAND_DIR = join(REPO_ROOT, 'branding');

const WIDTH = 1440;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 3000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const targets: { url: string; out: string }[] = [
    { url: 'http://localhost:3000/curators', out: join(BRAND_DIR, 'curators-directory.png') },
    {
      url: 'http://localhost:3000/curators/steakhouse-financial',
      out: join(BRAND_DIR, 'curators-steakhouse.png'),
    },
  ];

  for (const t of targets) {
    console.log(`capturing ${t.url}`);
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 60_000 });
    // Wait for charts (any present)
    try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 10_000 }); } catch {}
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: t.out, fullPage: true });
    const s = await stat(t.out);
    console.log(`  → ${t.out}  (${Math.round(s.size / 1024)} KB)`);
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

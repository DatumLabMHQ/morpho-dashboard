// Full-page screenshots of /chains/Base and /chains/Ethereum at 1440 width,
// plus a re-export of the headline chart from /chains in Report mode.
// Prereq: Next.js dev server running on http://localhost:3000.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const BRAND_DIR = join(REPO_ROOT, 'branding');
const EXPORTS_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'exports');

const WIDTH = 1440;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 2400 },  // tall viewport so we capture w/o scroll stitching
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const slug of ['Base', 'Ethereum']) {
    const url = `http://localhost:3000/chains/${slug}`;
    console.log(`capturing ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    // Wait for the recharts surfaces (3 charts) to finish drawing
    await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(2_000);
    const out = join(BRAND_DIR, `chain-${slug.toLowerCase()}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const s = await stat(out);
    console.log(`  → ${out}  (${Math.round(s.size / 1024)} KB)`);
  }

  // Re-export the headline chart in Report mode.
  console.log('re-exporting headline chart in Report mode');
  await page.goto('http://localhost:3000/chains', { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(1_500);
  // Click the Report mode button — bumps to 1600px and reveals Export PNG button
  await page.click('[data-testid="report-mode-on"]');
  await page.waitForSelector('[data-testid="export-png"]', { state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(1_500);
  // The export button writes via POST to /api/save-export which saves the PNG
  // server-side at apps/web/public/exports/morpho-share-by-chain.png.
  await page.click('[data-testid="export-png"]');
  // Wait for the busy state to clear (button text returns to "Export PNG")
  await page.waitForTimeout(35_000);
  const expPath = join(EXPORTS_DIR, 'morpho-share-by-chain.png');
  const expStat = await stat(expPath);
  console.log(`  → ${expPath}  (${Math.round(expStat.size / 1024)} KB)`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

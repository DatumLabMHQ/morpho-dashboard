// Capture a specific page screenshot for phase PR documentation.
// Usage: PORT=3004 PHASE=1 PAGE=assets pnpm exec tsx capture-phase.ts

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const BRAND_DIR = join(REPO_ROOT, 'branding');

const WIDTH = 1440;
const PORT = process.env.PORT ?? '3001';
const PAGE = process.env.PAGE ?? 'assets';
const SUFFIX = process.env.SUFFIX ?? '';     // e.g. "-phase1" or "-light"
const THEME = process.env.THEME ?? 'dark';    // 'dark' | 'light'

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: 3000 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const url = `http://localhost:${PORT}/${PAGE === 'home' ? '' : PAGE}`;
  const out = join(BRAND_DIR, `${PAGE}${SUFFIX}.png`);

  console.log(`capturing ${url} (theme=${THEME})`);
  // First load establishes the origin; then we seed localStorage with the
  // desired theme and reload. The reload fires the inline pre-paint script,
  // which reads `morpho-theme` and writes `data-theme` accordingly.
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.evaluate((theme) => {
    try { window.localStorage.setItem('morpho-theme', theme); } catch {}
  }, THEME);
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 15_000 }); } catch {}
  await page.waitForTimeout(2_000);
  const meta = await page.evaluate(() => {
    const ls = (() => { try { return window.localStorage.getItem('morpho-theme'); } catch { return null; } })();
    const attr = document.documentElement.getAttribute('data-theme');
    const bg = window.getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    return { ls, attr, bg };
  });
  console.log(`  state: localStorage=${meta.ls} data-theme=${meta.attr} --background=${meta.bg}`);
  await page.screenshot({ path: out, fullPage: true });
  const s = await stat(out);
  console.log(`  → ${out}  (${Math.round(s.size / 1024)} KB)`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

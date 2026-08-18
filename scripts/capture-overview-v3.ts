// Overview rebuild (v3) deliverable screenshots:
//   overview-v3.png       full page @1440
//   overview-v3-wide.png  full page @1920
//   sidebar-v2.png        the top-nav bar only (the rendered nav)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';

import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function shootFull(width: number, file: string) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width, height: 3000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `http://localhost:${PORT}/`;
  console.log(`capturing ${url} @${width}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 30_000 }); } catch {}
  await page.waitForTimeout(2_500);
  const out = join(BRAND_DIR, file);
  await page.screenshot({ path: out, fullPage: true });
  const s = await stat(out);
  console.log(`  → ${out}  (${Math.round(s.size / 1024)} KB)`);

  // While we're at 1440, also grab the nav bar only → sidebar-v2.png
  if (width === 1440) {
    const nav = page.locator('nav').first();
    const navOut = join(BRAND_DIR, 'sidebar-v2.png');
    await nav.screenshot({ path: navOut });
    const ns = await stat(navOut);
    console.log(`  → ${navOut}  (${Math.round(ns.size / 1024)} KB)`);
  }
  await browser.close();
}

async function main() {
  await shootFull(1440, 'overview-v3.png');
  await shootFull(1920, 'overview-v3-wide.png');
}
main().catch((e) => { console.error(e); process.exit(1); });

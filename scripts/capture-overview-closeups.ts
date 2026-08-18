import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 3000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  try { await page.waitForSelector('.recharts-surface', { state: 'visible', timeout: 30_000 }); } catch {}
  await page.waitForTimeout(2_000);

  // KPI strip = the 6-card grid (first grid after header)
  const kpi = page.locator('div.grid').first();
  await kpi.screenshot({ path: join(BRAND_DIR, 'overview-v3-kpis.png') });

  // Lending efficiency table (Section 8)
  const effTbl = page.locator('table').filter({ hasText: 'Spread vs Sector' }).first();
  await effTbl.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await effTbl.screenshot({ path: join(BRAND_DIR, 'overview-v3-efficiency.png') }).catch(() => {});

  // Risk pulse (Section 9)
  const risk = page.getByText('Risk pulse', { exact: true }).first();
  await risk.scrollIntoViewIfNeeded();
  const riskSec = page.locator('section').filter({ hasText: 'Risk pulse' }).first();
  await riskSec.screenshot({ path: join(BRAND_DIR, 'overview-v3-risk.png') });

  console.log('done');
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

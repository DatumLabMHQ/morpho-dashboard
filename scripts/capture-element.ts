// Screenshot a specific chart card by its header text — for verifying detail.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';
const NEEDLE = process.env.NEEDLE ?? 'NET SUPPLY FLOWS';
const OUT = process.env.OUT ?? 'element.png';

async function main() {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  // Find the chart-card section whose header contains NEEDLE.
  const card = page.locator('section[data-chart-card]', { hasText: NEEDLE }).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await card.screenshot({ path: join(BRAND, OUT) });
  console.log(`→ branding/${OUT}`);
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

// Hover a donut slice and capture so we can see the tooltip contrast + the
// TOTAL-header legend.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function main() {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  const card = page.locator('section[data-chart-card]', { hasText: 'COLLATERAL MIX' }).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  // Hover a donut arc (the Pie sectors are <path> inside the first PieChart).
  const sectors = card.locator('svg path.recharts-sector');
  const sn = await sectors.count();
  let tipText: string | null = null;
  for (const idx of [0, 1, 2]) {
    if (idx >= sn) break;
    await sectors.nth(idx).hover({ force: true });
    await page.waitForTimeout(350);
    tipText = await card.locator('.recharts-tooltip-wrapper').first().textContent().catch(() => null);
    if (tipText && tipText.trim()) break;
  }
  console.log(`sectors: ${sn} · tooltip: ${tipText?.trim() ?? '(none)'}`);
  await card.screenshot({ path: join(BRAND, 'verify-donut-tip.png') });
  console.log('→ branding/verify-donut-tip.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

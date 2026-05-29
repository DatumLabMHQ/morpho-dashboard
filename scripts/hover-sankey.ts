// Confirm the Sankey link (ribbon) tooltip fires + capture the glow.
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
  const card = page.locator('section[data-chart-card]', { hasText: 'NET SUPPLY FLOWS' }).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  // Link ribbons are the thick stroked <path> elements with cursor:pointer.
  const links = card.locator('svg path[stroke-width]');
  const ln = await links.count();
  // Hover a beefy ribbon near the middle of the list.
  let linkTip: string | null = null;
  for (const idx of [Math.floor(ln / 2), 3, 10, 0]) {
    if (idx >= ln) continue;
    await links.nth(idx).hover({ force: true });
    await page.waitForTimeout(300);
    linkTip = await card.locator('div.absolute.z-20').first().textContent().catch(() => null);
    if (linkTip && linkTip.includes('→')) break;
  }
  console.log(`link paths: ${ln} · link tooltip: ${linkTip ?? '(none)'}`);

  await card.screenshot({ path: join(BRAND, 'verify-sankey-glow.png') });
  console.log('→ branding/verify-sankey-glow.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

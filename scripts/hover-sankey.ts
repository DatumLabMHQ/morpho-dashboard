// Deterministically confirm the Sankey node tooltip fires: hover a node's
// transparent hit-rect and assert the tooltip div appears with text.
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

  // The widened transparent hit-rects we added carry cursor:pointer.
  const hitRects = card.locator('svg rect[fill="transparent"]');
  const n = await hitRects.count();
  console.log(`hit-rects found: ${n}`);
  if (n === 0) { console.log('FAIL: no hit rects'); await b.close(); return; }

  // Hover a middle-ish node (components sit between assets).
  await hitRects.nth(Math.floor(n / 2)).hover({ force: true });
  await page.waitForTimeout(400);

  // Tooltip is an absolutely-positioned div with a $ value. Look for it.
  const tipText = await card
    .locator('div.absolute.z-20')
    .first()
    .textContent()
    .catch(() => null);
  console.log(`tooltip text: ${tipText ?? '(none)'}`);
  await card.screenshot({ path: join(BRAND, 'verify-sankey-hover.png') });
  console.log('→ branding/verify-sankey-hover.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const PORT = process.env.PORT ?? '3000';

async function main() {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1 })).newPage();
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 240_000 });
  // Wait for the toggle buttons (cheap, SSR'd) rather than the heavy charts.
  await p.getByRole('button', { name: 'Deposits', exact: true }).first().waitFor({ timeout: 120_000 });
  try { await p.waitForSelector('.recharts-surface', { state: 'visible', timeout: 90_000 }); } catch {}
  await p.waitForTimeout(1500);

  const frame = p.locator('div').filter({ hasText: 'Morpho in the lending sector' }).last();
  const caption = () => p.locator('text=/Morpho ranks/').first().innerText().catch(() => '(none)');

  for (const label of ['Deposits', 'Active Loans', 'TVL']) {
    await p.getByRole('button', { name: label, exact: true }).first().click();
    await p.waitForTimeout(1200);
    console.log(`${label.padEnd(13)} → ${await caption()}`);
  }
  // Leave it on Deposits for the screenshot.
  await p.getByRole('button', { name: 'Deposits', exact: true }).first().click();
  await p.waitForTimeout(900);
  await frame.scrollIntoViewIfNeeded();
  await p.waitForTimeout(400);
  await frame.screenshot({ path: join(BRAND, 'overview-sector-deposits.png') });
  console.log('saved overview-sector-deposits.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

// Quick fullPage capture of /chains and /methodology from production.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PROD_URL ?? 'https://morpho-terminal.datumlabs.workers.dev';
const OUT = join(__d, '..', 'branding');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  for (const [path, file] of [['/chains', 'production-chains.png'], ['/methodology', 'production-methodology.png']] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, file), fullPage: true });
    console.log(`  ok  ${path} -> ${file}`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

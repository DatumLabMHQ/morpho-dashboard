import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');

async function main() {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await p.goto('https://www.datumlab.xyz/morpho-terminal', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  // Wait for the cross-origin iframe to load its dashboard content.
  await p.waitForTimeout(6_000);
  await p.screenshot({ path: join(BRAND, 'datumlab-morpho-embed.png') });
  console.log('saved branding/datumlab-morpho-embed.png');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

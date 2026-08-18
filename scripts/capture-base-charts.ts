import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const __d = dirname(fileURLToPath(import.meta.url));
const BRAND = join(__d, '..', 'branding');
const EXPORTS = join(__d, '..', 'apps', 'web', 'public', 'exports');
const URL = 'https://morpho-terminal.vercel.app/chains/base';

async function capChart(page: any, titleSub: string, out: string, width: number) {
  const h = page.getByText(titleSub, { exact: false }).first();
  await h.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const box = await h.boundingBox();
  if (!box) { console.log('  MISS', titleSub); return; }
  const y = Math.max(0, box.y - 18);
  await page.screenshot({ path: out, clip: { x: 8, y, width: width - 16, height: 600 } });
  console.log('  ok', out.split(/[\/]/).pop());
}

async function main() {
  const b = await chromium.launch();
  // 1440px screenshots -> branding/*-v2.png
  let p = await b.newPage({ viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 1 });
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
  await capChart(p, 'Active Loans & Market Share', join(BRAND, 'chain-base-chart1-v2.png'), 1440);
  await capChart(p, 'Lending TVL on', join(BRAND, 'chain-base-chart2-v2.png'), 1440);
  await p.close();
  // 1600px Report Mode exports -> public/exports/*.png (deviceScaleFactor 2 for crisp export)
  p = await b.newPage({ viewport: { width: 1600, height: 1800 }, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
  await capChart(p, 'Active Loans & Market Share', join(EXPORTS, 'base-active-loans-share.png'), 1600);
  await capChart(p, 'Lending TVL on', join(EXPORTS, 'base-top-5-protocols.png'), 1600);
  await p.close();
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

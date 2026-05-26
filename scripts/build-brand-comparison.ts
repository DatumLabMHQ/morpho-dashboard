// Captures the new Morpho dashboard Overview at 1440×900 and composes a
// side-by-side comparison with the Lending Terminal reference screenshot.
// Output: branding/morpho-new-overview.png + branding/comparison.png.
//
// Prereq: the Next.js dev server must be running on http://localhost:3000.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const OUT_DIR = join(REPO_ROOT, 'branding');
const REF_PATH = join(OUT_DIR, 'reference', 'overview.png');
const NEW_PATH = join(OUT_DIR, 'morpho-new-overview.png');
const COMPARISON_PATH = join(OUT_DIR, 'comparison.png');

const WIDTH = 1440;
const HEIGHT = 900;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log('capturing new Morpho overview at 1440x900...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60_000 });
  // Wait for the KPI cards to hydrate
  await page.waitForSelector('h1', { timeout: 10_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: NEW_PATH, fullPage: false });
  console.log(`saved → ${NEW_PATH}`);

  // Side-by-side composite via a synthetic HTML page.
  const refData = await readFile(REF_PATH);
  const newData = await readFile(NEW_PATH);
  const refBase64 = refData.toString('base64');
  const newBase64 = newData.toString('base64');

  const html = /* html */ `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html, body { margin: 0; padding: 0; background: #050608; font-family: monospace; }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            padding: 24px;
            width: ${WIDTH * 2 + 72}px;
          }
          .col { display: flex; flex-direction: column; gap: 10px; }
          .label {
            color: #8b92a1;
            font-size: 13px;
            letter-spacing: 0.15em;
            text-transform: uppercase;
          }
          .label strong { color: #e5e7eb; font-weight: 500; }
          img {
            display: block;
            width: ${WIDTH}px;
            height: auto;
            border: 1px solid hsla(0,0%,100%,0.12);
            border-radius: 8px;
          }
        </style>
      </head>
      <body>
        <div class="grid">
          <div class="col">
            <div class="label"><strong>Reference</strong> · Lending Intelligence Terminal</div>
            <img src="data:image/png;base64,${refBase64}" />
          </div>
          <div class="col">
            <div class="label"><strong>New</strong> · Morpho Research Terminal</div>
            <img src="data:image/png;base64,${newBase64}" />
          </div>
        </div>
      </body>
    </html>
  `;

  console.log('composing side-by-side...');
  await page.setViewportSize({ width: WIDTH * 2 + 72, height: HEIGHT + 100 });
  await page.setContent(html, { waitUntil: 'load' });
  // Allow img onload to settle
  await page.waitForTimeout(500);
  const body = await page.$('body');
  if (body) {
    await body.screenshot({ path: COMPARISON_PATH });
  } else {
    await page.screenshot({ path: COMPARISON_PATH, fullPage: true });
  }
  console.log(`saved → ${COMPARISON_PATH}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

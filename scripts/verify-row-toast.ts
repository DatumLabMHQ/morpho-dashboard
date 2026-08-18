import { chromium } from 'playwright';
const PORT = process.env.PORT ?? '3000';

async function check(route: string) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${PORT}/${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('tbody tr[title="Click to copy identifier"]', { timeout: 30_000 });
  // Click the first directory row.
  await page.locator('tbody tr[title="Click to copy identifier"]').first().click();
  // Toast should appear.
  const toast = await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /^Copied /.test(d.textContent ?? ''));
    return el ? el.textContent : null;
  }, { timeout: 5_000 }).catch(() => null);
  const text = toast ? await toast.jsonValue() : null;
  console.log(`/${route}: toast = ${text ? JSON.stringify(text) : 'NOT SHOWN'}`);
  await browser.close();
}

async function main() {
  await check('vaults');
  await check('markets');
}
main().catch((e) => { console.error(e); process.exit(1); });

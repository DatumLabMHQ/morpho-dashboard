// Diagnostic: read the live computed color of the donut legend text + the
// active theme, so we can tell if the legend is genuinely invisible in dark
// mode or if it's a client-cache issue.
import { chromium } from 'playwright';

const PORT = process.env.PORT ?? '3000';

async function main() {
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    const tp = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    // Find a donut legend symbol cell — look for a table row containing 'USR' or 'USDC'.
    const cells = Array.from(document.querySelectorAll('td span'));
    const target = cells.find((el) => /^(USR|USDC|WETH|CBBTC)$/i.test((el.textContent ?? '').trim()));
    const color = target ? getComputedStyle(target as Element).color : '(legend cell not found)';
    const sample = target?.textContent ?? null;
    return { theme, bg, tp, legendSample: sample, legendColor: color };
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

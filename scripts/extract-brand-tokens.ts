// Headless extractor for the Lending Terminal's visual identity.
// Opens the production site, waits for hydration, reads computed styles +
// :root CSS variables + loaded fonts, takes reference screenshots, and writes
// branding/extracted-tokens.json.
//
// NOTE on the function-style: every `page.evaluate(...)` callback is a single
// arrow expression with no inner const-bound functions. tsx (esbuild) injects
// `__name(...)` wrappers around named callables, which then ReferenceError in
// the browser context where Playwright serializes them.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright';

const __d = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__d, '..');
const OUT_DIR = join(REPO_ROOT, 'branding');
const REF_DIR = join(OUT_DIR, 'reference');

// Try the marketing page first (datumlab.xyz) for tokens, then the app for
// live element styles. The marketing page redirected behavior the user
// described doesn't actually happen — the two URLs are separate.
const TARGET_URLS = [
  'https://lending-intelligence-terminal.vercel.app/',
  'https://www.datumlab.xyz/lending-terminal',
];
const TARGET_URL = TARGET_URLS[0]!;
const VIEWPORT = { width: 1440, height: 900 };

async function snapshot(page: Page, selector: string): Promise<unknown> {
  return page.evaluate(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return undefined;
      const cs = getComputedStyle(el);
      return {
        selector: sel,
        innerText: (el as HTMLElement).innerText?.slice(0, 80),
        font: {
          family: cs.fontFamily,
          size: cs.fontSize,
          weight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
        },
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        borderColor: cs.borderColor,
        borderWidth: cs.borderWidth,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        padding: cs.padding,
        margin: cs.margin,
      };
    },
    selector,
  );
}

async function snapshotAll(page: Page, selector: string, limit = 5): Promise<unknown[]> {
  return page.evaluate(
    (args) => {
      const els = [...document.querySelectorAll(args.sel)].slice(0, args.lim);
      return els.map((el) => {
        const cs = getComputedStyle(el);
        return {
          selector: args.sel,
          innerText: (el as HTMLElement).innerText?.slice(0, 80),
          font: {
            family: cs.fontFamily,
            size: cs.fontSize,
            weight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
          },
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          borderColor: cs.borderColor,
          borderWidth: cs.borderWidth,
          borderRadius: cs.borderRadius,
          boxShadow: cs.boxShadow,
          padding: cs.padding,
          margin: cs.margin,
        };
      });
    },
    { sel: selector, lim: limit },
  );
}

async function main() {
  await mkdir(REF_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`opening ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {
    console.warn('networkidle timed out, proceeding');
  });

  const resolvedUrl = page.url();
  console.log(`resolved to ${resolvedUrl}`);

  const hydrationSelectors = [
    '.recharts-surface',
    'svg.recharts-surface',
    '[class*="card" i]',
    '[class*="stat" i]',
    'table tbody tr',
    'main',
  ];
  for (const sel of hydrationSelectors) {
    try {
      await page.waitForSelector(sel, { state: 'visible', timeout: 8_000 });
      console.log(`hydration signal: ${sel}`);
      break;
    } catch {
      /* try next */
    }
  }
  await page.waitForTimeout(2_500);

  // -------- Extract --------
  const pageTitle = await page.title();

  const body = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return {
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontFamily: cs.fontFamily,
    };
  });

  // CSS custom properties — flat arrow, no inner named functions.
  const rootCssVariables = await page.evaluate(() => {
    const seen: Record<string, string> = {};
    const propNames = new Set<string>();
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const cssRules = sheet.cssRules;
        if (!cssRules) continue;
        for (const r of Array.from(cssRules)) {
          if (r instanceof CSSStyleRule) {
            const sel = r.selectorText || '';
            if (
              sel.includes(':root') ||
              sel.includes('html') ||
              sel.toLowerCase().includes('[data-theme')
            ) {
              for (let i = 0; i < r.style.length; i++) {
                const prop = r.style[i] || '';
                if (prop.startsWith('--')) propNames.add(prop);
              }
            }
          }
        }
      } catch {
        /* cross-origin stylesheet, skip */
      }
    }
    const docStyle = document.documentElement.style;
    for (let i = 0; i < docStyle.length; i++) {
      const prop = docStyle[i] || '';
      if (prop.startsWith('--')) propNames.add(prop);
    }
    propNames.forEach((p) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(p);
      if (v) seen[p] = v.trim();
    });
    return seen;
  });

  const fonts = await page.evaluate(() => {
    const out: { family: string; weight: string; status: string }[] = [];
    document.fonts.forEach((f) => {
      out.push({ family: f.family, weight: String(f.weight), status: f.status });
    });
    return out;
  });

  const headings = {
    h1: await snapshot(page, 'h1'),
    h2: await snapshot(page, 'h2'),
    h3: await snapshot(page, 'h3'),
  };

  const allButtons = await snapshotAll(page, 'button', 6);
  const buttons = {
    primary: allButtons[0],
    secondary: allButtons.find(
      (b: any) => b !== allButtons[0] && b.backgroundColor !== (allButtons[0] as any)?.backgroundColor,
    ),
  };

  const inputs = await snapshot(page, 'input');

  const cardSelectors = ['[class*="card" i]', '[class*="panel" i]', 'main > div > div'];
  const cards: unknown[] = [];
  for (const sel of cardSelectors) {
    const found = await snapshotAll(page, sel, 3);
    cards.push(...found);
    if (cards.length >= 3) break;
  }

  const tableRow = await snapshot(page, 'table tbody tr');
  const chartArea = await snapshot(page, '.recharts-surface, [class*="chart" i]');

  const rechartsColors = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.recharts-line-curve, .recharts-bar-rectangle path, path[stroke]')];
    const seen = new Set<string>();
    for (const el of lines) {
      const s = (el as SVGElement).getAttribute('stroke');
      const f = (el as SVGElement).getAttribute('fill');
      if (s && s !== 'none' && !s.startsWith('url')) seen.add(s);
      if (f && f !== 'none' && !f.startsWith('url')) seen.add(f);
    }
    return [...seen];
  });

  const { borderRadiiSeen, shadowsSeen } = await page.evaluate(() => {
    const radii = new Set<string>();
    const shadows = new Set<string>();
    const els = [...document.querySelectorAll('div, button, input, section, article')];
    for (const el of els.slice(0, 800)) {
      const cs = getComputedStyle(el);
      if (cs.borderRadius && cs.borderRadius !== '0px') radii.add(cs.borderRadius);
      if (cs.boxShadow && cs.boxShadow !== 'none') shadows.add(cs.boxShadow);
    }
    return { borderRadiiSeen: [...radii], shadowsSeen: [...shadows] };
  });

  const logo = await page.evaluate(() => {
    const candidates = [
      'header img',
      'header svg',
      'nav img',
      'nav svg',
      'a[href="/"] img',
      'a[href="/"] svg',
      '[class*="logo" i] img',
      '[class*="logo" i] svg',
      'img[alt*="logo" i]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLImageElement | SVGElement | null;
      if (!el) continue;
      const src = el instanceof HTMLImageElement ? el.src : null;
      const wordmark =
        (el.closest('a') as HTMLElement | null)?.innerText?.slice(0, 200) ??
        (el.closest('header') as HTMLElement | null)?.innerText?.slice(0, 200) ??
        null;
      return { src, outerHTML: el.outerHTML.slice(0, 4000), wordmarkText: wordmark };
    }
    return { src: null as string | null, outerHTML: null as string | null, wordmarkText: null as string | null };
  });

  const bodyHTMLSnippet = await page.evaluate(() => document.body.outerHTML.slice(0, 8000));

  // -------- Screenshots --------
  console.log('screenshots...');
  await page.screenshot({ path: join(REF_DIR, 'overview.png'), fullPage: false });

  const chartEl = page.locator('.recharts-surface, svg[class*="chart" i]').first();
  if (await chartEl.count()) {
    try {
      await chartEl.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await page.waitForTimeout(600);
      await chartEl.screenshot({ path: join(REF_DIR, 'chart.png') });
    } catch (e) {
      console.warn('chart screenshot failed:', e);
    }
  }
  const tableEl = page.locator('table').first();
  if (await tableEl.count()) {
    try {
      await tableEl.scrollIntoViewIfNeeded({ timeout: 5_000 });
      await page.waitForTimeout(600);
      await tableEl.screenshot({ path: join(REF_DIR, 'table.png') });
    } catch (e) {
      console.warn('table screenshot failed:', e);
    }
  }

  // -------- Logo download --------
  if (logo.src) {
    try {
      const res = await page.request.get(logo.src);
      const buf = Buffer.from(await res.body());
      const ext = logo.src.endsWith('.svg') ? 'svg' : 'png';
      const path = join(OUT_DIR, `logo.${ext}`);
      await writeFile(path, buf);
      console.log(`logo saved → ${path}`);
    } catch (e) {
      console.warn('logo download failed:', e);
    }
  } else if (logo.outerHTML?.trim().startsWith('<svg')) {
    await writeFile(join(OUT_DIR, 'logo.svg'), logo.outerHTML);
    console.log('inline SVG logo saved');
  }

  // -------- Write extracted tokens --------
  const extracted = {
    resolvedUrl,
    pageTitle,
    body,
    rootCssVariables,
    fonts,
    headings,
    buttons,
    inputs,
    cards,
    tableRow,
    chartArea,
    rechartsColors,
    borderRadiiSeen,
    shadowsSeen,
    logo,
    bodyHTMLSnippet,
  };

  const tokensPath = join(OUT_DIR, 'extracted-tokens.json');
  await writeFile(tokensPath, JSON.stringify(extracted, null, 2));
  console.log(`tokens → ${tokensPath}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

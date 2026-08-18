// Context-aware em-dash (U+2014) and en-dash (U+2013) removal for apps/web.
// Dry-run by default (prints proposed changes); pass --apply to write.
//
// Rules (applied per line, in order):
//   1. Numeric/value ranges  "70–80%", "$100K–$1M", "0–50%"  → hyphen, no spaces
//   2. " — $" / " — 123" (label to value)                    → ": "
//   3. " — word" / " – word" (clause join)                   → ". " + capitalize next
//   4. any leftover em-dash                                  → ". " + capitalize next
//   5. any leftover en-dash                                  → "-"

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'apps', 'web');
const APPLY = process.argv.includes('--apply');
const EXTS = new Set(['.ts', '.tsx', '.json', '.css']);
const SKIP_FILES = new Set(['package.json', 'tsconfig.json', 'package-lock.json', 'pnpm-lock.yaml']);
const SKIP = new Set(['node_modules', '.next', '.vercel', 'dist', '.turbo']);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (EXTS.has(p.slice(p.lastIndexOf('.'))) && !SKIP_FILES.has(name)) files.push(p);
  }
})(ROOT);

const cap = (s) => s.replace(/^(\s*)([a-z])/, (_, w, c) => w + c.toUpperCase());

function fixLine(line) {
  let s = line;
  // 0. standalone "no value" placeholders → N/A (quote-wrapped, JSX text, html entity)
  s = s.replace(/(['"`])[–—]\1/g, '$1N/A$1');           // '—' "—" `—`
  s = s.replace(/&quot;[–—]&quot;/g, '&quot;N/A&quot;');  // &quot;—&quot;
  s = s.replace(/>[\s]*[–—][\s]*</g, '>N/A<');           // >—< as sole JSX child
  // 1. numeric / currency ranges → hyphen (handles repeated, e.g. axis ranges)
  s = s.replace(/([0-9%\)\$KMBkmb])\s*[–—]\s*([\$0-9<])/g, '$1-$2');
  // 2. label → value:  " — $1.2B", " — 45%", " — {expr}", " — ${expr}"
  s = s.replace(/\s*[–—]\s+(?=[\$0-9{])/g, ': ');
  // 3. clause join with spaces:  "word — word" → "word. Word"
  s = s.replace(/\s*[–—]\s+([A-Za-z])/g, (_, c) => '. ' + c.toUpperCase());
  // 4. leftover em-dash → ". " + cap next
  s = s.replace(/\s*—\s*([A-Za-z0-9])/g, (_, c) => '. ' + (/[a-z]/.test(c) ? c.toUpperCase() : c));
  s = s.replace(/—/g, '. ');
  // 5. leftover en-dash → hyphen
  s = s.replace(/\s*–\s*/g, '-');
  // 6. tidy: collapse a period followed by 2+ spaces back to one space
  s = s.replace(/\.\s{2,}/g, '. ');
  return s;
}

let totalChanged = 0;
const perFile = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (!/[–—]/.test(src)) continue;
  const lines = src.split('\n');
  let changes = 0;
  const out = lines.map((ln) => {
    if (!/[–—]/.test(ln)) return ln;
    const fixed = fixLine(ln);
    if (fixed !== ln) { changes++; perFile.push([f, ln.trim(), fixed.trim()]); }
    return fixed;
  });
  if (changes > 0) {
    totalChanged += changes;
    if (APPLY) writeFileSync(f, out.join('\n'));
  }
}

for (const [f, a, b] of perFile) {
  console.log(`\n${f.replace(ROOT, 'apps/web')}`);
  console.log(`  -  ${a}`);
  console.log(`  +  ${b}`);
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${totalChanged} lines across ${new Set(perFile.map((x) => x[0])).size} files`);

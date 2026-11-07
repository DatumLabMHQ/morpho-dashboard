# Brand decisions — Morpho Research Terminal

Source extraction: `scripts/extract-brand-tokens.ts` running Playwright against
`https://lending-intelligence-terminal.datumlabs.workers.dev/` on 2026-05-26.

## What we inherited

The Lending Intelligence Terminal is a **dark Bloomberg-style terminal**, not the
shadcn light theme its marketing page (datumlab.xyz) advertises. Surface
extraction confirmed:

- Background `#0b0d11`, surface `#14171d`, border `hsla(0,0%,100%,0.08)`.
- **JetBrains Mono everywhere** — including headings, KPI values, table cells,
  buttons. There is no sans-serif face anywhere on the page.
- Headings are small (10–13 px), weight 400, ALL CAPS, with wide letter-spacing
  (≈ 0.15 em). The terminal treats them as labels, not display type.
- The accent palette is colorful, not monochrome:
  - Primary accent: orange `#ff8155` (used for CTAs, active nav, key indicators)
  - Secondary: purple `#b97aff`
  - Plus blue, green, yellow, cyan, pink, indigo on a vivid 8-color chart palette.
- Cards: `#14171d` bg, 1 px border at 8% white, `8 px` radius, `16 px` padding.
  No drop shadow on cards themselves; the only shadow lives on tooltips.
- Status indicator (top-right): `● CONNECTED` in green.

## Decisions made for the Morpho dashboard

1. **Match the dark Bloomberg aesthetic exactly.** Same background hex, same
   surface, same border, same JetBrains Mono everywhere. Tokens in
   `apps/web/lib/brand/tokens.ts` are the source of truth and `tailwind.config.ts`
   + `app/globals.css` both read from them.

2. **Highlight colors for Base / Ethereum on the headline chart.** The Lending
   Terminal uses orange (`accent`) as its top emphasis color and purple
   (`accentSecondary`) as the next; I assigned orange to Base (the "Morpho
   dominates" story) and purple to Ethereum. The other 11 chains stay in muted
   white at 22% opacity. Previously the chart used indigo + amber + slate grey —
   replaced.

3. **Chain table styling.** Borrowed the terminal's row pattern: ALL-CAPS chain
   names in primary text, tabular-nums in `JetBrains Mono`, green/red delta column
   with a small `PP` suffix marker. Sortable headers in muted small-caps.

4. **Sidebar over top nav.** The terminal uses a top nav; the user explicitly
   asked for a sidebar matching the terminal's nav STYLING. I kept the sidebar
   structure but applied the terminal's nav typography (uppercase, mono,
   wide-tracked, muted by default, accent on hover) and width pattern (240 px,
   bordered, with the same `● Connected` status indicator at the foot).

5. **Title block hierarchy** (user-specified):
   - `Datum Labs` — 10 px, muted, wide-tracked
   - `Morpho Research` — 11 px, text-primary, slightly less wide tracking
   - `Terminal` — same line, lighter weight, muted
   Mirrors "Lending Intelligence Terminal · Datum Labs" but stacked.

6. **Chart library kept.** Recharts already in the stack; the terminal also uses
   Recharts (confirmed by `.recharts-surface` hydration signal). No swap needed.
   Restyled globally via `globals.css` so axes / gridlines / tooltips
   automatically match.

7. **Logo.** Downloaded `branding/logo.png` (the 48 × 48 blue cube icon at
   `/branding/datumlabs-icon.png` on the terminal) and copied into
   `apps/web/public/branding/`. Rendered next to the title block in the sidebar.

8. **Color-coded KPI accents.** Each KPI card in the Overview gets a 1 px
   top-border stripe in a different chart-palette color (chart-1 / chart-2 /
   chart-4 / chart-5 / chart-6), matching the terminal's per-card accent treatment
   in its Sector Overview row.

## Trade-offs / things I didn't replicate

- **The terminal's "Issue" feature card** (a dark-blue-tinted spotlight card with
  a featured editorial). Not needed for v1 of the Morpho dashboard.
- **Top nav** (in favor of a sidebar per the user's explicit request).
- **The CRT scanline overlay** the terminal uses (defined in its CSS variables
  as `--scanline-color: hsla(0,0%,100%,0.02)`). Optional; can add later.
- **The `▲` / `▼` 24h-change indicators** on KPI cards. Easy to add once we have
  delta data for each KPI.

## Constraints honored

- Every color in the dashboard comes from `tokens.colors`. No invented hex.
- No proprietary asset reuse — JetBrains Mono is Apache 2.0 (see `fonts.md`).
- Dark mode is the primary mode, matching the terminal.
- Recharts is the chart library on both sides.

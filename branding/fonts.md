# Fonts

## JetBrains Mono — the only face used

The Lending Intelligence Terminal loads `JetBrains Mono` with variable weight
(`100 900`) — see `branding/extracted-tokens.json` → `fonts`. It uses Mono for
everything: headings, KPI values, table cells, buttons, body. There is no
sans-serif fallback anywhere on the page.

We mirror that exactly. The Morpho dashboard loads JetBrains Mono via
Next.js's `next/font/google` integration in `apps/web/app/layout.tsx`:

```ts
import { JetBrains_Mono } from 'next/font/google';
const jbm = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains-mono' });
```

Self-hosted via Next's font pipeline → no external font CDN at runtime → no
FOIT/FOUT on cold loads.

### License

JetBrains Mono is released under the **SIL Open Font License 1.1**
(https://www.jetbrains.com/lp/mono/). Free for any commercial use, embedding,
and redistribution. No license header needed in our app — we're loading via
Google Fonts which already handles attribution.

## Geist (not used here)

The marketing page at `datumlab.xyz/lending-terminal` loads `Geist` and
`Geist Mono` — but that's the brochure site, not the terminal. We follow the
terminal, which uses only JetBrains Mono. Documented for future reference.

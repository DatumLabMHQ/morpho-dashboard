import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';

import { TopNav } from '@/components/nav/top-nav';
import { ThemeProvider } from '@/components/theme-provider';

import './globals.css';

// JetBrains Mono — free OSS, mirrors the Lending Terminal's primary face.
const jbm = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

// Pre-paint theme script. Reads the persisted choice from localStorage and
// writes `data-theme` to <html> before React hydrates. Without this inline
// pass, a user with light-mode persisted would see a dark-mode flash on
// every page load. Next.js's <Script> loads AFTER paint, so we inline.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var saved = window.localStorage.getItem('morpho-theme');
    if (saved !== 'light' && saved !== 'dark') saved = 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://morpho-dashboard.vercel.app';

// Note: do NOT set `openGraph.images` here. Next.js's file-convention
// `app/opengraph-image.tsx` auto-injects the rendered PNG into every route
// that doesn't override it. Setting it explicitly here would shadow that.
export const metadata: Metadata = {
  title: 'Morpho Research Terminal · Datum Labs',
  description:
    'Multi-chain Morpho Blue analytics — markets, vaults, curators, rates, and asset composition across Ethereum, Base, Arbitrum, Polygon, Hyperliquid and more.',
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: 'DatumLabs Research',
    title: 'Morpho Research Terminal · Datum Labs',
    description:
      'Markets, vaults, curators, rates, and asset composition across every chain Morpho is live on.',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@datumlabs',
    creator: '@datumlabs',
    title: 'Morpho Research Terminal · Datum Labs',
    description: 'Multi-chain Morpho Blue analytics. Live terminal.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={jbm.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-text-primary font-sans antialiased">
        <ThemeProvider>
          <TopNav />
          {/* Standard page wrapper from globals.css — caps at 1400px so dense
              chart grids stay legible on ultra-wide displays. */}
          <main className="max-w-[1400px] mx-auto px-4 lg:px-6 py-5 space-y-5">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}

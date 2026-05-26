import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';

import { Sidebar } from '@/components/nav/sidebar';
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

export const metadata: Metadata = {
  title: 'Morpho Research Terminal · Datum Labs',
  description: 'Multi-chain Morpho analytics — Datum Labs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={jbm.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-text-primary font-sans antialiased">
        <ThemeProvider>
          <Sidebar />
          <main className="ml-60 min-h-screen px-8 py-7">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}

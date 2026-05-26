'use client';

import { toPng } from 'html-to-image';
import { useRef, useState } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  csvFilename: string;
  // CSV content (header + rows) is pre-computed on the server. Was previously
  // a builder function but functions can't cross the RSC boundary into a
  // client component, so we just pass the string.
  csvContent: string;
  pngFilename?: string;
  children: React.ReactNode;
  /** Optional right-side controls (e.g. tab switch). Rendered between title and buttons. */
  rightControls?: React.ReactNode;
}

// Standard wrapper around every chart on the per-chain detail page:
//   - ALL-CAPS small-cap title in the terminal style
//   - Optional subtitle (auto-generated stat line)
//   - Copy-as-CSV + Export-PNG buttons in the top-right
//   - Captures the chart node only (not the buttons) when exporting PNG.
export function ChartFrame({
  title,
  subtitle,
  csvFilename,
  csvContent,
  pngFilename,
  children,
  rightControls,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'idle' | 'copied' | 'exported' | 'error'>('idle');

  const copyCsv = async () => {
    try {
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = csvFilename;
      a.click();
      URL.revokeObjectURL(url);
      setBusy('copied');
      setTimeout(() => setBusy('idle'), 1500);
    } catch (e) {
      console.error(e);
      setBusy('error');
    }
  };

  const exportPng = async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: '#14171d',
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement('a');
      a.download = pngFilename ?? csvFilename.replace(/\.csv$/, '.png');
      a.href = dataUrl;
      a.click();
      setBusy('exported');
      setTimeout(() => setBusy('idle'), 1500);
    } catch (e) {
      console.error(e);
      setBusy('error');
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-small uppercase tracking-header-wide text-text-muted">{title}</h2>
          {subtitle && <p className="mt-1 text-tiny text-text-secondary">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {rightControls}
          <button
            onClick={copyCsv}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-tiny uppercase tracking-header-medium text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            {busy === 'copied' ? '✓ CSV' : 'CSV'}
          </button>
          <button
            onClick={exportPng}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-tiny uppercase tracking-header-medium text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            {busy === 'exported' ? '✓ PNG' : 'PNG'}
          </button>
        </div>
      </header>
      <div ref={chartRef} className="bg-surface p-5">{children}</div>
    </section>
  );
}

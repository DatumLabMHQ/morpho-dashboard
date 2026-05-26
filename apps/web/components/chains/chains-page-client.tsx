'use client';

import { format, parseISO } from 'date-fns';
import { toPng } from 'html-to-image';
import { useRef, useState } from 'react';

import { ShareByChainChart } from './share-by-chain-chart';
import { ChainsTable } from './chains-table';
import type { ChainsPagePayload } from '@/lib/queries/chains';

interface Props {
  payload: ChainsPagePayload;
}

const EXPORT_FILENAME = 'morpho-share-by-chain.png';

export function ChainsPageClient({ payload }: Props) {
  const [reportMode, setReportMode] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const subtitle = payload.subtitle;
  const formattedAsOf = (() => {
    try { return format(parseISO(payload.asOfDate), 'PP'); }
    catch { return payload.asOfDate; }
  })();

  async function handleExport(persist: boolean) {
    if (!chartRef.current) return;
    setBusy('exporting');
    setErrMsg(null);
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: '#0b0d11',
        pixelRatio: 2,
        cacheBust: true,
      });
      const link = document.createElement('a');
      link.download = EXPORT_FILENAME;
      link.href = dataUrl;
      link.click();
      if (persist) {
        const blob = await (await fetch(dataUrl)).blob();
        const buf = await blob.arrayBuffer();
        const res = await fetch('/api/save-export', {
          method: 'POST',
          headers: { 'content-type': 'image/png' },
          body: buf,
        });
        if (!res.ok) throw new Error(`save-export failed: ${res.status}`);
      }
      setBusy('done');
      setTimeout(() => setBusy('idle'), 1500);
    } catch (e) {
      console.error(e);
      setErrMsg(e instanceof Error ? e.message : String(e));
      setBusy('error');
    }
  }

  const chartBlock = (
    <div
      ref={chartRef}
      className="bg-surface"
      style={{
        width: reportMode ? 1600 : '100%',
        padding: reportMode ? 48 : 20,
      }}
      data-export-target="chart"
    >
      <h2
        className="text-text-primary uppercase tracking-header-wide"
        style={{ fontSize: reportMode ? 22 : 14, fontWeight: 500 }}
      >
        Morpho&apos;s share of lending TVL, by chain
      </h2>
      {subtitle && (
        <p
          className="mt-2 text-text-muted"
          style={{ fontSize: reportMode ? 14 : 12, letterSpacing: '0.03em' }}
        >
          {subtitle}
        </p>
      )}
      <div className="mt-5">
        <ShareByChainChart
          data={payload.series}
          chains={payload.chains}
          reportMode={reportMode}
        />
      </div>
      <p
        className="mt-3 text-text-muted uppercase tracking-header-medium"
        style={{ fontSize: reportMode ? 11 : 10 }}
      >
        Source: DefiLlama, lending + CDP categories · Snapshot {formattedAsOf}
      </p>
    </div>
  );

  if (reportMode) {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-background p-8">
        <div className="mx-auto max-w-[1700px]">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-tiny uppercase tracking-header-wide text-text-muted">
              Report mode preview · 1600 × ~720 px
            </h1>
            <div className="flex gap-2">
              <button
                data-testid="export-png"
                onClick={() => handleExport(true)}
                disabled={busy === 'exporting'}
                className="rounded-md bg-accent px-3 py-1.5 text-small uppercase tracking-header-medium font-medium text-background hover:brightness-110 disabled:opacity-50"
              >
                {busy === 'exporting' ? 'Exporting…' : busy === 'done' ? '✓ Exported' : 'Export PNG'}
              </button>
              <button
                onClick={() => setReportMode(false)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-small uppercase tracking-header-medium text-text-secondary hover:bg-surface-hover"
              >
                Exit
              </button>
            </div>
          </div>
          {errMsg && (
            <p className="mb-4 rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-small text-negative">
              {errMsg}
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border-bright shadow-card">
            {chartBlock}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-body uppercase tracking-header-wide text-text-muted">
            Chains
          </h1>
          <p className="mt-1 text-body text-text-secondary">
            Morpho&apos;s share of each chain&apos;s lending TVL
            <span className="ml-1 text-text-muted">(DefiLlama, lending + CDP)</span>
          </p>
        </div>
        <button
          data-testid="report-mode-on"
          onClick={() => setReportMode(true)}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-small uppercase tracking-header-medium text-text-secondary hover:bg-surface-hover"
        >
          Report mode →
        </button>
      </header>

      <section className="rounded-lg border border-border bg-surface">
        {chartBlock}
      </section>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-small uppercase tracking-header-wide text-text-muted">
          All chains Morpho is live on
        </h2>
        <ChainsTable rows={payload.table} />
        <p className="mt-3 text-tiny uppercase tracking-header-medium text-text-muted">
          12-month delta in percentage points · &quot;—&quot; means no data 12 months ago
        </p>
      </section>
    </div>
  );
}

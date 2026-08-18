'use client';

/**
 * CiteThisPage. Small footer card with a copyable academic-style citation.
 *
 * Ported from the Lending Intelligence Terminal. Date is computed client-side
 * so the citation always reflects the visit date, not a stale build time.
 */
import { Check, ClipboardCopy } from 'lucide-react';
import { useState } from 'react';

interface Props {
  /** Page title used in the citation, e.g. "Asset composition". */
  pageTitle: string;
  /** Canonical URL of the page (relative or absolute). */
  pageUrl: string;
}

export function CiteThisPage({ pageTitle, pageUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const todayLong = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const year = new Date().getUTCFullYear();
  const citation = `Datum Labs. (${year}). Morpho Research Terminal: ${pageTitle}. Retrieved ${todayLong} from ${pageUrl}.`;

  function handleCopy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(citation).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4 flex flex-col gap-2">
      <div
        className="text-tiny uppercase font-bold"
        style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}
      >
        Cite this page
      </div>
      <p className="text-small leading-relaxed font-mono text-text-secondary normal-case" style={{ letterSpacing: 'normal' }}>
        {citation}
      </p>
      <button
        type="button"
        onClick={handleCopy}
        className="self-start inline-flex items-center gap-1.5 text-tiny uppercase"
        style={{
          padding: '4px 10px',
          border: '1px solid var(--card-border)',
          borderRadius: '4px',
          background: 'var(--background)',
          color: copied ? 'var(--success)' : 'var(--text-muted)',
          cursor: 'pointer',
          letterSpacing: '0.08em',
          transition: 'color 0.15s ease',
        }}
      >
        {copied ? (
          <>
            <Check size={11} strokeWidth={2.5} />
            <span>Copied</span>
          </>
        ) : (
          <>
            <ClipboardCopy size={11} strokeWidth={2.25} />
            <span>Copy citation</span>
          </>
        )}
      </button>
    </div>
  );
}

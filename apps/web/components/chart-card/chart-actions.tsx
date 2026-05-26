'use client';

/**
 * ChartActions — three controls on every chart card's header:
 *
 *  - Download PNG (uses html-to-image; honors `[data-chart-export-hide]`)
 *  - Copy link with current URL search state — link is shareable and
 *    reproduces the same chart settings (range, asset filter, etc).
 *  - Expand — toggles a `chart-expanded` class on the card promoting it
 *    to a near-fullscreen overlay (CSS lives in globals.css). Recharts
 *    reflows automatically inside the larger box. Esc / backdrop click
 *    dismisses.
 *
 * Ported from the Lending Intelligence Terminal with PNG instead of SVG
 * (the existing dashboard already depends on html-to-image; keeping the
 * pixel output preserves the user-side workflow).
 */

import { toPng } from 'html-to-image';
import { Copy, Maximize2, Minimize2, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  cardRef: React.RefObject<HTMLElement | null>;
  /** Used to name the downloaded PNG and in the copy-link aria label. */
  title: string;
}

export function ChartActions({ cardRef, title }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<'png' | 'link' | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Mount: toggle `.chart-expanded` on the card + lock body scroll while open.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (expanded) {
      el.classList.add('chart-expanded');
      document.body.style.overflow = 'hidden';
    } else {
      el.classList.remove('chart-expanded');
      document.body.style.overflow = '';
    }
    return () => {
      el.classList.remove('chart-expanded');
      document.body.style.overflow = '';
    };
  }, [expanded, cardRef]);

  // Esc closes expanded.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setExpanded(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  async function onPngDownload() {
    const el = cardRef.current;
    if (!el || busy) return;
    setBusy(true);

    // Hide actions container + any `[data-chart-export-hide]` UI chrome
    // (time toggles) while the snapshot renders, then restore.
    const actionsEl = actionsRef.current;
    const prevVisibility = actionsEl?.style.visibility ?? '';
    if (actionsEl) actionsEl.style.visibility = 'hidden';
    const hideTargets = Array.from(
      el.querySelectorAll<HTMLElement>('[data-chart-export-hide]'),
    );
    const hideSnapshot = hideTargets.map((node) => ({
      node,
      prev: node.style.visibility,
    }));
    for (const t of hideTargets) t.style.visibility = 'hidden';

    try {
      // Read the live card-bg CSS variable so the snapshot matches the active theme.
      const cardBg =
        getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim() ||
        '#14171D';
      const dataUrl = await toPng(el, {
        backgroundColor: cardBg,
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement('a');
      const safeName = title
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
      a.download = `${safeName || 'chart'}.png`;
      a.href = dataUrl;
      a.click();
      setFlash('png');
      setTimeout(() => setFlash(null), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chart-actions] PNG export failed:', err);
    } finally {
      if (actionsEl) actionsEl.style.visibility = prevVisibility;
      for (const { node, prev } of hideSnapshot) node.style.visibility = prev;
      setBusy(false);
    }
  }

  async function onCopyLink() {
    try {
      // Current full URL, including search params (URL filter / sort state).
      // Adding a #fragment anchor to the card would be nicer but we don't
      // have stable IDs on every card yet — leave URL as-is.
      const url = typeof window !== 'undefined' ? window.location.href : '';
      await navigator.clipboard.writeText(url);
      setFlash('link');
      setTimeout(() => setFlash(null), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chart-actions] copy link failed:', err);
    }
  }

  const iconBtn = {
    padding: 4,
    borderRadius: 3,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  } as React.CSSProperties;

  return (
    <div
      ref={actionsRef}
      className="flex items-center gap-0.5"
      data-chart-actions
    >
      <button
        type="button"
        onClick={onPngDownload}
        disabled={busy}
        title={flash === 'png' ? 'Downloaded ✓' : 'Download PNG'}
        aria-label="Download chart as PNG"
        style={{ ...iconBtn, opacity: busy ? 0.5 : 1 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <Download size={12} />
      </button>
      <button
        type="button"
        onClick={onCopyLink}
        title={flash === 'link' ? 'Copied ✓' : 'Copy link'}
        aria-label="Copy link to this view"
        style={iconBtn}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <Copy size={12} />
      </button>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? 'Collapse' : 'Expand'}
        aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
        style={iconBtn}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>

      {/* Backdrop is portaled to <body> so it sits in the document stacking
          context (z-index: 1000) below the expanded card (z-index: 1001). */}
      {expanded &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="chart-expanded-backdrop"
            onClick={() => setExpanded(false)}
            aria-hidden="true"
          />,
          document.body,
        )}
    </div>
  );
}

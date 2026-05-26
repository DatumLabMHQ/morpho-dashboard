'use client';

import { Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getMethodology } from '@/lib/methodology';

interface Props {
  /** Plain-text definition of the metric / chart. */
  text?: string;
  /** Optional source attribution. */
  source?: string;
  /** Optional methodology link. */
  href?: string;
  /** Look up `text` / `source` / `href` from content/methodology.json. */
  methodologyKey?: string;
}

const TOOLTIP_WIDTH = 320;
const VIEWPORT_PADDING = 8;

/**
 * Inline ⓘ icon → tooltip popover. Click to toggle, click-outside to close.
 *
 * Ported from the Lending Intelligence Terminal. The popover renders via a
 * React portal so it is never clipped by an `overflow: hidden` parent (some
 * verdict / chart cards do clip). Position is clamped to viewport so the
 * popover can't spill off either edge.
 */
export function MethodologyTooltip(props: Props) {
  const { text: rawText, source: rawSource, href: rawHref, methodologyKey } = props;
  const fromKey = getMethodology(methodologyKey);
  const text = rawText ?? fromKey?.text;
  const source = rawSource ?? fromKey?.source;
  const href = rawHref ?? fromKey?.href;

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function handleReposition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords(computeCoords(rect));
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords(computeCoords(rect));
  }, [open]);

  if (!text) return null;

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Methodology"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '1px 2px',
          cursor: 'pointer',
          color: open ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        <Info size={11} strokeWidth={2.25} />
      </button>
      {mounted && open && coords && createPortal(
        <div
          ref={popoverRef}
          role="tooltip"
          style={{
            position: 'fixed',
            left: coords.left,
            top: coords.top,
            width: coords.width,
            zIndex: 100,
            background: 'var(--tooltip-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '4px',
            padding: '10px 12px',
            boxShadow: '0 8px 32px var(--tooltip-shadow)',
            backdropFilter: 'blur(12px)',
            fontSize: '11px',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
            whiteSpace: 'normal',
          }}
        >
          <div style={{ marginBottom: source || href ? '6px' : 0 }}>{text}</div>
          {source && (
            <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '4px' }}>
                Source
              </span>
              {source}
            </div>
          )}
          {href && (
            <div style={{ marginTop: '4px' }}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--accent)', fontSize: '10px' }}
              >
                Methodology details ↗
              </a>
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

function computeCoords(rect: DOMRect): { left: number; top: number; width: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : TOOLTIP_WIDTH;
  const width = Math.min(TOOLTIP_WIDTH, vw - VIEWPORT_PADDING * 2);
  let left = rect.left;
  if (left + width + VIEWPORT_PADDING > vw) {
    left = vw - width - VIEWPORT_PADDING;
  }
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
  const top = rect.bottom + 6;
  return { left, top, width };
}

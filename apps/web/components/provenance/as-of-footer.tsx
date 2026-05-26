/**
 * AsOfFooter — small "data as of X · source: Y" footer rendered at the
 * bottom of every page. Server component (no client JS for the formatter).
 *
 * Ported from the Lending Intelligence Terminal. Differences from the LIT
 * version: this lives at page footer level (full row) rather than per-chart,
 * and is a server component since the fetchedAt timestamp comes from server
 * data and never needs to change client-side.
 */

interface Props {
  /** ISO timestamp string or unix seconds. */
  fetchedAt: string | number | Date;
  /** Source attribution, e.g. "Morpho Blue GraphQL + DefiLlama Yields". */
  source: string;
  /** Optional one-liner appended after the source. */
  note?: string;
}

function toDate(v: string | number | Date): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Heuristic: seconds vs ms.
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  return new Date(v);
}

function fmtAbsolute(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function AsOfFooter({ fetchedAt, source, note }: Props) {
  const d = toDate(fetchedAt);
  if (!d || Number.isNaN(d.getTime())) return null;
  return (
    <div
      className="mt-6 border-t border-card-border pt-3 text-tiny uppercase tracking-header-medium text-text-muted"
      style={{ letterSpacing: '0.08em' }}
    >
      Data as of <span className="text-text-secondary">{fmtAbsolute(d)}</span>
      <span className="mx-2 text-text-muted/50">·</span>
      Source: <span className="text-text-secondary">{source}</span>
      {note && (
        <>
          <span className="mx-2 text-text-muted/50">·</span>
          <span className="text-text-secondary normal-case" style={{ letterSpacing: 'normal' }}>
            {note}
          </span>
        </>
      )}
    </div>
  );
}

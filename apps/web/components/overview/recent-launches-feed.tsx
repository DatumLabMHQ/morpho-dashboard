import Link from 'next/link';

interface Row {
  /** ISO timestamp. */
  date: string;
  label: string;
  chainName: string | null;
  href?: string;
}

interface Props {
  title: string;
  rows: Row[];
}

/**
 * Terminal-style timeline list. One row per launch:
 *   2026-05-12 · cbBTC / USDT       · Ethereum · 0x9103...
 *
 * Used twice on the Overview footer (new markets / new vaults). Rows are
 * borderless on hover to keep the line-noise low.
 */
export function RecentLaunchesFeed({ title, rows }: Props) {
  return (
    <section className="tui-card bg-card-bg border border-card-border rounded p-4 flex flex-col gap-3">
      <h3
        className="text-tiny uppercase font-bold"
        style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <div className="text-small text-text-muted">No launches in the last 30 days.</div>
      ) : (
        <ul className="flex flex-col font-mono text-small">
          {rows.map((r, i) => {
            const date = (r.date && r.date.length >= 10) ? r.date.slice(0, 10) : '—';
            const inner = (
              <div className="flex items-center gap-3 border-b border-card-border py-1.5 last:border-0">
                <span className="text-text-muted shrink-0" style={{ width: 90 }}>{date}</span>
                <span className="flex-1 truncate text-text-primary uppercase tracking-header-medium">{r.label}</span>
                <span className="shrink-0 text-text-secondary uppercase tracking-header-medium text-tiny">
                  {r.chainName ?? '—'}
                </span>
              </div>
            );
            return r.href ? (
              <li key={i} className="hover:bg-hover-overlay -mx-2 px-2 rounded transition-colors">
                <Link href={r.href} className="block">{inner}</Link>
              </li>
            ) : (
              <li key={i}>{inner}</li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

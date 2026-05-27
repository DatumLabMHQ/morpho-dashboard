import Link from 'next/link';

import { fmtUsd } from '@/lib/format';

interface Row {
  /** Primary label, e.g. "cbBTC / USDC" or "Steakhouse Prime USDC". */
  label: string;
  /** Secondary label, e.g. chain name. Optional. */
  sub?: string;
  /** Number shown on the right. */
  valueUsd: number;
  /** Optional row link (e.g. /curators/<slug>). */
  href?: string;
}

interface Props {
  /** Card title, e.g. "Top Markets". */
  title: string;
  rows: Row[];
  /** "VIEW ALL →" link target. */
  viewAllHref: string;
}

/**
 * Compact 5-row panel used three times on the Overview (markets / vaults /
 * curators). Each row is a single line: label · sub · USD (right-aligned).
 * Footer "VIEW ALL →" link routes to the corresponding directory page.
 */
export function TopFivePanel({ title, rows, viewAllHref }: Props) {
  return (
    <section className="tui-card bg-card-bg border border-card-border rounded p-4 flex flex-col gap-3">
      <h3 className="text-tiny uppercase font-bold" style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}>
        {title}
      </h3>
      <ol className="flex flex-col">
        {rows.length === 0 && (
          <li className="text-small text-text-muted">No data</li>
        )}
        {rows.map((r, i) => {
          const inner = (
            <div className="flex items-center justify-between gap-3 border-b border-card-border py-1.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-small uppercase tracking-header-medium text-text-primary">
                  <span className="text-text-muted mr-2">{i + 1}.</span>
                  {r.label}
                </div>
                {r.sub && (
                  <div className="text-tiny uppercase tracking-header-medium text-text-muted">
                    {r.sub}
                  </div>
                )}
              </div>
              <div className="tabular-nums text-small text-text-primary">
                {fmtUsd(r.valueUsd, { compact: true })}
              </div>
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
      </ol>
      <Link
        href={viewAllHref}
        className="mt-auto text-tiny uppercase tracking-header-medium text-text-muted hover:text-accent transition-colors"
      >
        View all →
      </Link>
    </section>
  );
}

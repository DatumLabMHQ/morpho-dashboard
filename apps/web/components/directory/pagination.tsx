import Link from 'next/link';

interface Props {
  /** 1-indexed current page. */
  page: number;
  /** Total pages (>=1). */
  totalPages: number;
  /** Total rows across all pages. Shown for context. */
  totalRows: number;
  /** Rows on the current page. Used for "showing N of M". */
  pageSize: number;
  basePath: string;
  baseSearch: URLSearchParams;
}

export function Pagination({ page, totalPages, totalRows, pageSize, basePath, baseSearch }: Props) {
  if (totalPages <= 1) {
    return (
      <div className="text-tiny uppercase tracking-header-medium text-text-muted">
        {totalRows} {totalRows === 1 ? 'row' : 'rows'}
      </div>
    );
  }

  const buildHref = (p: number): string => {
    const next = new URLSearchParams(baseSearch.toString());
    if (p <= 1) next.delete('page');
    else next.set('page', String(p));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalRows);

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  // Terminal-style: ◀ PREV · 4 of 20 · NEXT ▶ with the count strip at right.
  const btn = (label: string, href: string, disabled: boolean) =>
    disabled ? (
      <span className="rounded-md border border-border bg-background px-2.5 py-1 text-tiny uppercase tracking-header-medium text-text-muted/40">
        {label}
      </span>
    ) : (
      <Link
        href={href}
        className="rounded-md border border-border bg-background px-2.5 py-1 text-tiny uppercase tracking-header-medium text-text-muted hover:bg-surface-hover hover:text-text-primary"
      >
        {label}
      </Link>
    );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        {btn('◀ Prev', buildHref(page - 1), prevDisabled)}
        <span className="text-tiny uppercase tracking-header-medium text-text-muted">
          Page <span className="text-text-primary">{page}</span> of {totalPages}
        </span>
        {btn('Next ▶', buildHref(page + 1), nextDisabled)}
      </div>
      <div className="text-tiny uppercase tracking-header-medium text-text-muted">
        Showing <span className="text-text-primary">{start}</span>–
        <span className="text-text-primary">{end}</span> of{' '}
        <span className="text-text-primary">{totalRows}</span>
      </div>
    </div>
  );
}

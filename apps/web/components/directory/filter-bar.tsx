'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export interface ActiveFilter {
  /** URL search-param key. Stripped from the URL when this chip is dismissed. */
  key: string;
  /** Display label, e.g. "chain: Base". */
  label: string;
  /** Optional specific value to remove (for multi-select keys). When set, only
   *  that comma-list entry is dropped instead of the whole key. */
  value?: string;
}

interface Props {
  filters: ActiveFilter[];
}

// Pill chips for active filters with × dismiss. Routes via Next Link so the
// page re-renders with the updated server-rendered table.
export function FilterBar({ filters }: Props) {
  const pathname = usePathname();
  const search = useSearchParams();

  if (filters.length === 0) return null;

  const buildHrefWithout = (key: string, value?: string): string => {
    const next = new URLSearchParams(search.toString());
    if (value && next.has(key)) {
      const remaining = next
        .get(key)!
        .split(',')
        .filter((v) => v !== value);
      if (remaining.length === 0) next.delete(key);
      else next.set(key, remaining.join(','));
    } else {
      next.delete(key);
    }
    // Reset page param so removing a filter doesn't strand the user on an
    // empty page far past the new result count.
    next.delete('page');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-tiny uppercase tracking-header-medium text-text-muted">
        Active filters:
      </span>
      {filters.map((f, i) => (
        <Link
          key={`${f.key}-${f.value ?? ''}-${i}`}
          href={buildHrefWithout(f.key, f.value)}
          className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-tiny uppercase tracking-header-medium text-accent hover:bg-accent/20"
        >
          <span>{f.label}</span>
          <span className="text-text-muted hover:text-text-primary">×</span>
        </Link>
      ))}
      <Link
        href={pathname}
        className="rounded-md border border-border bg-background px-2 py-0.5 text-tiny uppercase tracking-header-medium text-text-muted hover:text-text-primary"
      >
        Clear all
      </Link>
    </div>
  );
}

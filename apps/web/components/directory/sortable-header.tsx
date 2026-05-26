import Link from 'next/link';

interface Props {
  /** URL search-param key this column sorts by. */
  sortKey: string;
  /** Display label. */
  children: React.ReactNode;
  /** Current active sort key (from search params). */
  activeKey?: string | null;
  /** Current active direction. */
  activeDir?: 'asc' | 'desc';
  /** Default direction when first activated (most numeric columns want desc). */
  defaultDir?: 'asc' | 'desc';
  /** Path + existing search params, used to construct the next href. */
  basePath: string;
  baseSearch: URLSearchParams;
  align?: 'left' | 'right';
}

// Clickable column header that toggles between asc/desc on its key. Brand
// arrows: ↑ for asc, ↓ for desc, neutral dot when inactive.
export function SortableHeader({
  sortKey,
  children,
  activeKey,
  activeDir,
  defaultDir = 'desc',
  basePath,
  baseSearch,
  align = 'left',
}: Props) {
  const active = activeKey === sortKey;
  // First click activates with defaultDir. Subsequent clicks toggle.
  const nextDir: 'asc' | 'desc' = active ? (activeDir === 'asc' ? 'desc' : 'asc') : defaultDir;
  const next = new URLSearchParams(baseSearch.toString());
  next.set('sort', sortKey);
  next.set('dir', nextDir);
  next.delete('page');
  const href = `${basePath}?${next.toString()}`;

  const arrow = active ? (activeDir === 'asc' ? '↑' : '↓') : '·';

  return (
    <th className={`pb-2 text-tiny font-normal uppercase tracking-header-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-text-primary ${active ? 'text-accent' : 'text-text-muted'}`}
      >
        <span>{children}</span>
        <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-50'}`}>{arrow}</span>
      </Link>
    </th>
  );
}

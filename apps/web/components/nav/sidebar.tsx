import Image from 'next/image';
import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';

interface Surface {
  href: string;
  label: string;
}

// Matches the Lending Terminal's top-nav tabs: ALL-CAPS, wide-tracked, muted
// by default with accent-orange on active. Hover lifts to text-secondary.
// Rendered as a vertical sidebar to fit the dashboard's wider page footprint.
const SURFACES: Surface[] = [
  { href: '/',           label: 'Overview' },
  { href: '/chains',     label: 'Chains' },
  { href: '/curators',   label: 'Curators' },
  { href: '/vaults',     label: 'Vaults' },
  { href: '/markets',    label: 'Markets' },
  { href: '/assets',     label: 'Assets' },
  { href: '/rates',      label: 'Rates' },
  { href: '/lab',        label: 'Lab' },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-10 flex h-screen w-60 flex-col border-r border-border bg-background">
      {/* Title block: small mono "Datum Labs" over the product label,
          mirroring the lending terminal's wordmark hierarchy. */}
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <Image
          src="/branding/datumlabs-icon.png"
          alt=""
          width={22}
          height={22}
          className="shrink-0"
        />
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-header-wide text-text-muted">
            Datum Labs
          </div>
          <div className="text-small uppercase tracking-header-medium text-text-primary">
            Morpho Research
            <span className="ml-1 text-text-muted font-normal">Terminal</span>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-px px-2 py-3">
        {SURFACES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="
              group relative
              rounded-md px-3 py-2
              text-small uppercase tracking-header-medium
              text-text-muted
              transition-colors
              hover:bg-hover-overlay hover:text-text-secondary
            "
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {/* Footer: status pill on the left, theme toggle on the right. */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-4 py-3">
        <span className="text-tiny uppercase tracking-header-medium text-text-muted">
          <span className="mr-1.5 inline-block size-1.5 rounded-full bg-positive align-middle" />
          Connected
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

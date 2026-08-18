import Link from 'next/link';

const ROUTES: { href: string; label: string }[] = [
  { href: '/', label: 'Overview' },
  { href: '/chains', label: 'Chains' },
  { href: '/curators', label: 'Curators' },
  { href: '/vaults', label: 'Vaults' },
  { href: '/markets', label: 'Markets' },
  { href: '/assets', label: 'Assets' },
  { href: '/methodology', label: 'Methodology' },
];

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center py-16">
      <p className="text-tiny uppercase tracking-header-wide text-accent">404</p>
      <h1 className="mt-2 text-[28px] uppercase tracking-header-medium leading-none text-text-primary">
        Page not found
      </h1>
      <p className="mt-3 text-body text-text-secondary">
        The requested page does not exist on this dashboard.
      </p>
      <nav className="mt-8 flex flex-col gap-px border-t border-border pt-4">
        {ROUTES.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-md px-3 py-2 text-small uppercase tracking-header-medium text-text-muted transition-colors hover:bg-hover-overlay hover:text-text-primary"
          >
            {r.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

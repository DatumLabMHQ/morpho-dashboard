'use client';

/**
 * Top navigation bar — matches the Lending Intelligence Terminal pattern.
 *
 * Brand block on the left (Datum Labs icon · product label), nav links in
 * the center / right, then a CONNECTED status pill and the theme toggle.
 *
 * Active tab gets the orange accent color + faint accent-tinted background
 * + 1px bottom border so the eye finds the current surface immediately.
 *
 * Replaces the old fixed left sidebar so the layout matches the Lending
 * Terminal and frees up the full viewport width for dense chart grids.
 */

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/components/theme-toggle';

const DASHBOARD_TITLE = 'Morpho Research Terminal';

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/',         label: 'Overview' },
  { href: '/chains',   label: 'Chains' },
  { href: '/curators', label: 'Curators' },
  { href: '/vaults',   label: 'Vaults' },
  { href: '/markets',  label: 'Markets' },
  { href: '/assets',   label: 'Assets' },
  { href: '/rates',    label: 'Rates' },
  { href: '/lab',      label: 'Lab' },
];

export function TopNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Desktop / tablet bar */}
      <nav
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel-header)',
        }}
      >
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 flex items-center justify-between h-10">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/branding/datumlabs-icon.png"
              alt="Datum Labs"
              width={22}
              height={22}
              className="rounded-sm"
              priority
            />
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              |
            </span>
            <span
              className="text-[10px] uppercase tracking-[0.15em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {DASHBOARD_TITLE}
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {/* Desktop nav — hidden under md to avoid wrap. */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] rounded transition-colors"
                    style={{
                      color: active ? 'var(--accent-orange)' : 'var(--text-muted)',
                      background: active ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
                      borderBottom: active
                        ? '1px solid var(--accent-orange)'
                        : '1px solid transparent',
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* CONNECTED status pill — matches the SDK DashboardLayout chrome. */}
            <span
              className="inline-flex items-center gap-1.5 text-[10px]"
              style={{ color: 'var(--text-muted)' }}
            >
              <span
                className="inline-block size-1.5 rounded-full animate-pulse"
                style={{ background: 'var(--accent-orange)' }}
              />
              CONNECTED
            </span>

            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Mobile horizontal-scroll nav (visible under md) */}
      <div
        className="md:hidden flex items-center gap-1 px-4 py-2 overflow-x-auto"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel-header)',
        }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] rounded whitespace-nowrap transition-colors"
              style={{
                color: active ? 'var(--accent-orange)' : 'var(--text-muted)',
                background: active ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent',
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

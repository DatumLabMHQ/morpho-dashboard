'use client';

/**
 * IframePathSync - persists the current path so a parent reload can restore it.
 *
 * When this dashboard is embedded at `datumlab.xyz/morpho-terminal`, the parent
 * hardcodes the iframe `src` to the root, so refreshing the parent reloads us
 * at "/" (Overview). To keep the user in place we record the current path in
 * this origin's sessionStorage on every route change; the RESTORE script in
 * `app/layout.tsx` reads it on the next load - synchronously in <head>, before
 * paint - and `location.replace`s to it, so Overview never renders.
 *
 * This component only WRITES; the restore is the pre-paint head script (doing
 * it here in an effect would let Overview render first, which is the flash we
 * are removing). Mounted once in `app/layout.tsx` inside a Suspense boundary
 * (useSearchParams requires it).
 */
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const STORAGE_KEY = 'morpho-terminal-path';
const MESSAGE_SOURCE = 'datumlabs-morpho-terminal';

export function IframePathSync() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = searchParams.toString();
    const fullPath = search ? `${pathname}?${search}` : pathname;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, fullPath);
    } catch {
      /* storage blocked (strict third-party policy) - refresh-restore won't apply */
    }
    // Notify the parent too (no-op unless it listens - enables an optional
    // deep-link upgrade without any change here).
    if (window.parent !== window) {
      window.parent.postMessage(
        { source: MESSAGE_SOURCE, type: 'path-change', path: fullPath },
        '*',
      );
    }
  }, [pathname, searchParams]);

  return null;
}

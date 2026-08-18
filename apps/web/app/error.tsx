'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log to the console for diagnostics; never shown to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center py-16">
      <p className="text-tiny uppercase tracking-header-wide text-negative">Error</p>
      <h1 className="mt-2 text-[28px] uppercase tracking-header-medium leading-none text-text-primary">
        Something broke
      </h1>
      <p className="mt-3 text-body text-text-secondary">
        A page on this dashboard failed to render. This is usually transient. Try again, and if it keeps happening the data
        sync may be mid-update.
      </p>
      <div className="mt-8">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md border border-border-bright px-4 py-2 text-small uppercase tracking-header-medium text-text-primary transition-colors hover:bg-hover-overlay"
        >
          Retry
        </button>
      </div>
      {error.digest && (
        <p className="mt-6 text-tiny uppercase tracking-header-medium text-text-muted">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}

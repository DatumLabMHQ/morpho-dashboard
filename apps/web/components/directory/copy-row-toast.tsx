'use client';

import { useEffect, useState } from 'react';

const EVENT = 'directory-copy-toast';

// A table row that copies an identifier to the clipboard on click and fires a
// toast. The cells are rendered server-side and passed as children, so the
// table head + sorting links stay server components.
export function CopyRow({
  copyId,
  toastPrefix = 'Copied',
  children,
  className,
}: {
  copyId: string;
  toastPrefix?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const copy = () => {
    const fire = (msg: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: msg }));
    try {
      void navigator.clipboard.writeText(copyId);
      fire(`${toastPrefix} ${copyId.length > 22 ? copyId.slice(0, 20) + '…' : copyId}`);
    } catch {
      fire('Clipboard unavailable');
    }
  };
  return (
    <tr
      onClick={copy}
      className={`cursor-pointer border-t border-border hover:bg-hover-overlay ${className ?? ''}`}
      title="Click to copy identifier"
    >
      {children}
    </tr>
  );
}

// Floating toast island. Mount once per page. Listens for copy events.
export function CopyToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handler = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 1600);
    };
    window.addEventListener(EVENT, handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border-bright bg-card-bg px-3 py-1.5 text-tiny uppercase tracking-header-medium text-text-primary shadow-elevated">
      {msg}
    </div>
  );
}

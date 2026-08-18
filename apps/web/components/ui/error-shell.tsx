import Link from 'next/link';

// Shared layout for branded 404 / error states. Centered, terminal-styled.
export function ErrorShell({
  code,
  title,
  children,
}: {
  code?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center py-16">
      {code && <p className="text-tiny uppercase tracking-header-wide text-accent">{code}</p>}
      <h1 className="mt-2 text-[28px] uppercase tracking-header-medium leading-none text-text-primary">{title}</h1>
      <div className="mt-3 space-y-4 text-body text-text-secondary">{children}</div>
    </div>
  );
}

export function ShellLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

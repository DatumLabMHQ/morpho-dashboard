import { ErrorShell, ShellLink } from '@/components/ui/error-shell';

const SUPPORTED = [
  'ethereum', 'base', 'arbitrum', 'polygon', 'optimism', 'unichain',
  'hyperliquid', 'katana', 'worldchain', 'plume', 'sonic', 'corn',
];

export default function ChainNotFound() {
  return (
    <ErrorShell code="404" title="Chain not indexed">
      <p>
        This dashboard does not track a Morpho deployment on that chain, or the chain slug is not recognized.
      </p>
      <div>
        <p className="text-tiny uppercase tracking-header-medium text-text-muted">Currently supported chains</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUPPORTED.map((c) => (
            <ShellLink key={c} href={`/chains/${c}`}>
              <span className="rounded border border-border px-2 py-1 text-small uppercase tracking-header-medium">{c}</span>
            </ShellLink>
          ))}
        </div>
      </div>
      <p className="text-small text-text-muted">
        See the full list on the <ShellLink href="/chains">Chains directory</ShellLink>.
      </p>
    </ErrorShell>
  );
}

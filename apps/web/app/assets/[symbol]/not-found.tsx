import { ErrorShell, ShellLink } from '@/components/ui/error-shell';

export default function AssetNotFound() {
  return (
    <ErrorShell code="404" title="Asset not tracked">
      <p>
        That symbol does not appear as a loan asset or collateral asset in any Morpho market the dashboard indexes.
      </p>
      <p className="text-small text-text-muted">
        See the assets that are tracked on the <ShellLink href="/assets">Assets directory</ShellLink>.
      </p>
    </ErrorShell>
  );
}

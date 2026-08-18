import { ErrorShell, ShellLink } from '@/components/ui/error-shell';

export default function CuratorNotFound() {
  return (
    <ErrorShell code="404" title="Curator not found">
      <p>
        No curator matches that identifier. Curator pages are keyed by the slug shown in the directory, which can change as
        Morpho updates its public curator metadata.
      </p>
      <p className="text-small text-text-muted">
        Browse or search the full roster on the <ShellLink href="/curators">Curators directory</ShellLink>.
      </p>
    </ErrorShell>
  );
}

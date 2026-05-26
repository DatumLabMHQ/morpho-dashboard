interface EmptyStateProps {
  title: string;
  message: string;
  hint?: React.ReactNode;
}

export function EmptyState({ title, message, hint }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border-bright bg-surface/40 p-8 text-center">
      <h3 className="text-body uppercase tracking-header-medium text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-small text-text-muted">{message}</p>
      {hint && <div className="mx-auto mt-3 max-w-md text-small text-text-secondary">{hint}</div>}
    </div>
  );
}

interface PagePlaceholderProps {
  title: string;
  question: string;
}

export function PagePlaceholder({ title, question }: PagePlaceholderProps) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-h1 uppercase tracking-header-wide text-text-muted">{title}</h2>
        <p className="mt-1 text-body text-text-secondary">{question}</p>
      </header>
      <div className="rounded-lg border border-dashed border-border-bright bg-surface/40 p-8 text-center text-small uppercase tracking-header-medium text-text-muted">
        Coming soon
      </div>
    </div>
  );
}

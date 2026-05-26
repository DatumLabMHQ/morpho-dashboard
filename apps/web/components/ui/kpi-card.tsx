interface KpiCardProps {
  label: string;
  value: string;
  subtext?: string;
  /** Optional accent stripe color (any token color name, e.g. 'accent', 'chart-2'). */
  accent?: string;
}

// Bloomberg-terminal-style KPI: dark surface, 1px subtle border, optional
// accent stripe along the top, ALL-CAPS muted label, large tabular value.
export function KpiCard({ label, value, subtext, accent }: KpiCardProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface p-4">
      {accent && (
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `var(--${accent})` }}
        />
      )}
      <div
        className="text-tiny uppercase tracking-header-medium"
        style={accent ? { color: `var(--${accent})` } : undefined}
      >
        {!accent && <span className="text-text-muted">{label}</span>}
        {accent && label}
      </div>
      <div className="mt-2 text-kpi tabular-nums text-text-primary">{value}</div>
      {subtext && (
        <div className="mt-1 text-tiny uppercase tracking-header-medium text-text-muted">
          {subtext}
        </div>
      )}
    </div>
  );
}

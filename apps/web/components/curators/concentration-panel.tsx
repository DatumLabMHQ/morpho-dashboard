import type { ConcentrationStats } from '@/lib/queries/curators';

interface Props {
  stats: ConcentrationStats;
}

// Right-side mini-panel on the directory header. Three stacked numbers with
// an HHI threshold annotation per DOJ scale.
export function ConcentrationPanel({ stats }: Props) {
  const hhiColor =
    stats.hhi >= 2500
      ? 'text-negative'
      : stats.hhi >= 1500
      ? 'text-accent-yellow'
      : 'text-positive';
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4 min-w-[260px]">
      <div className="text-tiny uppercase tracking-header-wide text-text-muted">Concentration</div>
      <div className="mt-2 grid grid-cols-3 gap-4">
        <Stat label="CR3" value={`${(stats.cr3 * 100).toFixed(1)}%`} />
        <Stat label="CR5" value={`${(stats.cr5 * 100).toFixed(1)}%`} />
        <Stat label="HHI" value={Math.round(stats.hhi).toLocaleString()} valueClass={hhiColor} />
      </div>
      <div className="mt-2 text-tiny uppercase tracking-header-medium text-text-muted">
        {stats.hhiLabel}
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-tiny uppercase tracking-header-medium text-text-muted">{label}</div>
      <div className={`mt-0.5 text-body tabular-nums ${valueClass ?? 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

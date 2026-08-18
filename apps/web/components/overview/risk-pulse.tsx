import { fmtUsd } from '@/lib/format';
import type { RiskPulse } from '@/lib/queries/overview';

interface Props {
  data: RiskPulse;
}

function Panel({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  tone?: 'neutral' | 'warn' | 'danger';
}) {
  const accent =
    tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--accent-yellow)' : 'var(--text-secondary)';
  return (
    <div className="relative overflow-hidden rounded-md border border-card-border bg-card-bg pl-5 pr-4 py-4 flex flex-col gap-1.5">
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <span className="text-tiny uppercase font-bold tracking-header-medium" style={{ color: accent }}>{label}</span>
      <span className="text-kpi tabular-nums text-text-primary leading-none">{value}</span>
      <div className="text-tiny text-text-muted leading-relaxed">{sub}</div>
    </div>
  );
}

const pct = (v: number | null, d = 1): string => (v == null ? 'N/A' : `${(v * 100).toFixed(d)}%`);

export function RiskPulsePanels({ data }: Props) {
  const lltvDeltaBps =
    data.weightedLltv != null && data.weightedLltvPriorWeek != null
      ? Math.round((data.weightedLltv - data.weightedLltvPriorWeek) * 10000)
      : null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Panel
        label="Bad Debt"
        value={fmtUsd(data.badDebtUsd, { compact: true })}
        tone={data.badDebtUsd > 0 ? 'danger' : 'neutral'}
        sub={
          <>
            across {data.badDebtMarketCount} markets · unrealized.
            {data.topMarketPair && data.topMarketPct != null && (
              <> Top: <span className="text-text-secondary uppercase tracking-header-medium">{data.topMarketPair}</span> ({pct(data.topMarketPct, 0)} of total).</>
            )}
          </>
        }
      />
      <Panel
        label="Stressed Markets"
        value={String(data.stressedMarketCount)}
        tone={data.stressedMarketCount > 0 ? 'warn' : 'neutral'}
        sub={
          <>
            utilization &gt; 90% · {fmtUsd(data.stressedSupplyUsd, { compact: true })} supply at risk
            {data.stressedPctOfActiveLoans != null && <> ({pct(data.stressedPctOfActiveLoans, 0)} of active loans)</>}.
          </>
        }
      />
      <Panel
        label="Weighted LLTV"
        value={pct(data.weightedLltv)}
        sub={
          <>
            supply-weighted across the sector.
            {lltvDeltaBps != null && (
              <> {lltvDeltaBps >= 0 ? '▲' : '▼'} {Math.abs(lltvDeltaBps)} bps vs 7d ago</>
            )}.
          </>
        }
      />
    </div>
  );
}

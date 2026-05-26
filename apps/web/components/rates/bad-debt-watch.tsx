import { fmtUsd } from '@/lib/format';
import type { BadDebtEvent } from '@/lib/queries/rates';

interface Props {
  data: BadDebtEvent[];
}

export function BadDebtWatch({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-small uppercase tracking-header-medium text-text-muted">
        No bad-debt events recorded in the last 90 days.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-tiny tabular-nums">
        <thead>
          <tr className="text-text-muted">
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Date</th>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Market</th>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Chain</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Prior</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Now</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={`${r.marketKey}-${r.date}-${i}`} className="border-t border-border">
              <td className="px-3 py-2 text-text-secondary">{r.date}</td>
              <td className="px-3 py-2 text-text-primary uppercase tracking-header-medium">
                {r.pair}
              </td>
              <td className="px-3 py-2 text-text-secondary uppercase tracking-header-medium">
                {r.chainSlug}
              </td>
              <td className="px-3 py-2 text-right text-text-muted">
                {fmtUsd(r.priorBadDebtUsd, { compact: true })}
              </td>
              <td className="px-3 py-2 text-right text-text-primary">
                {fmtUsd(r.badDebtUsd, { compact: true })}
              </td>
              <td className="px-3 py-2 text-right text-negative">
                +{fmtUsd(r.deltaUsd, { compact: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

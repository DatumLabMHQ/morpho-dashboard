import { fmtUsd } from '@/lib/format';
import type { RiskRow } from '@/lib/queries/rates';

interface Props {
  data: RiskRow[];
}

const CATEGORY_LABEL: Record<string, string> = {
  stablecoin: 'STABLE',
  lst: 'LST', lrt: 'LRT', btc: 'BTC', eth: 'ETH', rwa: 'RWA', other: 'OTHER',
};

// Top markets by risk_score = supply × utilization × lltv. High score = lots
// of capital, highly utilized, on a high-LTV market — biggest liquidation
// blast radius. Score is shown in $M-units to make magnitudes readable.
export function RiskSurfaceTable({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-small uppercase tracking-header-medium text-text-muted">
        No data
      </div>
    );
  }
  const maxScore = data.reduce((m, r) => Math.max(m, r.riskScore), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-tiny tabular-nums">
        <thead>
          <tr className="text-text-muted">
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Market</th>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Chain</th>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium">Class</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Supply</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Util</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">LLTV</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Borrow APY</th>
            <th className="px-3 py-2 text-right uppercase tracking-header-medium">Risk Score</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => {
            const pct = maxScore > 0 ? r.riskScore / maxScore : 0;
            return (
              <tr key={r.marketKey} className="border-t border-border">
                <td className="px-3 py-2 text-left uppercase tracking-header-medium text-text-primary">
                  {r.pair}
                </td>
                <td className="px-3 py-2 text-left uppercase tracking-header-medium text-text-secondary">
                  {r.chainSlug}
                </td>
                <td className="px-3 py-2 text-left uppercase tracking-header-medium text-text-muted">
                  {CATEGORY_LABEL[r.collateralCategory] ?? r.collateralCategory}
                </td>
                <td className="px-3 py-2 text-right text-text-primary">
                  {fmtUsd(r.supplyUsd, { compact: true })}
                </td>
                <td className="px-3 py-2 text-right text-text-secondary">
                  {(r.utilization * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right text-text-secondary">
                  {(r.lltv * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right text-text-secondary">
                  {r.borrowApy == null ? '—' : `${(r.borrowApy * 100).toFixed(2)}%`}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span
                      className="block h-1.5 rounded-sm bg-accent"
                      style={{ width: `${Math.max(4, pct * 70)}px`, opacity: Math.max(0.3, pct) }}
                    />
                    <span className="text-text-primary tabular-nums">
                      {fmtUsd(r.riskScore, { compact: true, decimals: 1 })}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

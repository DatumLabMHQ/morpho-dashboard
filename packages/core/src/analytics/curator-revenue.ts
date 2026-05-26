// Curator revenue uses GROSS APY, not netApy. Per spec:
//
//   revenue_annualized_usd ≈ Σ vault.tvl × vault.apy × (vault.fee_bps / 10_000)
//
// Attribution comes from vw_vault_attribution (label + attributed_curator_id):
//   - 'curator'      → bucket keyed by attributed_curator_id
//   - 'dao_treasury' → DAO bucket (curatorId=null)
//   - 'unattributed' → unattributed bucket (curatorId=null)
//
// This is an annualized snapshot — fees are realized in vault shares, not
// USD-marked daily. Disclose that in the UI footer.

export type AttributionLabel = 'curator' | 'dao_treasury' | 'unattributed';

export interface VaultForRevenue {
  chainId: number;
  vaultAddress: string;
  tvlUsd: number;
  apy: number;                          // gross, pre-fee
  feeBps: number;
  attributedCuratorId: string | null;
  attributionLabel: AttributionLabel;
}

export interface CuratorRevenueBucket {
  curatorId: string | null;             // null for dao_treasury / unattributed
  label: AttributionLabel;
  vaultCount: number;
  tvlUsd: number;
  revenueAnnualizedUsd: number;
}

export function vaultRevenueAnnualized(v: {
  tvlUsd: number;
  apy: number;
  feeBps: number;
}): number {
  if (!Number.isFinite(v.tvlUsd) || v.tvlUsd <= 0) return 0;
  if (!Number.isFinite(v.apy) || v.apy <= 0) return 0;
  if (!Number.isFinite(v.feeBps) || v.feeBps <= 0) return 0;
  return v.tvlUsd * v.apy * (v.feeBps / 10_000);
}

export function aggregateCuratorRevenue(rows: VaultForRevenue[]): CuratorRevenueBucket[] {
  const map = new Map<string, CuratorRevenueBucket>();

  for (const r of rows) {
    const key = `${r.attributionLabel}:${r.attributedCuratorId ?? '__none__'}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        curatorId: r.attributedCuratorId,
        label: r.attributionLabel,
        vaultCount: 0,
        tvlUsd: 0,
        revenueAnnualizedUsd: 0,
      };
      map.set(key, bucket);
    }
    bucket.vaultCount += 1;
    bucket.tvlUsd += r.tvlUsd;
    bucket.revenueAnnualizedUsd += vaultRevenueAnnualized(r);
  }

  return [...map.values()].sort((a, b) => b.revenueAnnualizedUsd - a.revenueAnnualizedUsd);
}

// Herfindahl-Hirschman Index over curator revenue shares, scaled to 0..10_000.
// Useful for the "How concentrated is the curator economy?" headline.
// Excludes unattributed/dao buckets from the calculation.
export function curatorRevenueHHI(buckets: CuratorRevenueBucket[]): number {
  const attributed = buckets.filter((b) => b.label === 'curator' && b.curatorId != null);
  const total = attributed.reduce((s, b) => s + b.revenueAnnualizedUsd, 0);
  if (total <= 0) return 0;
  return attributed.reduce((acc, b) => {
    const share = b.revenueAnnualizedUsd / total;
    return acc + share * share * 10_000;
  }, 0);
}

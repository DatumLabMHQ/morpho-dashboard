// "What % of {chain}'s lending market does Morpho hold?"
//
// Denominator is chain_lending_tvl_daily (DefiLlama Lending + CDP sum).
// Numerator is protocol_tvl_daily WHERE protocol_slug='morpho-blue'.
// This module joins them on (chain_slug, snapshot_date).

export interface ChainTvlPoint {
  chainSlug: string;
  snapshotDate: string;          // YYYY-MM-DD
  tvlUsd: number;
}

export interface ShareRow {
  chainSlug: string;
  snapshotDate: string;
  morphoTvlUsd: number;
  lendingTvlUsd: number;
  sharePct: number | null;       // null when denominator is 0 or missing
}

export function computeShareOfChain(
  morpho: ChainTvlPoint[],
  lending: ChainTvlPoint[],
): ShareRow[] {
  const lendingByKey = new Map<string, number>();
  for (const p of lending) {
    lendingByKey.set(`${p.chainSlug}|${p.snapshotDate}`, p.tvlUsd);
  }

  return morpho.map((p) => {
    const denom = lendingByKey.get(`${p.chainSlug}|${p.snapshotDate}`);
    const sharePct = denom != null && denom > 0 ? p.tvlUsd / denom : null;
    return {
      chainSlug: p.chainSlug,
      snapshotDate: p.snapshotDate,
      morphoTvlUsd: p.tvlUsd,
      lendingTvlUsd: denom ?? 0,
      sharePct,
    };
  });
}

// "What share of all chains does each chain represent for Morpho TVL?"
// Useful for the Chains surface to rank chains by Morpho concentration.
export interface ChainShareRow {
  chainSlug: string;
  tvlUsd: number;
  shareOfMorphoPct: number;      // 0..1
}

export function morphoChainConcentration(
  perChain: { chainSlug: string; tvlUsd: number }[],
): ChainShareRow[] {
  const total = perChain.reduce((s, p) => s + p.tvlUsd, 0);
  if (total <= 0) {
    return perChain.map((p) => ({ ...p, shareOfMorphoPct: 0 }));
  }
  return perChain
    .map((p) => ({ ...p, shareOfMorphoPct: p.tvlUsd / total }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);
}

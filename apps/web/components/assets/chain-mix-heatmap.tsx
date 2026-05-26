import type { ChainMixMatrix } from '@/lib/queries/assets';
import { fmtUsd } from '@/lib/format';

interface Props {
  data: ChainMixMatrix;
}

const CATEGORY_LABEL: Record<string, string> = {
  stablecoin: 'Stablecoin',
  lst: 'LST',
  lrt: 'LRT',
  btc: 'BTC',
  eth: 'ETH',
  rwa: 'RWA',
  other: 'Other',
};

// Per-row intensity shading so each chain's row reads as its own mix.
export function ChainMixHeatmap({ data }: Props) {
  const { chains, categories, cells } = data;
  if (chains.length === 0) {
    return <div className="text-small uppercase tracking-header-medium text-text-muted">No data</div>;
  }

  // Lookup: chain × category → usd
  const byKey = new Map<string, number>();
  for (const c of cells) byKey.set(`${c.chainSlug}|${c.category}`, c.supplyUsd);

  // Row max for per-row shading
  const rowMax = new Map<string, number>();
  for (const ch of chains) {
    let max = 0;
    for (const cat of categories) {
      const v = byKey.get(`${ch.slug}|${cat}`) ?? 0;
      if (v > max) max = v;
    }
    rowMax.set(ch.slug, max);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-tiny tabular-nums">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium text-text-muted">Chain</th>
            {categories.map((cat) => (
              <th
                key={cat}
                className="px-3 py-2 text-right uppercase tracking-header-medium text-text-muted"
              >
                {CATEGORY_LABEL[cat] ?? cat}
              </th>
            ))}
            <th className="px-3 py-2 text-right uppercase tracking-header-medium text-text-muted">Total</th>
          </tr>
        </thead>
        <tbody>
          {chains.map((ch) => {
            const max = rowMax.get(ch.slug) ?? 0;
            return (
              <tr key={ch.slug} className="border-t border-border">
                <td className="px-3 py-2 text-left uppercase tracking-header-medium text-text-primary">
                  {ch.name}
                </td>
                {categories.map((cat) => {
                  const v = byKey.get(`${ch.slug}|${cat}`) ?? 0;
                  const intensity = max > 0 ? Math.min(1, v / max) : 0;
                  // Floor of 0.04 so populated cells are visible; cap 0.85 for legibility.
                  const opacity = v > 0 ? Math.max(0.04, Math.min(0.85, intensity)) : 0;
                  const bg = v > 0 ? `rgba(255, 129, 85, ${opacity.toFixed(3)})` : 'transparent';
                  return (
                    <td
                      key={`${ch.slug}|${cat}`}
                      className="px-3 py-2 text-right"
                      style={{ background: bg }}
                      title={v > 0 ? `${ch.name} · ${CATEGORY_LABEL[cat] ?? cat}: ${fmtUsd(v, { compact: true })}` : ''}
                    >
                      {v > 0 ? (
                        <span className={intensity > 0.45 ? 'text-text-primary' : 'text-text-secondary'}>
                          {fmtUsd(v, { compact: true })}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-text-primary">{fmtUsd(ch.totalUsd, { compact: true })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

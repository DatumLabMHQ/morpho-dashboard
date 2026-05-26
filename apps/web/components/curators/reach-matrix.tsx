import type { ReachMatrixCell } from '@/lib/queries/curators';
import { fmtUsd } from '@/lib/format';

interface Props {
  curators: { id: string; name: string }[];
  chains: { slug: string; name: string }[];
  cells: ReachMatrixCell[];
  maxTvl: number;
}

// Heatmap: rows = top curators, columns = top chains. Cell shaded by magnitude.
// Brand accent (#ff8155) at full magnitude, fading to bg with opacity.
export function ReachMatrix({ curators, chains, cells, maxTvl }: Props) {
  const cellMap = new Map<string, ReachMatrixCell>();
  for (const c of cells) cellMap.set(`${c.curatorId}|${c.chainSlug}`, c);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-tiny tabular-nums">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left uppercase tracking-header-medium text-text-muted">Curator</th>
            {chains.map((ch) => (
              <th
                key={ch.slug}
                className="px-3 py-2 text-right uppercase tracking-header-medium text-text-muted"
              >
                {ch.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {curators.map((cur) => (
            <tr key={cur.id} className="border-t border-border">
              <td className="px-3 py-2 text-left uppercase tracking-header-medium text-text-primary">
                {cur.name}
              </td>
              {chains.map((ch) => {
                const c = cellMap.get(`${cur.id}|${ch.slug}`);
                const intensity = c && maxTvl > 0 ? Math.min(1, c.tvlUsd / maxTvl) : 0;
                // Floor of 0.05 so tiny exposures still show; cap at 0.85 to keep
                // text legible on the strongest cells.
                const opacity = c ? Math.max(0.05, Math.min(0.85, intensity)) : 0;
                const bg = c ? `rgba(255, 129, 85, ${opacity.toFixed(3)})` : 'transparent';
                return (
                  <td
                    key={`${cur.id}-${ch.slug}`}
                    className="px-3 py-2 text-right"
                    style={{ background: bg }}
                    title={c ? `${cur.name} on ${ch.name}: ${fmtUsd(c.tvlUsd, { compact: true })}` : ''}
                  >
                    {c ? (
                      <span className={intensity > 0.5 ? 'text-text-primary' : 'text-text-secondary'}>
                        {fmtUsd(c.tvlUsd, { compact: true })}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { CuratorTableRow } from '@/lib/queries/curators';
import { fmtUsd } from '@/lib/format';

type SortKey = 'rank' | 'name' | 'tvl' | 'share' | 'vaults' | 'chains' | 'apy' | 'revenue' | 'delta';
type SortDir = 'asc' | 'desc';

interface Props {
  rows: CuratorTableRow[];
}

export function CuratorTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('tvl');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (x: number | null, y: number | null) =>
      (x ?? -Infinity) === (y ?? -Infinity) ? 0 : (x ?? -Infinity) < (y ?? -Infinity) ? -1 : 1;
    switch (sortKey) {
      case 'rank':    return dir * (a.totalTvlUsd - b.totalTvlUsd) * -1;
      case 'name':    return dir * a.curatorName.localeCompare(b.curatorName);
      case 'tvl':     return dir * cmp(a.totalTvlUsd, b.totalTvlUsd);
      case 'share':   return dir * cmp(a.sharePct, b.sharePct);
      case 'vaults':  return dir * cmp(a.vaultCount, b.vaultCount);
      case 'chains':  return dir * cmp(a.chainCount, b.chainCount);
      case 'apy':     return dir * cmp(a.weightedNetApy, b.weightedNetApy);
      case 'revenue': return dir * cmp(a.estAnnualRevenueUsd, b.estAnnualRevenueUsd);
      case 'delta':   return dir * cmp(a.delta90dPct, b.delta90dPct);
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left">
            <Th label="#"           active={sortKey === 'rank'}    dir={sortDir} onClick={() => toggleSort('rank')} />
            <Th label="Curator"     active={sortKey === 'name'}    dir={sortDir} onClick={() => toggleSort('name')} />
            <Th label="Total TVL"   active={sortKey === 'tvl'}     dir={sortDir} onClick={() => toggleSort('tvl')}    align="right" />
            <Th label="Share"       active={sortKey === 'share'}   dir={sortDir} onClick={() => toggleSort('share')}  align="right" />
            <Th label="Vaults"      active={sortKey === 'vaults'}  dir={sortDir} onClick={() => toggleSort('vaults')} align="right" />
            <Th label="Chains"      active={sortKey === 'chains'}  dir={sortDir} onClick={() => toggleSort('chains')} align="right" />
            <Th label="Net APY"     active={sortKey === 'apy'}     dir={sortDir} onClick={() => toggleSort('apy')}    align="right" />
            <Th label="Est. Rev."   active={sortKey === 'revenue'} dir={sortDir} onClick={() => toggleSort('revenue')} align="right" />
            <Th label="90d Δ"       active={sortKey === 'delta'}   dir={sortDir} onClick={() => toggleSort('delta')}  align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={r.curatorId}
              className="group border-b border-border last:border-0 hover:bg-hover-overlay"
            >
              <td className="py-2.5 px-2 tabular-nums text-text-muted">{i + 1}</td>
              <td className="py-2.5 pr-3">
                <Link
                  href={`/curators/${encodeURIComponent(r.curatorId)}`}
                  className="flex items-center gap-2.5 text-text-primary"
                >
                  {r.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.imageUrl} alt="" width={20} height={20} className="rounded-sm" />
                  ) : (
                    <span className="inline-block size-5 rounded-sm bg-surface-hover" />
                  )}
                  <span className="uppercase tracking-header-medium group-hover:text-accent">
                    {r.curatorName}
                  </span>
                  {r.verified && <span className="text-tiny text-accent">●</span>}
                </Link>
              </td>
              <td className="py-2.5 text-right tabular-nums text-text-primary">{fmtUsd(r.totalTvlUsd, { compact: true })}</td>
              <td className="py-2.5 text-right">
                <div className="ml-auto flex w-28 items-center gap-2">
                  <div className="h-1 flex-1 rounded-sm bg-background">
                    <div
                      className="h-full rounded-sm bg-accent"
                      style={{ width: `${Math.min(100, r.sharePct * 100).toFixed(2)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums text-text-secondary">
                    {(r.sharePct * 100).toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="py-2.5 text-right tabular-nums text-text-secondary">{r.vaultCount}</td>
              <td className="py-2.5 text-right tabular-nums text-text-secondary">{r.chainCount}</td>
              <td className="py-2.5 text-right tabular-nums text-positive">
                {r.weightedNetApy == null ? 'N/A' : `${(r.weightedNetApy * 100).toFixed(2)}%`}
              </td>
              <td className="py-2.5 text-right tabular-nums text-text-primary">
                {fmtUsd(r.estAnnualRevenueUsd, { compact: true })}
              </td>
              <td className="py-2.5 text-right tabular-nums">
                {r.delta90dPct == null ? (
                  <span className="text-text-muted">N/A</span>
                ) : (
                  <span className={r.delta90dPct >= 0 ? 'text-positive' : 'text-negative'}>
                    {r.delta90dPct >= 0 ? '+' : ''}{(r.delta90dPct * 100).toFixed(1)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  label, active, dir, onClick, align,
}: {
  label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'right';
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none pb-2 px-2 text-tiny font-normal uppercase tracking-header-medium ${
        align === 'right' ? 'text-right' : ''
      } ${active ? 'text-text-primary' : 'text-text-muted'} hover:text-text-primary`}
    >
      {label}
      {active && <span className="ml-1 text-text-secondary">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

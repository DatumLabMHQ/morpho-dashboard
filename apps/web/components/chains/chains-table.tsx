'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ChainsTableRow } from '@/lib/queries/chains';
import { fmtUsd } from '@/lib/format';

type SortKey = 'name' | 'morphoTvl' | 'lendingTvl' | 'share' | 'delta';
type SortDir = 'asc' | 'desc';

interface Props {
  rows: ChainsTableRow[];
}

export function ChainsTable({ rows }: Props) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('morphoTvl');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':       return dir * (a.chainName ?? a.chainSlug).localeCompare(b.chainName ?? b.chainSlug);
      case 'morphoTvl':  return dir * (a.morphoTvlUsd - b.morphoTvlUsd);
      case 'lendingTvl': return dir * (a.chainLendingTvlUsd - b.chainLendingTvlUsd);
      case 'share':      return dir * (a.morphoShare - b.morphoShare);
      case 'delta': {
        const ad = a.deltaPp ?? -Infinity;
        const bd = b.deltaPp ?? -Infinity;
        return dir * (ad - bd);
      }
    }
  });

  return (
    <table className="w-full text-body">
      <thead>
        <tr className="border-b border-border text-left">
          <Th label="Chain"             active={sortKey === 'name'}       dir={sortDir} onClick={() => toggleSort('name')}       />
          <Th label="Morpho TVL"        active={sortKey === 'morphoTvl'}  dir={sortDir} onClick={() => toggleSort('morphoTvl')}  align="right" />
          <Th label="Chain Lending TVL" active={sortKey === 'lendingTvl'} dir={sortDir} onClick={() => toggleSort('lendingTvl')} align="right" />
          <Th label="Morpho Share"      active={sortKey === 'share'}      dir={sortDir} onClick={() => toggleSort('share')}      align="right" />
          <Th label="12mo Δ (pp)"       active={sortKey === 'delta'}      dir={sortDir} onClick={() => toggleSort('delta')}      align="right" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr
            key={r.chainSlug}
            className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-hover-overlay"
            onClick={() => router.push(`/chains/${encodeURIComponent(r.chainSlug)}`)}
          >
            <td className="py-2.5 text-text-primary uppercase tracking-header-medium">
              {r.chainName ?? r.chainSlug}
            </td>
            <td className="py-2.5 text-right tabular-nums text-text-primary">
              {fmtUsd(r.morphoTvlUsd, { compact: true })}
            </td>
            <td className="py-2.5 text-right tabular-nums text-text-secondary">
              {fmtUsd(r.chainLendingTvlUsd, { compact: true })}
            </td>
            <td className="py-2.5 text-right tabular-nums text-text-primary">
              {(r.morphoShare * 100).toFixed(1)}%
            </td>
            <td className="py-2.5 text-right tabular-nums">
              {r.deltaPp == null ? (
                <span className="text-text-muted">N/A</span>
              ) : (
                <span className={r.deltaPp >= 0 ? 'text-positive' : 'text-negative'}>
                  {r.deltaPp >= 0 ? '+' : ''}{r.deltaPp.toFixed(1)}
                  <span className="ml-1 text-tiny uppercase tracking-header-medium opacity-70">pp</span>
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
      className={`cursor-pointer select-none pb-2 text-tiny font-normal uppercase tracking-header-medium ${align === 'right' ? 'text-right' : ''} ${
        active ? 'text-text-primary' : 'text-text-muted'
      } hover:text-text-primary`}
    >
      {label}
      {active && <span className="ml-1 text-text-secondary">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

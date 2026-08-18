'use client';

import { useState } from 'react';

import type { TopCollateralRow } from '@/lib/queries/assets';
import { fmtUsd } from '@/lib/format';

type SortKey = 'symbol' | 'class' | 'chains' | 'usd' | 'markets' | 'lltv' | 'util';
type SortDir = 'asc' | 'desc';

interface Props {
  rows: TopCollateralRow[];
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

export function TopCollateralTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('usd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const toggle = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'symbol' || k === 'class' ? 'asc' : 'desc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (x: number | null, y: number | null) =>
      (x ?? -Infinity) === (y ?? -Infinity) ? 0 : (x ?? -Infinity) < (y ?? -Infinity) ? -1 : 1;
    switch (sortKey) {
      case 'symbol':  return dir * a.symbol.localeCompare(b.symbol);
      case 'class':   return dir * a.category.localeCompare(b.category);
      case 'chains':  return dir * cmp(a.chainCount, b.chainCount);
      case 'usd':     return dir * cmp(a.collateralizingUsd, b.collateralizingUsd);
      case 'markets': return dir * cmp(a.marketCount, b.marketCount);
      case 'lltv':    return dir * cmp(a.maxLltvPct, b.maxLltvPct);
      case 'util':    return dir * cmp(a.weightedUtil, b.weightedUtil);
    }
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left">
            <Th label="Symbol"          active={sortKey === 'symbol'}  dir={sortDir} onClick={() => toggle('symbol')} />
            <Th label="Class"           active={sortKey === 'class'}   dir={sortDir} onClick={() => toggle('class')} />
            <Th label="Chains"          active={sortKey === 'chains'}  dir={sortDir} onClick={() => toggle('chains')} align="right" />
            <Th label="Collateralizing" active={sortKey === 'usd'}     dir={sortDir} onClick={() => toggle('usd')}    align="right" />
            <Th label="Markets"         active={sortKey === 'markets'} dir={sortDir} onClick={() => toggle('markets')} align="right" />
            <Th label="Max LLTV"        active={sortKey === 'lltv'}    dir={sortDir} onClick={() => toggle('lltv')}    align="right" />
            <Th label="Wgt Util"        active={sortKey === 'util'}    dir={sortDir} onClick={() => toggle('util')}    align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} className="border-b border-border last:border-0 hover:bg-hover-overlay">
              <td className="py-2.5 px-2 text-text-primary uppercase tracking-header-medium">{r.symbol}</td>
              <td className="py-2.5 px-2 text-text-secondary uppercase tracking-header-medium">
                {CATEGORY_LABEL[r.category] ?? r.category}
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">{r.chainCount}</td>
              <td className="py-2.5 px-2 text-right tabular-nums text-text-primary">{fmtUsd(r.collateralizingUsd, { compact: true })}</td>
              <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">{r.marketCount}</td>
              <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">
                {r.maxLltvPct == null ? 'N/A' : `${(r.maxLltvPct * 100).toFixed(0)}%`}
              </td>
              <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">
                {r.weightedUtil == null ? 'N/A' : `${(r.weightedUtil * 100).toFixed(1)}%`}
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

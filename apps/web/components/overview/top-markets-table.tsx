'use client';

import { useMemo, useState } from 'react';

import { tokens } from '@/lib/brand/tokens';
import { fmtUsd } from '@/lib/format';
import type { TopMarketRow, TopMarketsSort } from '@/lib/queries/overview';

type Period = 'current' | 'week' | 'month' | 'quarter';
type View = 'sector' | 'perChain';

interface Props {
  /** Full market list per period (unsorted, unlimited). The component does
   *  sort + view (top-10 sector / top-5 per-chain) client-side, so all three
   *  toggles are instant and only the period dimension is server-fetched. */
  byPeriod: Record<Period, TopMarketRow[]>;
  chainColorIndex: Record<string, number>;
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
];
const VIEWS: { value: View; label: string }[] = [
  { value: 'sector', label: 'Top 10 Sector' },
  { value: 'perChain', label: 'Top 5 / Chain' },
];
const SORTS: { value: TopMarketsSort; label: string }[] = [
  { value: 'supply', label: 'Supply' },
  { value: 'borrows', label: 'Borrows' },
  { value: 'utilization', label: 'Utilization' },
  { value: 'supplyApy', label: 'Supply APY' },
  { value: 'borrowApy', label: 'Borrow APY' },
  { value: 'liquidity', label: 'Available Liquidity' },
];

const sortValue = (m: TopMarketRow, sortBy: TopMarketsSort): number => {
  switch (sortBy) {
    case 'supply':      return m.supplyUsd;
    case 'borrows':     return m.borrowUsd;
    case 'utilization': return m.utilization ?? -1;
    case 'supplyApy':   return m.supplyApy ?? -1;
    case 'borrowApy':   return m.borrowApy ?? -1;
    case 'liquidity':   return m.liquidityUsd;
  }
};

export function TopMarketsTable({ byPeriod, chainColorIndex }: Props) {
  const [period, setPeriod] = useState<Period>('current');
  const [view, setView] = useState<View>('sector');
  const [sortBy, setSortBy] = useState<TopMarketsSort>('supply');
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo(() => {
    const full = byPeriod[period] ?? byPeriod.current ?? [];
    const sorted = [...full].sort((a, b) => sortValue(b, sortBy) - sortValue(a, sortBy));
    let out: TopMarketRow[];
    if (view === 'perChain') {
      const perChain = new Map<string, TopMarketRow[]>();
      for (const m of sorted) {
        const key = m.chainSlug ?? String(m.chainName ?? '?');
        const arr = perChain.get(key) ?? [];
        if (arr.length < 5) { arr.push(m); perChain.set(key, arr); }
      }
      out = [...perChain.values()].flat();
    } else {
      out = sorted.slice(0, 10);
    }
    return out.map((m, i) => ({ ...m, rank: i + 1 }));
  }, [byPeriod, period, view, sortBy]);

  const maxSupply = useMemo(() => Math.max(1, ...rows.map((r) => r.supplyUsd)), [rows]);

  const copyKey = (key: string) => {
    try {
      navigator.clipboard.writeText(key);
      setToast(`Copied ${key.slice(0, 10)}…`);
      setTimeout(() => setToast(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-tiny">
        <Labeled label="Period"><Segmented options={PERIODS} value={period} onChange={(v) => setPeriod(v as Period)} /></Labeled>
        <Labeled label="View"><Segmented options={VIEWS} value={view} onChange={(v) => setView(v as View)} /></Labeled>
        <Labeled label="Sort by"><Segmented options={SORTS} value={sortBy} onChange={(v) => setSortBy(v as TopMarketsSort)} /></Labeled>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-tiny tabular-nums">
          <thead>
            <tr className="text-left text-text-muted uppercase tracking-header-medium">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Asset</th>
              <th className="px-2 py-2">Chain</th>
              <th className="px-2 py-2 text-right">Total Supply</th>
              <th className="px-2 py-2 text-right">Available Liq.</th>
              <th className="px-2 py-2 text-right">Borrowed</th>
              <th className="px-2 py-2 text-right">Util</th>
              <th className="px-2 py-2 text-right">Supply APY</th>
              <th className="px-2 py-2 text-right">Borrow APY</th>
              <th className="px-2 py-2" style={{ width: 120 }}>Supply</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="py-8 text-center text-text-muted uppercase tracking-header-medium">No markets</td></tr>
            ) : (
              rows.map((m) => {
                const ci = m.chainSlug ? (chainColorIndex[m.chainSlug] ?? 0) : 0;
                const dot = tokens.colors.chart[ci % tokens.colors.chart.length];
                const barPct = Math.max(2, (m.supplyUsd / maxSupply) * 100);
                return (
                  <tr
                    key={m.uniqueKey}
                    onClick={() => copyKey(m.uniqueKey)}
                    className="border-t border-card-border hover:bg-hover-overlay cursor-pointer"
                    title="Click to copy market key"
                  >
                    <td className="px-2 py-2 text-text-muted">{m.rank}</td>
                    <td className="px-2 py-2 uppercase tracking-header-medium text-text-primary">{m.pair}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 uppercase tracking-header-medium text-text-secondary">
                        <span className="inline-block size-2 rounded-sm" style={{ background: dot }} />
                        {m.chainName ?? m.chainSlug ?? '—'}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-text-primary">{fmtUsd(m.supplyUsd, { compact: true })}</td>
                    <td className="px-2 py-2 text-right text-text-secondary">{fmtUsd(m.liquidityUsd, { compact: true })}</td>
                    <td className="px-2 py-2 text-right text-text-secondary">{fmtUsd(m.borrowUsd, { compact: true })}</td>
                    <td className="px-2 py-2 text-right text-text-muted">{m.utilization == null ? '—' : `${(m.utilization * 100).toFixed(1)}%`}</td>
                    <td className="px-2 py-2 text-right text-positive">{m.supplyApy == null ? '—' : `${(m.supplyApy * 100).toFixed(2)}%`}</td>
                    <td className="px-2 py-2 text-right text-text-secondary">{m.borrowApy == null ? '—' : `${(m.borrowApy * 100).toFixed(2)}%`}</td>
                    <td className="px-2 py-2">
                      <span className="block h-2 rounded-sm" style={{ width: `${barPct}%`, background: dot, opacity: 0.7 }} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md border border-border-bright bg-card-bg px-3 py-1.5 text-tiny uppercase tracking-header-medium text-text-primary shadow-elevated">
          {toast}
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-muted uppercase tracking-header-medium">{label}:</span>
      {children}
    </div>
  );
}

interface SegmentedProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}
function Segmented({ options, value, onChange }: SegmentedProps) {
  return (
    <div style={{ display: 'inline-flex', borderRadius: 4, border: '1px solid var(--card-border)', overflow: 'hidden', background: 'var(--background)' }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            padding: '3px 8px', fontSize: 10, fontWeight: 500, cursor: 'pointer', border: 'none',
            fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.05em',
            background: value === o.value ? 'var(--card-border)' : 'transparent',
            color: value === o.value ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

'use client';

import { useState } from 'react';

import type { LendingEfficiencyTable } from '@/lib/queries/overview';

interface Props {
  /** One efficiency table per chain (keyed by chain slug). */
  byChain: Record<string, LendingEfficiencyTable>;
}

const CHAIN_OPTIONS: { value: string; label: string }[] = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'base', label: 'Base' },
  { value: 'arbitrum', label: 'Arbitrum' },
  { value: 'polygon', label: 'Polygon' },
];

const pct = (v: number | null): string => (v == null ? 'N/A' : `${(v * 100).toFixed(2)}%`);

/** Spread cell: green when Morpho beats the sector, red when it trails. */
function SpreadCell({ bps }: { bps: number | null }) {
  if (bps == null) return <span className="text-text-muted">N/A</span>;
  const positive = bps >= 0;
  const color = positive ? 'var(--success)' : 'var(--danger)';
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 tabular-nums"
      style={{ color, background: positive ? 'rgba(46,160,67,0.10)' : 'rgba(220,76,76,0.10)' }}
    >
      {positive ? '+' : '−'}{Math.abs(Math.round(bps))} bps
    </span>
  );
}

export function LendingEfficiencyTable({ byChain }: Props) {
  const available = CHAIN_OPTIONS.filter((c) => byChain[c.value]);
  const [chain, setChain] = useState<string>(available[0]?.value ?? 'ethereum');
  const table = byChain[chain];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-tiny">
        <span className="text-text-muted uppercase tracking-header-medium">Chain:</span>
        <div style={{ display: 'inline-flex', borderRadius: 4, border: '1px solid var(--card-border)', overflow: 'hidden', background: 'var(--background)' }}>
          {available.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setChain(o.value)}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 500, cursor: 'pointer', border: 'none',
                fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.05em',
                background: chain === o.value ? 'var(--card-border)' : 'transparent',
                color: chain === o.value ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {!table ? (
        <div className="py-8 text-center text-text-muted uppercase tracking-header-medium text-tiny">No data</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-tiny tabular-nums">
            <thead>
              <tr className="text-left text-text-muted uppercase tracking-header-medium">
                <th className="px-2 py-2">Asset</th>
                <th className="px-2 py-2 text-right text-accent">Morpho</th>
                {table.competitors.map((c) => (
                  <th key={c.slug} className="px-2 py-2 text-right">{c.name}</th>
                ))}
                <th className="px-2 py-2 text-right">Sector Avg</th>
                <th className="px-2 py-2 text-right">Spread vs Sector</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.asset} className="border-t border-card-border">
                  <td className="px-2 py-2 uppercase tracking-header-medium text-text-primary">{r.asset}</td>
                  <td className="px-2 py-2 text-right text-text-primary font-medium">{pct(r.morphoApy)}</td>
                  {table.competitors.map((c) => (
                    <td key={c.slug} className="px-2 py-2 text-right text-text-secondary">{pct(r.byCompetitor[c.slug] ?? null)}</td>
                  ))}
                  <td className="px-2 py-2 text-right text-text-secondary">{pct(r.sectorAvgApy)}</td>
                  <td className="px-2 py-2 text-right"><SpreadCell bps={r.spreadVsSectorBps} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-tiny text-text-muted">
        Supply APY on Morpho (supply-USD-weighted across markets) vs the lending sector
        (supply-USD-weighted across Aave V3, Compound V3, Fluid, Euler V2). Positive spread = Morpho pays depositors more.
        Competitor columns show &ldquo;. &rdquo; until the competitor-rates backfill runs in prod.
      </p>
    </div>
  );
}

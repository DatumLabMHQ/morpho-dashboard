'use client';

import type { ShareStackSlice } from '@/lib/queries/curators';
import { fmtUsd } from '@/lib/format';

interface Props {
  label: string;
  slices: ShareStackSlice[];
}

// Single horizontal stacked bar. Used twice on the directory: once for
// global ("all chains") share, once for Ethereum-only to surface that
// concentration is often worse per-chain.
export function CuratorShareBar({ label, slices }: Props) {
  const total = slices.reduce((s, x) => s + x.tvlUsd, 0);
  if (total === 0) {
    return (
      <div>
        <div className="text-tiny uppercase tracking-header-medium text-text-muted">{label}</div>
        <div className="mt-1 h-7 rounded-md bg-background border border-border" />
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-tiny uppercase tracking-header-medium text-text-muted">{label}</div>
        <div className="text-tiny uppercase tracking-header-medium text-text-secondary">
          {fmtUsd(total, { compact: true })}
        </div>
      </div>
      <div className="mt-1.5 flex h-7 w-full overflow-hidden rounded-md border border-border bg-background">
        {slices.map((s) => (
          <div
            key={`${label}-${s.curatorId ?? 'others'}`}
            title={`${s.curatorName} · ${fmtUsd(s.tvlUsd, { compact: true })} · ${(s.sharePct * 100).toFixed(1)}%`}
            style={{ background: s.color, width: `${(s.sharePct * 100).toFixed(3)}%` }}
            className="h-full transition-opacity hover:opacity-80"
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {slices.map((s) => (
          <span
            key={`legend-${label}-${s.curatorId ?? 'others'}`}
            className="flex items-center gap-1.5 text-tiny"
          >
            <span className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
            <span
              className={`uppercase tracking-header-medium ${
                s.curatorId == null ? 'text-text-muted' : 'text-text-secondary'
              }`}
            >
              {s.curatorName}
            </span>
            <span className="tabular-nums text-text-muted">{(s.sharePct * 100).toFixed(1)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

// Interactive heatmap primitive shared by the chains matrices. Hovering a cell
// cross-highlights its row + column, dims everything else, outlines the cell,
// and shows a cursor-following tooltip. Pure presentation. Callers compute
// intensities, formatted content, and tooltip nodes.

export interface HeatColumn {
  key: string;
  label: React.ReactNode;
  color?: string;        // optional accent for the column header
}

export interface HeatCell {
  key: string;
  content: React.ReactNode;
  intensity: number | null;   // 0..1 → orange shading; null → blank
  tooltip?: React.ReactNode;
  dimText?: boolean;          // muted text for empty/zero cells
}

export interface HeatRow {
  key: string;
  label: React.ReactNode;
  cells: HeatCell[];
}

function bg(i: number | null): string {
  if (i == null) return 'transparent';
  const v = Math.max(0, Math.min(1, i));
  return `rgba(255, 129, 85, ${0.05 + 0.5 * v})`;
}

export function HeatmapGrid({ cornerLabel, columns, rows }: { cornerLabel: string; columns: HeatColumn[]; rows: HeatRow[] }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const tip = hover ? rows[hover.r]?.cells[hover.c]?.tooltip : null;

  return (
    <div className="overflow-x-auto" onMouseLeave={() => setHover(null)}>
      <table className="w-full text-body" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="text-left">
            <th className="pb-2 pr-3 text-tiny font-normal uppercase tracking-header-medium text-text-muted">{cornerLabel}</th>
            {columns.map((c, ci) => (
              <th
                key={c.key}
                className={`pb-2 px-2 text-right text-tiny font-normal uppercase tracking-header-medium whitespace-nowrap transition-colors ${hover?.c === ci ? 'text-text-primary' : 'text-text-muted'}`}
                style={c.color ? { color: hover?.c === ci ? c.color : undefined } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key} className="border-b border-border last:border-0">
              <td className={`py-1.5 pr-3 uppercase tracking-header-medium whitespace-nowrap transition-colors ${hover?.r === ri ? 'text-text-primary' : 'text-text-secondary'}`}>
                {row.label}
              </td>
              {row.cells.map((cell, ci) => {
                const inCross = hover != null && (hover.r === ri || hover.c === ci);
                const exact = hover?.r === ri && hover?.c === ci;
                return (
                  <td
                    key={cell.key}
                    onMouseEnter={() => setHover({ r: ri, c: ci })}
                    onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
                    className={`px-2 py-1.5 text-right tabular-nums cursor-default transition-[filter,box-shadow] ${cell.dimText ? 'text-text-muted' : 'text-text-primary'} ${exact ? 'shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}
                    style={{ background: bg(cell.intensity), filter: hover != null && !inCross ? 'brightness(0.55)' : undefined }}
                  >
                    {cell.content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tip != null && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border px-3 py-2 text-tiny leading-relaxed"
          style={{
            left: Math.min(pos.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 280),
            top: pos.y + 16,
            maxWidth: 264,
            background: 'var(--tooltip-bg)',
            borderColor: 'var(--card-border)',
            color: 'var(--text-secondary)',
            boxShadow: '0 8px 32px var(--tooltip-shadow)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * ChartCard — uniform shell for every chart on every page.
 *
 * Layout (ported from the LIT chart-card pattern):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ CHART TITLE ⓘ              [W][M][Q]  [⤓][⌄][⛶]            │  header
 *   │ optional subtitle                                            │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │                  <chart body>                                │  body
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  ● Legend 1   ● Legend 2   ● Legend 3                        │  footer (opt)
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Slots:
 *   - title      — uppercase, tracking-[0.1em], font-weight 700, 11px.
 *   - subtitle   — optional one-liner.
 *   - methodology (text + source OR methodologyKey) — ⓘ next to title.
 *   - timeToggle — { selected, onChange, options? } when time-bucketed.
 *   - actions: PNG / copy link / expand — always present.
 *   - footer     — optional ReactNode rendered below the body (legend etc.).
 *   - csvFilename / csvContent — back-compat CSV export button (alongside
 *     PNG). Server-pre-computed string per the existing dashboard pattern.
 */

import { useRef } from 'react';

import { ChartActions } from './chart-actions';
import { MethodologyTooltip } from './methodology-tooltip';
import { TimeToggle, type TimeRange } from './time-toggle';

interface CsvSpec {
  filename: string;
  content: string;
}

interface MethodologyProps {
  /** Look up text/source from content/methodology.json by stable key. */
  methodologyKey?: string;
  /** OR pass the methodology copy inline. */
  text?: string;
  source?: string;
  href?: string;
}

interface TimeToggleSpec {
  selected: TimeRange;
  onChange: (days: TimeRange) => void;
  options?: TimeRange[];
}

interface Props {
  title: string;
  subtitle?: string;
  methodology?: MethodologyProps;
  timeToggle?: TimeToggleSpec;
  /** Optional CSV export (kept for backwards compat with ChartFrame's UX). */
  csv?: CsvSpec;
  /** Optional content below the chart body — legend chips, footnotes, etc. */
  footer?: React.ReactNode;
  /** Optional extra controls in the header (e.g. an inline tab switcher).
   *  Rendered between the time toggle and the actions. */
  rightControls?: React.ReactNode;
  /** The chart itself. */
  children: React.ReactNode;
}

export function ChartCard({
  title,
  subtitle,
  methodology,
  timeToggle,
  footer,
  rightControls,
  children,
}: Props) {
  // Note: `csv` prop is still accepted for back-compat with ChartFrame call
  // sites but no longer rendered — chart actions are limited to screenshot +
  // expand per design.
  const cardRef = useRef<HTMLElement>(null);

  // Stable id used by the watermark / class hook in globals.css.
  return (
    <section
      ref={cardRef}
      className="tui-card relative flex flex-col"
      data-chart-card
    >
      {/* Header */}
      <header
        className="flex flex-wrap items-center justify-between gap-3 border-b border-card-border px-4 py-2"
        style={{ minHeight: 36, background: 'var(--panel-header)' }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2
              className="text-[11px] font-bold uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}
            >
              {title}
            </h2>
            {methodology && (
              <MethodologyTooltip
                methodologyKey={methodology.methodologyKey}
                text={methodology.text}
                source={methodology.source}
                href={methodology.href}
              />
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-tiny text-text-secondary normal-case" style={{ letterSpacing: 'normal' }}>
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {timeToggle && (
            <TimeToggle
              selected={timeToggle.selected}
              onChange={timeToggle.onChange}
              options={timeToggle.options}
            />
          )}
          {rightControls}
          <ChartActions cardRef={cardRef} title={title} />
        </div>
      </header>

      {/* Body */}
      <div className="chart-body flex-1 p-4">{children}</div>

      {/* Optional footer (legend etc.) */}
      {footer && (
        <div className="border-t border-card-border px-4 py-2">{footer}</div>
      )}
    </section>
  );
}


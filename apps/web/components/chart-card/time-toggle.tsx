'use client';

/**
 * TimeToggle — segmented control for switching a chart's time bucket.
 *
 * Default options are W / M / Q (7 / 30 / 90 days) per the spec. Pass
 * custom `options` + `labels` to override (e.g. add 1Y, All-time).
 *
 * Ported from the Lending Intelligence Terminal. `data-chart-export-hide`
 * makes ChartActions hide this control during SVG/PNG export so the
 * exported chart doesn't ship UI chrome.
 */

export type TimeRange = 7 | 30 | 90 | 180 | 365 | 0;
// 0 = All time

interface TimeToggleProps {
  selected: TimeRange;
  onChange: (days: TimeRange) => void;
  options?: TimeRange[];
  labels?: Partial<Record<TimeRange, string>>;
}

const DEFAULT_LABELS: Record<TimeRange, string> = {
  7: 'W',
  30: 'M',
  90: 'Q',
  180: '6M',
  365: '1Y',
  0: 'ALL',
};

export function TimeToggle({
  selected,
  onChange,
  options = [7, 30, 90],
  labels,
}: TimeToggleProps) {
  const getLabel = (opt: TimeRange) => labels?.[opt] ?? DEFAULT_LABELS[opt];
  return (
    <div
      data-chart-export-hide="time-toggle"
      style={{
        display: 'inline-flex',
        borderRadius: '4px',
        border: '1px solid var(--card-border)',
        overflow: 'hidden',
        backgroundColor: 'var(--background)',
      }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          style={{
            padding: '3px 9px',
            fontSize: '10px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            fontFamily: 'inherit',
            backgroundColor: selected === opt ? 'var(--card-border)' : 'transparent',
            color: selected === opt ? 'var(--text-primary)' : 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {getLabel(opt)}
        </button>
      ))}
    </div>
  );
}

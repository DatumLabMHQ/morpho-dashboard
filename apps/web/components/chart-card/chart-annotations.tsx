'use client';

/**
 * ChartAnnotations — drop-in <ReferenceLine> overlay for Recharts time-series.
 *
 * Each annotation renders as a dashed vertical line at its bucketed
 * timestamp, with a short label rendered above the chart. Used for marking
 * governance votes, oracle changes, depegs, etc.
 *
 * Usage:
 *
 *   const events = useAnnotations('overview-protocol-tvl');
 *   ...
 *   <LineChart data={...}>
 *     ...axes / lines...
 *     <ChartAnnotations events={events} xKey="date" />
 *   </LineChart>
 *
 * `xKey` is the date field on each data point — the annotation x is mapped
 * to the same shape (ISO date string by default; pass `unix` if data uses
 * unix-seconds numbers).
 *
 * NOTE: must be rendered inside a Recharts chart component (LineChart /
 *   AreaChart / ComposedChart). The component returns multiple ReferenceLines
 *   in a fragment.
 */

import { ReferenceLine } from 'recharts';

import type { ChartAnnotation } from '@/lib/annotations';

interface Props {
  events: ChartAnnotation[];
  /** How to format the x value to match the chart's data points.
   *   - 'iso-date'  → YYYY-MM-DD string (the default for our charts)
   *   - 'iso-full'  → full ISO timestamp
   *   - 'unix'      → unix seconds (number)
   *   - 'unix-ms'   → unix milliseconds (number) */
  xFormat?: 'iso-date' | 'iso-full' | 'unix' | 'unix-ms';
}

function formatX(ts: number, fmt: NonNullable<Props['xFormat']>): string | number {
  switch (fmt) {
    case 'unix':    return ts;
    case 'unix-ms': return ts * 1000;
    case 'iso-full': return new Date(ts * 1000).toISOString();
    case 'iso-date':
    default:
      return new Date(ts * 1000).toISOString().slice(0, 10);
  }
}

export function ChartAnnotations({ events, xFormat = 'iso-date' }: Props) {
  if (!events || events.length === 0) return null;
  return (
    <>
      {events.map((evt) => {
        const x = formatX(evt.timestamp, xFormat);
        return (
          <ReferenceLine
            key={evt.id}
            x={x}
            stroke="var(--accent)"
            strokeDasharray="3 3"
            strokeWidth={1}
            strokeOpacity={0.7}
            ifOverflow="extendDomain"
            label={{
              value: evt.label,
              position: 'top',
              fontSize: 9,
              fill: 'var(--accent)',
              dy: -2,
            }}
          />
        );
      })}
    </>
  );
}

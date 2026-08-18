/**
 * Chart annotations. Single source of truth for the dated events
 * (governance votes, depegs, oracle / parameter changes) that time-series
 * charts call out as dashed vertical reference lines.
 *
 * Authored in `content/annotations.json` as a flat list. Each event tags
 * which charts it belongs on via `chartKeys`; consumers filter by their own
 * key. Adding a new event: drop an entry into the JSON with the right
 * chartKeys, the chart picks it up automatically.
 *
 * Usage (in a client chart component):
 *
 *   import { useAnnotations } from '@/lib/annotations';
 *   import { ChartAnnotations } from '@/components/chart-card/chart-annotations';
 *   const events = useAnnotations('overview-protocol-tvl');
 *   ...
 *   <LineChart>
 *     ...axes / lines...
 *     <ChartAnnotations events={events} xKey="date" />
 *   </LineChart>
 */

import annotationsJson from '@/content/annotations.json';

export interface ChartAnnotation {
  /** Stable id. Used as React key + URL fragment for sharing. Lowercase kebab. */
  id: string;
  /** Unix seconds. */
  timestamp: number;
  /** Short label rendered next to the line. ~3-5 words. */
  label: string;
  /** Optional longer description. */
  description?: string;
  /** Which charts this event belongs on. Stable keys mirror methodologyKey. */
  chartKeys: string[];
}

interface AnnotationsFile {
  _comment?: string;
  events: ChartAnnotation[];
}

const file = annotationsJson as unknown as AnnotationsFile;

/** Pure helper. For SSR / non-React callers. */
export function getAnnotations(chartKey: string): ChartAnnotation[] {
  return (file.events ?? [])
    .filter((e) => e.chartKeys.includes(chartKey))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Hook variant for client components. The JSON is bundled at build time so
 *  identity is naturally stable across renders. */
export function useAnnotations(chartKey: string): ChartAnnotation[] {
  return getAnnotations(chartKey);
}

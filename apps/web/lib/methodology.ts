/**
 * Methodology config. Single source of truth for chart + KPI definitions.
 *
 * Source of truth lives in `content/methodology.json`. Each chart's
 * `<MethodologyTooltip>` either passes `methodologyKey` (looked up here) or
 * inline `text` / `source`. Adding a new chart? Drop an entry into the JSON
 * and pass the key. No code change needed.
 *
 * Loaded via a static JSON import so it ships to the client as a JS object
 * (no fs / API roundtrip).
 */

import raw from '@/content/methodology.json';

export interface MethodologyEntry {
  /** Plain-language definition + how it's computed. 1-3 sentences. */
  text: string;
  /** Where the underlying numbers come from. */
  source?: string;
  /** Optional deeper-dive URL. */
  href?: string;
}

// The JSON has a leading `_comment` field for human readers; strip those.
const ENTRIES: Record<string, MethodologyEntry> = Object.fromEntries(
  Object.entries(raw as Record<string, unknown>).filter(([k]) => !k.startsWith('_')),
) as Record<string, MethodologyEntry>;

export const METHODOLOGY: Record<string, MethodologyEntry> = ENTRIES;

export function getMethodology(key: string | undefined): MethodologyEntry | null {
  if (!key) return null;
  return METHODOLOGY[key] ?? null;
}

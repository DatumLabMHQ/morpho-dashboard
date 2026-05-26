/**
 * Methodology config — single source of truth for chart + KPI definitions.
 *
 * Each chart's <MethodologyTooltip> can either receive `text` / `source`
 * inline OR pass a stable `methodologyKey` that's looked up here. Phase 3
 * wires the entries up from `content/methodology.json`; Phase 2 ships an
 * empty registry so the tooltip degrades to inline-props-only.
 */

export interface MethodologyEntry {
  /** Plain-language definition + how it's computed. 1-3 sentences. */
  text: string;
  /** Where the underlying numbers come from. */
  source?: string;
  /** Optional deeper-dive URL. */
  href?: string;
}

// Phase 3 will populate this from content/methodology.json. For now, the
// registry is empty — MethodologyTooltip falls back to its inline props.
export const METHODOLOGY: Record<string, MethodologyEntry> = {};

export function getMethodology(key: string | undefined): MethodologyEntry | null {
  if (!key) return null;
  return METHODOLOGY[key] ?? null;
}

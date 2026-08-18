/**
 * Lending-sector comparison set.
 *
 * Defined once here so every comparison surface in the dashboard reads the
 * same protocol universe: Overview's sector chart, /rates spread context,
 * /chains per-chain stacks, etc.
 *
 * `slug` matches the DefiLlama protocol slug exactly (it's what the worker
 * uses to fetch /protocol/<slug>). `brand` is the brand family. Aave V2 and
 * Aave V3 share `aave` so the comparison chart can group them when the
 * "Collapse legacy versions" toggle is on. `legacy: true` means superseded
 * by a current version under the same brand.
 *
 * Adding a new protocol? Append to the right bucket and also push the slug
 * into `apps/worker/src/jobs/defillama-tvl.ts` `COMPARATOR_SLUGS` so the
 * worker pulls its TVL history. The two lists are intentionally separate
 * (worker needs to ship without web-app deps) but they MUST stay in sync.
 */

export interface ProtocolMeta {
  slug: string;
  label: string;
  brand: string;
  legacy: boolean;
}

export const LENDING_PROTOCOLS = {
  overcollateralized: [
    { slug: 'aave-v3',       label: 'Aave V3',       brand: 'aave',     legacy: false },
    { slug: 'aave-v2',       label: 'Aave V2',       brand: 'aave',     legacy: true  },
    { slug: 'sparklend',     label: 'SparkLend',     brand: 'spark',    legacy: false },
    { slug: 'morpho-blue',   label: 'Morpho',        brand: 'morpho',   legacy: false },
    { slug: 'compound-v3',   label: 'Compound V3',   brand: 'compound', legacy: false },
    { slug: 'compound-v2',   label: 'Compound V2',   brand: 'compound', legacy: true  },
    { slug: 'fluid-lending', label: 'Fluid',         brand: 'fluid',    legacy: false },
    { slug: 'euler-v2',      label: 'Euler V2',      brand: 'euler',    legacy: false },
    { slug: 'moonwell-lending', label: 'Moonwell',   brand: 'moonwell', legacy: false },
  ] as const satisfies readonly ProtocolMeta[],
  cdp: [
    { slug: 'sky-lending', label: 'Sky',        brand: 'sky',     legacy: false },
    { slug: 'liquity-v1',  label: 'Liquity V1', brand: 'liquity', legacy: true  },
    { slug: 'liquity-v2',  label: 'Liquity V2', brand: 'liquity', legacy: false },
  ] as const satisfies readonly ProtocolMeta[],
} as const;

// Flat list of every slug. Convenient for filter predicates.
export const ALL_LENDING_SLUGS: readonly string[] = [
  ...LENDING_PROTOCOLS.overcollateralized.map((p) => p.slug),
  ...LENDING_PROTOCOLS.cdp.map((p) => p.slug),
];

// Brand → hex. Two shades per brand so v2+v3 can share a hue but stay
// distinguishable. Aligned with the chart palette in lib/brand/tokens.ts.
export const BRAND_COLORS: Record<string, { primary: string; legacy: string }> = {
  morpho:   { primary: '#FF8155', legacy: '#FFA585' }, // brand orange (subject)
  aave:     { primary: '#B97AFF', legacy: '#D5B0FF' }, // purple
  spark:    { primary: '#FBBF24', legacy: '#FDD877' }, // yellow
  compound: { primary: '#34D399', legacy: '#7BE8C2' }, // green
  fluid:    { primary: '#38BDF8', legacy: '#7AD8FA' }, // cyan
  euler:    { primary: '#6B85FF', legacy: '#A5B4FF' }, // blue
  moonwell: { primary: '#F472B6', legacy: '#FAA5D2' }, // magenta-pink
  sky:      { primary: '#FB7185', legacy: '#FDA4AF' }, // rose
  liquity:  { primary: '#818CF8', legacy: '#ABB4FA' }, // indigo
};

/**
 * Collapse v2+v3 within a brand. Aggregates by `brand`, picks the non-legacy
 * label as the display name. Used when the "Collapse legacy versions" toggle
 * is on in the protocol comparison chart.
 */
export function collapseByBrand(
  protocols: readonly ProtocolMeta[],
): { brand: string; label: string; slugs: string[] }[] {
  const byBrand = new Map<string, { label: string; slugs: string[] }>();
  for (const p of protocols) {
    const cur = byBrand.get(p.brand);
    if (!cur) {
      byBrand.set(p.brand, { label: p.legacy ? `${labelBrand(p.brand)} (all)` : p.label, slugs: [p.slug] });
    } else {
      cur.slugs.push(p.slug);
      // If the existing label was the legacy fallback and we just saw a
      // non-legacy entry, prefer that as the display name.
      if (!p.legacy && cur.label.endsWith(' (all)')) cur.label = `${labelBrand(p.brand)} (all)`;
    }
  }
  return [...byBrand.entries()].map(([brand, v]) => ({ brand, label: v.label, slugs: v.slugs }));
}

function labelBrand(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/**
 * PageProvenance — convenience wrapper that renders the standard footer
 * block for every page: optional methodology card, then citation block,
 * then "data as of X · source: Y" line.
 *
 * Pages can either use this composite or compose the three primitives
 * directly. Most pages should just use this.
 */

import { AsOfFooter } from './as-of-footer';
import { CiteThisPage } from './cite-this-page';
import { MethodologyCard } from './methodology-card';

export { AsOfFooter } from './as-of-footer';
export { CiteThisPage } from './cite-this-page';
export { MethodologyCard } from './methodology-card';

interface Props {
  /** Page title (citation + tooltips). */
  pageTitle: string;
  /** Canonical URL. */
  pageUrl: string;
  /** Data-fetched timestamp (ISO / unix s / Date). */
  fetchedAt: string | number | Date;
  /** Data source attribution for the as-of line. */
  source: string;
  /** Optional methodology copy. Omit to skip the methodology card. */
  methodology?: { text: string; source?: string; href?: string };
  /** Optional extra one-liner on the as-of row. */
  asOfNote?: string;
}

export function PageProvenance({
  pageTitle,
  pageUrl,
  fetchedAt,
  source,
  methodology,
  asOfNote,
}: Props) {
  return (
    <div className="space-y-4">
      {methodology && (
        <MethodologyCard
          text={methodology.text}
          source={methodology.source}
          learnMoreHref={methodology.href}
        />
      )}
      <CiteThisPage pageTitle={pageTitle} pageUrl={pageUrl} />
      <AsOfFooter fetchedAt={fetchedAt} source={source} note={asOfNote} />
    </div>
  );
}

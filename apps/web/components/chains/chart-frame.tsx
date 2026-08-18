'use client';

/**
 * ChartFrame. Kept as a thin backwards-compat shim around the new ChartCard.
 *
 * Existing pages built before the Phase 2 chart-shell port use this name with
 * an older prop shape (title, subtitle, csvFilename, csvContent, pngFilename,
 * rightControls). Rather than rewriting every chart on every page, this shim
 * maps those props onto ChartCard so all the new behavior (methodology
 * tooltip support, PNG/copy/expand actions, future time toggle, future
 * annotation overlay) lights up without per-page churn.
 *
 * New code should prefer `<ChartCard>` directly from `@/components/chart-card`.
 */

import { ChartCard } from '@/components/chart-card';

interface Props {
  title: string;
  subtitle?: string;
  /** Optional DOM id for deep-linking to this chart (e.g. `#active-loans-share`). */
  anchorId?: string;
  csvFilename: string;
  /** Pre-computed CSV string (server-side). */
  csvContent: string;
  /** Ignored. PNG filename is now derived from the title. Accepted to keep
   *  the prop type compatible with older call sites. */
  pngFilename?: string;
  children: React.ReactNode;
  /** Optional right-side controls (e.g. an inline tab switcher). */
  rightControls?: React.ReactNode;
  /** Optional methodology copy. Either pass `methodologyKey` (looked up in
   *  content/methodology.json. Phase 3) or inline `text` / `source`. */
  methodologyKey?: string;
  methodologyText?: string;
  methodologySource?: string;
}

export function ChartFrame({
  title,
  subtitle,
  anchorId,
  csvFilename,
  csvContent,
  // pngFilename intentionally unused. Kept in the type for back-compat.
  children,
  rightControls,
  methodologyKey,
  methodologyText,
  methodologySource,
}: Props) {
  const methodology =
    methodologyKey || methodologyText
      ? { methodologyKey, text: methodologyText, source: methodologySource }
      : undefined;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      anchorId={anchorId}
      methodology={methodology}
      csv={{ filename: csvFilename, content: csvContent }}
      rightControls={rightControls}
    >
      {children}
    </ChartCard>
  );
}

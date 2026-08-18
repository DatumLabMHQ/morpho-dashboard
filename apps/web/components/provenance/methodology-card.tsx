/**
 * MethodologyCard. Full-width footer card explaining a page's methodology
 * in 1-3 paragraphs. Used on pages where chart-level ⓘ tooltips aren't
 * enough (e.g. /rates and /curators where there's cross-chart context).
 *
 * Server component; no interactivity beyond optional `learnMoreHref`.
 */

interface Props {
  /** One paragraph of plain-text methodology (sentences separated by `\n`
   *  render as separate paragraphs). */
  text: string;
  /** Optional one-line source attribution shown beneath the body. */
  source?: string;
  /** Optional methodology deep-link. */
  learnMoreHref?: string;
}

export function MethodologyCard({ text, source, learnMoreHref }: Props) {
  const paragraphs = text.split('\n').filter((p) => p.trim().length > 0);
  return (
    <div className="tui-card bg-card-bg border border-card-border rounded p-4 flex flex-col gap-2">
      <div
        className="text-tiny uppercase font-bold"
        style={{ letterSpacing: '0.1em', color: 'var(--accent)' }}
      >
        Methodology
      </div>
      <div
        className="text-small font-mono text-text-secondary normal-case flex flex-col gap-2"
        style={{ letterSpacing: 'normal', lineHeight: 1.55 }}
      >
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {(source || learnMoreHref) && (
        <div
          className="text-tiny uppercase text-text-muted"
          style={{ letterSpacing: '0.08em' }}
        >
          {source && (
            <>
              <span className="text-text-muted/70">Source:</span>{' '}
              <span className="text-text-secondary normal-case" style={{ letterSpacing: 'normal' }}>
                {source}
              </span>
            </>
          )}
          {learnMoreHref && (
            <>
              {source && <span className="mx-2 text-text-muted/50">·</span>}
              <a
                href={learnMoreHref}
                target="_blank"
                rel="noreferrer"
                className="normal-case"
                style={{ color: 'var(--accent)', letterSpacing: 'normal' }}
              >
                Methodology details ↗
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

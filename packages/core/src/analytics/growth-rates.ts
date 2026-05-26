// Headline growth helpers. Used for the "grew Nx in 12 months" style claims.
// Dates are ISO YYYY-MM-DD strings parsed as UTC to avoid TZ drift.

export interface TimeseriesPoint {
  date: string;             // YYYY-MM-DD
  value: number;
}

const MS_PER_DAY = 86_400_000;

// ratio = latest / earliest. Returns Infinity when earliest is 0 and latest > 0.
export function growthMultiple(earliest: number, latest: number): number {
  if (earliest === 0) return latest === 0 ? 1 : Infinity;
  return latest / earliest;
}

// (latest - earliest) / earliest. e.g. 2.4 = +240%.
export function pctChange(earliest: number, latest: number): number {
  if (earliest === 0) return latest === 0 ? 0 : Infinity;
  return (latest - earliest) / earliest;
}

// Compound annual growth rate over `days`. Returns NaN if inputs are degenerate.
export function cagr(earliest: number, latest: number, days: number): number {
  if (earliest <= 0 || days <= 0 || latest < 0) return Number.NaN;
  const years = days / 365.25;
  return Math.pow(latest / earliest, 1 / years) - 1;
}

export interface GrowthWindow {
  from: TimeseriesPoint;
  to: TimeseriesPoint;
  windowDays: number;       // actual days between from.date and to.date
  multiple: number;
  pct: number;
  cagr: number;
}

// Growth between the first point at-or-after (asOf - windowDays) and the
// latest point at-or-before asOf. asOf defaults to the series' last date.
// Returns null when the series doesn't have ≥2 points spanning the window.
export function growthOverWindow(
  series: TimeseriesPoint[],
  windowDays: number,
  asOf?: string,
): GrowthWindow | null {
  if (series.length < 2) return null;

  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const asOfMs = Date.parse(asOf ?? sorted[sorted.length - 1]!.date);
  const cutoffMs = asOfMs - windowDays * MS_PER_DAY;

  let to: TimeseriesPoint | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (Date.parse(sorted[i]!.date) <= asOfMs) {
      to = sorted[i]!;
      break;
    }
  }
  if (!to) return null;

  const from = sorted.find((p) => Date.parse(p.date) >= cutoffMs);
  if (!from || from.date === to.date) return null;

  const actualDays = (Date.parse(to.date) - Date.parse(from.date)) / MS_PER_DAY;
  return {
    from,
    to,
    windowDays: actualDays,
    multiple: growthMultiple(from.value, to.value),
    pct: pctChange(from.value, to.value),
    cagr: cagr(from.value, to.value, actualDays),
  };
}

// Convenience: rank a list of (key, series) by their N-day growth multiple.
// Used for "fastest growing X" tables on the dashboard.
export interface RankedGrowth<K> {
  key: K;
  window: GrowthWindow;
}

export function rankByGrowth<K>(
  series: { key: K; points: TimeseriesPoint[] }[],
  windowDays: number,
  minStartValueUsd = 0,
): RankedGrowth<K>[] {
  const ranked: RankedGrowth<K>[] = [];
  for (const s of series) {
    const w = growthOverWindow(s.points, windowDays);
    if (!w) continue;
    if (w.from.value < minStartValueUsd) continue;
    if (!Number.isFinite(w.multiple)) continue;
    ranked.push({ key: s.key, window: w });
  }
  return ranked.sort((a, b) => b.window.multiple - a.window.multiple);
}

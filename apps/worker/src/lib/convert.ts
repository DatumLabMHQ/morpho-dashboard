import type { BigIntLike } from '@morpho-dashboard/core';

// BigInt → string for NUMERIC(78,0) columns. Postgres parses numeric strings
// without precision loss; sending as JS number would corrupt > 2^53.
export function bigIntToText(v: BigIntLike | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

// Unix seconds (BigInt-ish) → ISO timestamp. Returns null for invalid.
export function unixToIso(v: BigIntLike | null | undefined): string | null {
  if (v == null) return null;
  const seconds = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

// LLTV is uint256 scaled by 1e18 (e.g. "770000000000000000" = 0.77).
// Convert to a decimal string suitable for NUMERIC(38,18).
export function lltvToDecimal(v: BigIntLike | null | undefined): string | null {
  if (v == null) return null;
  try {
    const big = BigInt(typeof v === 'string' ? v : Math.trunc(v));
    const SCALE = 10n ** 18n;
    const whole = big / SCALE;
    const frac = (big % SCALE).toString().padStart(18, '0');
    return `${whole}.${frac}`;
  } catch {
    return null;
  }
}

// Today's date in UTC as YYYY-MM-DD for snapshot_date columns.
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Unix seconds → YYYY-MM-DD (UTC). Used by DefiLlama historical points.
export function unixToDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Normalize an EVM address to lowercase. Returns null for null input.
export function lc(addr: string | null | undefined): string | null {
  return addr ? addr.toLowerCase() : null;
}

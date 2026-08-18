// Display formatters for the dashboard. All accept null/undefined and return 'N/A'.

export function fmtUsd(
  value: number | null | undefined,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  if (options.compact) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: options.decimals ?? 2,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: options.decimals ?? 0,
  }).format(value);
}

export function fmtNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US').format(value);
}

export function fmtPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function fmtMultiple(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(decimals)}x`;
}

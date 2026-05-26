// Shared HTTP helpers — Web-API compatible (works in Node 18+ and Cloudflare Workers).

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private readonly maxPerSecond: number) {}

  async wait(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.maxPerSecond) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0]!;
      const delay = 1000 - (now - oldest) + 1;
      await sleep(delay);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  // Optional pre-flight hook (e.g. rate-limit wait).
  before?: () => Promise<void> | void;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const { retries = 3, baseDelayMs = 500, before } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (before) await before();
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await sleep(baseDelayMs * 2 ** attempt);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`fetchWithRetry exhausted for ${url}`);
}

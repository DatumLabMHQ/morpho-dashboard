import { RateLimiter, fetchWithRetry } from './http.js';

export const DEFILLAMA_BASE = 'https://api.llama.fi';
export const DEFILLAMA_YIELDS = 'https://yields.llama.fi';

// ---------- Response types (subset; expand as queries land) ----------

export interface LlamaProtocolSummary {
  id: string;
  name: string;
  slug: string;
  category: string | null;          // 'Lending', 'CDP', 'Liquid Staking', etc.
  tvl: number | null;
  chainTvls: Record<string, number> | null;
  chains: string[];
  symbol: string | null;
  url: string | null;
}

// /protocol/{slug} returns this larger shape.
export interface LlamaProtocolDetail {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  chains: string[];
  // Per-chain history. Each entry is { date: unix_seconds, totalLiquidityUSD: number }.
  chainTvls: Record<
    string,
    {
      tvl: { date: number; totalLiquidityUSD: number }[];
      tokens?: unknown;
      tokensInUsd?: unknown;
    }
  >;
  // Aggregate (all-chain) TVL history.
  tvl: { date: number; totalLiquidityUSD: number }[];
}

export interface LlamaFeesSummary {
  id: string;
  name: string;
  slug: string;
  totalDataChart: [number, number][];           // [unix_seconds, value][]
  total24h: number | null;
  total7d: number | null;
  totalAllTime: number | null;
}

export interface LlamaYieldPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  underlyingTokens: string[] | null;
  // Lending pools also carry current borrow-side rates and supply/borrow USD
  // on the /pools list (not only on the per-pool /chart). Reading these avoids
  // a per-pool chart fetch (which blows the Worker subrequest cap).
  apyBaseBorrow?: number | null;
  apyRewardBorrow?: number | null;
  totalSupplyUsd?: number | null;
  totalBorrowUsd?: number | null;
}

export interface LlamaYieldPoolsResponse {
  status: string;
  data: LlamaYieldPool[];
}

// /chart/{poolId} response — historical daily series for one pool.
// apyBaseBorrow / totalSupplyUsd / totalBorrowUsd populate on lending pools.
export interface LlamaYieldChartPoint {
  timestamp: string;            // ISO8601 ("2024-01-01T23:00:00.000Z")
  tvlUsd: number | null;
  apy: number | null;           // base + reward (supply side)
  apyBase: number | null;
  apyReward: number | null;
  apyBaseBorrow?: number | null;
  apyRewardBorrow?: number | null;
  totalSupplyUsd?: number | null;
  totalBorrowUsd?: number | null;
}

export interface LlamaYieldChartResponse {
  status: string;
  data: LlamaYieldChartPoint[];
}

// ---------- Client ----------

export interface DefiLlamaClientOptions {
  // Defaults to 5 req/s per user's spec. DefiLlama is generally lax but we
  // throttle to be polite and to stay under the Worker subrequest cap.
  maxPerSecond?: number;
}

export class DefiLlamaClient {
  private readonly limiter: RateLimiter;

  constructor(opts: DefiLlamaClientOptions = {}) {
    this.limiter = new RateLimiter(opts.maxPerSecond ?? 5);
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetchWithRetry(url, undefined, { before: () => this.limiter.wait() });
    if (!res.ok) {
      throw new Error(`DefiLlama HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  }

  // GET /protocols  — full protocol list. Filter to category='Lending' or 'CDP' upstream.
  async protocols(): Promise<LlamaProtocolSummary[]> {
    return this.get<LlamaProtocolSummary[]>(`${DEFILLAMA_BASE}/protocols`);
  }

  // GET /protocol/{slug} — per-chain TVL history. Heavy payload; gate via the
  // >1% delta check in defillama_protocols_snapshot before calling.
  async protocol(slug: string): Promise<LlamaProtocolDetail> {
    return this.get<LlamaProtocolDetail>(`${DEFILLAMA_BASE}/protocol/${slug}`);
  }

  // GET /summary/fees/{slug}?dataType=dailyFees
  // Note: the API path is /summary/fees/{slug}, not /overview/fees/{slug}.
  // The latter returns 500 for individual slugs; it's only valid without a slug.
  async feesSummary(
    slug: string,
    dataType: 'dailyFees' | 'dailyRevenue' = 'dailyFees',
  ): Promise<LlamaFeesSummary> {
    return this.get<LlamaFeesSummary>(
      `${DEFILLAMA_BASE}/summary/fees/${slug}?dataType=${dataType}`,
    );
  }

  // GET https://yields.llama.fi/pools — all yield pools across DeFi.
  async yieldPools(): Promise<LlamaYieldPool[]> {
    const body = await this.get<LlamaYieldPoolsResponse>(`${DEFILLAMA_YIELDS}/pools`);
    return body.data;
  }

  // GET https://yields.llama.fi/chart/{poolId} — historical daily series for
  // a single yield pool. Used by the aave-rates job to backfill supply/borrow
  // APY history per (chain, asset) pair.
  async yieldChart(poolId: string): Promise<LlamaYieldChartPoint[]> {
    const body = await this.get<LlamaYieldChartResponse>(
      `${DEFILLAMA_YIELDS}/chart/${poolId}`,
    );
    return body.data;
  }
}

// ---------- Helpers ----------

export const LENDING_CATEGORIES = new Set(['Lending', 'CDP']);

export function isLendingProtocol(p: Pick<LlamaProtocolSummary, 'category'>): boolean {
  return p.category != null && LENDING_CATEGORIES.has(p.category);
}

// Keys that appear in /protocol/{slug}.chainTvls but aren't real chains —
// DefiLlama uses these for aggregate views.
const NON_CHAIN_CHAINTVL_KEYS = new Set([
  'borrowed', 'staking', 'pool2', 'treasury', 'offers', 'vesting',
]);

// True iff a chainTvls key represents a per-chain TVL series (not an aggregate
// like "borrowed" or a suffixed variant like "Optimism-borrowed").
export function isRealChainKey(key: string): boolean {
  if (key.includes('-')) return false;          // "Optimism-borrowed", "Ethereum-staking", ...
  if (NON_CHAIN_CHAINTVL_KEYS.has(key)) return false;
  return true;
}

// Determines whether to refetch a protocol's history given its prior cached TVL
// and the current top-level TVL from /protocols. >1% delta = refetch.
//
// Null handling:
//   * currentTvl null     → don't refetch (no new data to compare against;
//     refetching would loop forever for protocols whose /protocols summary
//     omits TVL but /protocol/{slug} returns data)
//   * cachedTvl null      → refetch (first time seeing this protocol with data)
//   * cachedTvl 0         → refetch iff currentTvl is non-zero
export function shouldRefetchProtocol(
  cachedTvl: number | null,
  currentTvl: number | null,
  threshold = 0.01,
): boolean {
  if (currentTvl == null) return false;
  if (cachedTvl == null) return true;
  if (cachedTvl === 0) return currentTvl !== 0;
  return Math.abs(currentTvl - cachedTvl) / cachedTvl > threshold;
}

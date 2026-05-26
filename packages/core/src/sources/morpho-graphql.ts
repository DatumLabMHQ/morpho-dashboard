import { fetchWithRetry } from './http.js';

export const MORPHO_GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';

// Morpho's GraphQL serializes BigInt scalars as strings for large values and as
// JSON numbers for small ones (observed: `badDebt.underlying: 0`). Use this union
// at the type boundary; normalize to string/bigint at the call site.
export type BigIntLike = string | number;

// ---------- Response types (subset; expand as queries land) ----------

export interface MorphoChain {
  id: number;
  network: string;
  currency: string;
  blockTimeMs: number | null;
}

export interface MorphoAsset {
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  logoURI?: string | null;
  chain?: { id: number };
}

export interface MorphoMarketBadDebt {
  underlying: BigIntLike;
  usd: number | null;
}

export interface MorphoMarketState {
  borrowAssets: BigIntLike;
  supplyAssets: BigIntLike;
  borrowAssetsUsd: number | null;
  supplyAssetsUsd: number | null;
  collateralAssets: BigIntLike | null;
  collateralAssetsUsd: number | null;
  liquidityAssets: BigIntLike;
  liquidityAssetsUsd: number | null;
  utilization: number;
  supplyApy: number;
  borrowApy: number;
  netSupplyApy: number | null;
  netBorrowApy: number | null;
  fee: number;
  price: BigIntLike | null;
  timestamp: BigIntLike;
}

export interface MorphoMarket {
  marketId: string;
  lltv: BigIntLike;
  irmAddress: string;
  creationTimestamp: BigIntLike;
  listed: boolean;
  chain: { id: number };
  loanAsset: MorphoAsset;
  collateralAsset: MorphoAsset | null;
  state: MorphoMarketState | null;
  badDebt: MorphoMarketBadDebt | null;
  realizedBadDebt: MorphoMarketBadDebt | null;
}

export interface MorphoVaultAllocation {
  supplyAssets: BigIntLike;
  supplyAssetsUsd: number | null;
  supplyCap: BigIntLike;
  supplyCapUsd: number | null;
  supplyQueueIndex: number | null;
  withdrawQueueIndex: number | null;
  market: { marketId: string; chain: { id: number } };
}

// Sub-selection of Curator returned inside VaultState.curators (multi-curator V2).
export interface MorphoVaultCuratorRef {
  id: string;
  name: string;
}

export interface MorphoVaultState {
  totalAssets: BigIntLike;
  totalAssetsUsd: number | null;
  totalSupply: BigIntLike;
  apy: number;
  netApy: number;
  fee: number;
  sharePriceNumber: number | null;
  sharePriceUsd: number | null;
  curator: string;                          // primary curator address (V1 field)
  curators: MorphoVaultCuratorRef[];        // V2 multi-curator list; may be empty
  feeRecipient: string;
  guardian: string;
  owner: string;
  timestamp: BigIntLike;
  allocation: MorphoVaultAllocation[] | null;
}

export interface MorphoVault {
  address: string;
  symbol: string;
  name: string;
  creationTimestamp: BigIntLike;
  listed: boolean;
  featured: boolean;
  chain: { id: number };
  asset: MorphoAsset;
  state: MorphoVaultState | null;
}

// Returned by the root `curators` query — includes addresses + socials.
export interface MorphoCurator {
  id: string;
  name: string;
  description: string | null;
  verified: boolean;
  image: string | null;
  ownerOnly: boolean;
  addresses: { address: string; chainId: number | null }[];
  socials: { type: string; url: string }[];
}

export interface MorphoTimeseriesPoint {
  x: number;     // timestamp (seconds)
  y: number | null;
}

export type TimeseriesInterval = 'DAY' | 'WEEK' | 'MONTH';

export interface TimeseriesOptions {
  startTimestamp: number;
  endTimestamp: number;
  interval: TimeseriesInterval;
}

export interface Paginated<T> {
  items: T[];
  pageInfo?: { count: number; countTotal: number; limit: number; skip: number } | null;
}

// ---------- Client ----------

interface GraphQLError {
  message: string;
  path?: (string | number)[];
  extensions?: unknown;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export class MorphoApiError extends Error {
  constructor(message: string, public readonly errors?: GraphQLError[]) {
    super(message);
    this.name = 'MorphoApiError';
  }
}

export interface MorphoClientOptions {
  endpoint?: string;
  // Hook for rate-limiting / instrumentation.
  before?: () => Promise<void> | void;
}

export class MorphoClient {
  private readonly endpoint: string;
  private readonly before: MorphoClientOptions['before'];

  constructor(opts: MorphoClientOptions = {}) {
    this.endpoint = opts.endpoint ?? MORPHO_GRAPHQL_URL;
    this.before = opts.before;
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetchWithRetry(
      this.endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      { before: this.before },
    );

    if (!res.ok) {
      throw new MorphoApiError(`Morpho GraphQL HTTP ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      throw new MorphoApiError(
        `Morpho GraphQL errors: ${body.errors.map((e) => e.message).join('; ')}`,
        body.errors,
      );
    }
    if (!body.data) {
      throw new MorphoApiError('Morpho GraphQL returned no data');
    }
    return body.data;
  }

  // -------------- Queries --------------

  async chains(): Promise<MorphoChain[]> {
    const data = await this.query<{ chains: MorphoChain[] }>(`
      query Chains {
        chains { id network currency blockTimeMs }
      }
    `);
    return data.chains;
  }

  async markets(args: { first?: number; skip?: number; chainId?: number } = {}): Promise<
    Paginated<MorphoMarket>
  > {
    const { first = 100, skip = 0, chainId } = args;
    const data = await this.query<{ markets: Paginated<MorphoMarket> }>(
      `
      query Markets($first: Int, $skip: Int, $where: MarketFilters) {
        markets(first: $first, skip: $skip, where: $where, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
          items {
            marketId
            lltv
            irmAddress
            creationTimestamp
            listed
            chain { id }
            loanAsset  { address symbol name decimals }
            collateralAsset { address symbol name decimals }
            state {
              borrowAssets supplyAssets borrowAssetsUsd supplyAssetsUsd
              collateralAssets collateralAssetsUsd liquidityAssets liquidityAssetsUsd
              utilization supplyApy borrowApy netSupplyApy netBorrowApy fee price timestamp
            }
            badDebt         { underlying usd }
            realizedBadDebt { underlying usd }
          }
          pageInfo { count countTotal limit skip }
        }
      }
    `,
      { first, skip, where: chainId ? { chainId_in: [chainId] } : undefined },
    );
    return data.markets;
  }

  async marketById(marketId: string, chainId: number): Promise<MorphoMarket> {
    const data = await this.query<{ marketById: MorphoMarket }>(
      `
      query MarketById($marketId: String!, $chainId: Int!) {
        marketById(marketId: $marketId, chainId: $chainId) {
          marketId lltv irmAddress creationTimestamp listed
          chain { id }
          loanAsset  { address symbol name decimals }
          collateralAsset { address symbol name decimals }
          state {
            borrowAssets supplyAssets borrowAssetsUsd supplyAssetsUsd
            collateralAssets collateralAssetsUsd liquidityAssets liquidityAssetsUsd
            utilization supplyApy borrowApy netSupplyApy netBorrowApy fee price timestamp
          }
          badDebt         { underlying usd }
          realizedBadDebt { underlying usd }
        }
      }
    `,
      { marketId, chainId },
    );
    return data.marketById;
  }

  async vaults(args: { first?: number; skip?: number; chainId?: number } = {}): Promise<
    Paginated<MorphoVault>
  > {
    const { first = 100, skip = 0, chainId } = args;
    const data = await this.query<{ vaults: Paginated<MorphoVault> }>(
      `
      query Vaults($first: Int, $skip: Int, $where: VaultFilters) {
        vaults(first: $first, skip: $skip, where: $where, orderBy: TotalAssetsUsd, orderDirection: Desc) {
          items {
            address symbol name creationTimestamp listed featured
            chain { id }
            asset { address symbol name decimals }
            state {
              totalAssets totalAssetsUsd totalSupply apy netApy fee
              sharePriceNumber sharePriceUsd
              curator curators { id name } feeRecipient guardian owner timestamp
            }
          }
          pageInfo { count countTotal limit skip }
        }
      }
    `,
      { first, skip, where: chainId ? { chainId_in: [chainId] } : undefined },
    );
    return data.vaults;
  }

  async vaultByAddress(address: string, chainId: number): Promise<MorphoVault> {
    const data = await this.query<{ vaultByAddress: MorphoVault }>(
      `
      query VaultByAddress($address: String!, $chainId: Int!) {
        vaultByAddress(address: $address, chainId: $chainId) {
          address symbol name creationTimestamp listed featured
          chain { id }
          asset { address symbol name decimals }
          state {
            totalAssets totalAssetsUsd totalSupply apy netApy fee
            sharePriceNumber sharePriceUsd
            curator curators feeRecipient guardian owner timestamp
            allocation {
              supplyAssets supplyAssetsUsd supplyCap supplyCapUsd
              supplyQueueIndex withdrawQueueIndex
              market { marketId chain { id } }
            }
          }
        }
      }
    `,
      { address, chainId },
    );
    return data.vaultByAddress;
  }

  async curators(args: { first?: number; skip?: number } = {}): Promise<Paginated<MorphoCurator>> {
    const { first = 100, skip = 0 } = args;
    const data = await this.query<{ curators: Paginated<MorphoCurator> }>(
      `
      query Curators($first: Int, $skip: Int) {
        curators(first: $first, skip: $skip) {
          items {
            id name description verified image ownerOnly
            addresses { address chainId }
            socials   { type url }
          }
          pageInfo { count countTotal limit skip }
        }
      }
    `,
      { first, skip },
    );
    return data.curators;
  }

  async marketHistory(
    marketId: string,
    chainId: number,
    options: TimeseriesOptions,
  ): Promise<{
    supplyAssetsUsd: MorphoTimeseriesPoint[];
    borrowAssetsUsd: MorphoTimeseriesPoint[];
    collateralAssetsUsd: MorphoTimeseriesPoint[];
    liquidityAssetsUsd: MorphoTimeseriesPoint[];
    utilization: MorphoTimeseriesPoint[];
    supplyApy: MorphoTimeseriesPoint[];
    borrowApy: MorphoTimeseriesPoint[];
    netSupplyApy: MorphoTimeseriesPoint[];
    netBorrowApy: MorphoTimeseriesPoint[];
  }> {
    const data = await this.query<{
      marketById: { historicalState: Record<string, MorphoTimeseriesPoint[]> };
    }>(
      `
      query MarketHistory($marketId: String!, $chainId: Int!, $opts: TimeseriesOptions) {
        marketById(marketId: $marketId, chainId: $chainId) {
          historicalState {
            supplyAssetsUsd(options: $opts)     { x y }
            borrowAssetsUsd(options: $opts)     { x y }
            collateralAssetsUsd(options: $opts) { x y }
            liquidityAssetsUsd(options: $opts)  { x y }
            utilization(options: $opts)         { x y }
            supplyApy(options: $opts)           { x y }
            borrowApy(options: $opts)           { x y }
            netSupplyApy(options: $opts)        { x y }
            netBorrowApy(options: $opts)        { x y }
          }
        }
      }
    `,
      { marketId, chainId, opts: options },
    );
    return data.marketById.historicalState as {
      supplyAssetsUsd: MorphoTimeseriesPoint[];
      borrowAssetsUsd: MorphoTimeseriesPoint[];
      collateralAssetsUsd: MorphoTimeseriesPoint[];
      liquidityAssetsUsd: MorphoTimeseriesPoint[];
      utilization: MorphoTimeseriesPoint[];
      supplyApy: MorphoTimeseriesPoint[];
      borrowApy: MorphoTimeseriesPoint[];
      netSupplyApy: MorphoTimeseriesPoint[];
      netBorrowApy: MorphoTimeseriesPoint[];
    };
  }

  async vaultHistory(
    address: string,
    chainId: number,
    options: TimeseriesOptions,
  ): Promise<{
    totalAssetsUsd: MorphoTimeseriesPoint[];
    apy: MorphoTimeseriesPoint[];
    netApy: MorphoTimeseriesPoint[];
    sharePriceUsd: MorphoTimeseriesPoint[];
    fee: MorphoTimeseriesPoint[];
  }> {
    const data = await this.query<{
      vaultByAddress: { historicalState: Record<string, MorphoTimeseriesPoint[]> };
    }>(
      `
      query VaultHistory($address: String!, $chainId: Int!, $opts: TimeseriesOptions) {
        vaultByAddress(address: $address, chainId: $chainId) {
          historicalState {
            totalAssetsUsd(options: $opts) { x y }
            apy(options: $opts)            { x y }
            netApy(options: $opts)         { x y }
            sharePriceUsd(options: $opts)  { x y }
            fee(options: $opts)            { x y }
          }
        }
      }
    `,
      { address, chainId, opts: options },
    );
    return data.vaultByAddress.historicalState as {
      totalAssetsUsd: MorphoTimeseriesPoint[];
      apy: MorphoTimeseriesPoint[];
      netApy: MorphoTimeseriesPoint[];
      sharePriceUsd: MorphoTimeseriesPoint[];
      fee: MorphoTimeseriesPoint[];
    };
  }

  // ---------- Introspection self-check ----------
  //
  // Verifies the schema still exposes the fields we depend on for bad-debt and
  // V2 multi-curator support. Run once at worker startup; if any flag is false,
  // the sync layer falls back (computed bad debt, single-curator handling).
  async selfCheck(): Promise<SchemaCapabilities> {
    const data = await this.query<{
      market: { fields: { name: string }[] } | null;
      vaultState: { fields: { name: string }[] } | null;
    }>(`
      query SelfCheck {
        market: __type(name: "Market")       { fields { name } }
        vaultState: __type(name: "VaultState") { fields { name } }
      }
    `);
    const marketFields = new Set(data.market?.fields.map((f) => f.name) ?? []);
    const vaultStateFields = new Set(data.vaultState?.fields.map((f) => f.name) ?? []);
    return {
      hasBadDebt: marketFields.has('badDebt'),
      hasRealizedBadDebt: marketFields.has('realizedBadDebt'),
      hasPreLiquidations: marketFields.has('preLiquidations'),
      hasMultiCurators: vaultStateFields.has('curators'),
      hasFeeRecipient: vaultStateFields.has('feeRecipient'),
    };
  }
}

export interface SchemaCapabilities {
  hasBadDebt: boolean;
  hasRealizedBadDebt: boolean;
  hasPreLiquidations: boolean;
  hasMultiCurators: boolean;
  hasFeeRecipient: boolean;
}

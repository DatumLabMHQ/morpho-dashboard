// Static map from Morpho/EVM chain_id → display name + DefiLlama chain slug.
// Morpho GraphQL's Chain type only exposes {id, network, currency, blockTimeMs} —
// no display name or DefiLlama key. Sync layer uses this to populate chains.name
// and chains.slug. Unknown chain_ids fall through to a derived name.
//
// llamaSlug values come from the keys in DefiLlama's /protocol/{slug}.chainTvls
// (case-sensitive). When a new chain ships, add a row here and re-run the chains sync.

export interface ChainMeta {
  chainId: number;
  name: string;
  llamaSlug: string;
}

export const CHAIN_META: readonly ChainMeta[] = [
  { chainId: 1,        name: 'Ethereum',    llamaSlug: 'Ethereum' },
  // Display names aligned to Morpho's own interface labels where they differ
  // (OP Mainnet, Worldchain, HyperEVM). llamaSlug stays the DefiLlama key.
  { chainId: 10,       name: 'OP Mainnet',  llamaSlug: 'Optimism' },
  { chainId: 56,       name: 'BNB Chain',   llamaSlug: 'BSC' },
  { chainId: 100,      name: 'Gnosis',      llamaSlug: 'Gnosis' },
  { chainId: 130,      name: 'Unichain',    llamaSlug: 'Unichain' },
  { chainId: 137,      name: 'Polygon',     llamaSlug: 'Polygon' },
  { chainId: 143,      name: 'Monad',       llamaSlug: 'Monad' },
  { chainId: 146,      name: 'Sonic',       llamaSlug: 'Sonic' },
  { chainId: 252,      name: 'Fraxtal',     llamaSlug: 'Fraxtal' },
  { chainId: 480,      name: 'Worldchain',  llamaSlug: 'World Chain' },
  { chainId: 988,      name: 'Stable',      llamaSlug: 'Stable' },
  { chainId: 4217,     name: 'Tempo',       llamaSlug: 'Tempo' },
  { chainId: 747474,   name: 'Katana',      llamaSlug: 'Katana' },
  { chainId: 998,      name: 'HyperEVM',    llamaSlug: 'Hyperliquid L1' },
  { chainId: 999,      name: 'HyperEVM',    llamaSlug: 'Hyperliquid L1' },
  { chainId: 1135,     name: 'Lisk',        llamaSlug: 'Lisk' },
  { chainId: 1868,     name: 'Soneium',     llamaSlug: 'Soneium' },
  { chainId: 8453,     name: 'Base',        llamaSlug: 'Base' },
  { chainId: 34443,    name: 'Mode',        llamaSlug: 'Mode' },
  { chainId: 42161,    name: 'Arbitrum',    llamaSlug: 'Arbitrum' },
  { chainId: 42220,    name: 'Celo',        llamaSlug: 'Celo' },
  { chainId: 43114,    name: 'Avalanche',   llamaSlug: 'Avalanche' },
  { chainId: 57073,    name: 'Ink',         llamaSlug: 'Ink' },
  { chainId: 59144,    name: 'Linea',       llamaSlug: 'Linea' },
  { chainId: 80094,    name: 'Berachain',   llamaSlug: 'Berachain' },
  { chainId: 81457,    name: 'Blast',       llamaSlug: 'Blast' },
  { chainId: 98866,    name: 'Plume',       llamaSlug: 'Plume Mainnet' },
  { chainId: 534352,   name: 'Scroll',      llamaSlug: 'Scroll' },
  { chainId: 9745,     name: 'Plasma',      llamaSlug: 'Plasma' },
  { chainId: 42793,    name: 'Etherlink',   llamaSlug: 'Etherlink' },
  { chainId: 239,      name: 'TAC',         llamaSlug: 'TAC' },
];

const BY_ID = new Map(CHAIN_META.map((m) => [m.chainId, m]));

export function getChainMeta(chainId: number): ChainMeta | undefined {
  return BY_ID.get(chainId);
}

// Fallback display name for chains we don't have meta for yet.
// Capitalizes the GraphQL `network` string (e.g. "scroll" -> "Scroll").
export function deriveChainName(network: string): string {
  if (!network) return 'Unknown';
  return network
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

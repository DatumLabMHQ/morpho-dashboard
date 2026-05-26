// Resolves the category of an asset using the user-curated asset_categories
// override table. Match priority:
//   1. (address, chain_id)
//   2. (symbol,  chain_id)
//   3. (symbol)
// Anything unmatched returns 'other' with matchedBy='default'. The sync layer
// is expected to log unmatched assets (with TVL) to sync_runs.notes for triage.

export type AssetCategory =
  | 'stablecoin'
  | 'lst'
  | 'lrt'
  | 'btc'
  | 'eth'
  | 'rwa'
  | 'other';

export type CategoryMatchSource =
  | 'address+chain'
  | 'symbol+chain'
  | 'symbol'
  | 'default';

export interface AssetCategoryRule {
  symbol: string;
  address: string | null;
  chainId: number | null;
  category: AssetCategory;
  subcategory: string | null;
}

export interface AssetIdentity {
  symbol: string;
  address: string;
  chainId: number;
}

export interface AssetCategoryMatch {
  category: AssetCategory;
  subcategory: string | null;
  matchedBy: CategoryMatchSource;
}

export interface AssetCategoryIndex {
  byAddressChain: Map<string, AssetCategoryRule>;
  bySymbolChain: Map<string, AssetCategoryRule>;
  bySymbol: Map<string, AssetCategoryRule>;
}

const addrChainKey = (addr: string, chainId: number): string =>
  `${addr.toLowerCase()}:${chainId}`;
const symChainKey = (symbol: string, chainId: number): string =>
  `${symbol}:${chainId}`;

export function buildAssetCategoryIndex(rules: AssetCategoryRule[]): AssetCategoryIndex {
  const byAddressChain = new Map<string, AssetCategoryRule>();
  const bySymbolChain = new Map<string, AssetCategoryRule>();
  const bySymbol = new Map<string, AssetCategoryRule>();

  for (const rule of rules) {
    if (rule.address && rule.chainId != null) {
      byAddressChain.set(addrChainKey(rule.address, rule.chainId), rule);
    } else if (!rule.address && rule.chainId != null) {
      bySymbolChain.set(symChainKey(rule.symbol, rule.chainId), rule);
    } else if (!rule.address && rule.chainId == null) {
      bySymbol.set(rule.symbol, rule);
    }
    // Rules with address but no chainId are ignored — addresses aren't unique
    // across chains in general (though for most ERC-20s they happen to be).
  }

  return { byAddressChain, bySymbolChain, bySymbol };
}

export function categorizeAsset(
  asset: AssetIdentity,
  index: AssetCategoryIndex,
): AssetCategoryMatch {
  const ac = index.byAddressChain.get(addrChainKey(asset.address, asset.chainId));
  if (ac) return { category: ac.category, subcategory: ac.subcategory, matchedBy: 'address+chain' };

  const sc = index.bySymbolChain.get(symChainKey(asset.symbol, asset.chainId));
  if (sc) return { category: sc.category, subcategory: sc.subcategory, matchedBy: 'symbol+chain' };

  const s = index.bySymbol.get(asset.symbol);
  if (s) return { category: s.category, subcategory: s.subcategory, matchedBy: 'symbol' };

  return { category: 'other', subcategory: null, matchedBy: 'default' };
}

import type { AssetType } from '@api/portfolio-assets.api';
import type { Network } from '@api/wallet-addresses.api';

/** The colour and glyph an asset keeps on every screen (prototype "aico"). */
export interface AssetIdentity {
  color: string;
  glyph: string;
}

const cash = 'var(--c-cash)';
const other = 'var(--c-other)';

// Keyed by ticker, so a coin looks the same wherever it is held or listed.
const known: Record<string, AssetIdentity> = {
  BTC: { color: 'var(--c-btc)', glyph: '₿' },
  ETH: { color: 'var(--c-eth)', glyph: 'Ξ' },
  SOL: { color: 'var(--c-sol)', glyph: 'S' },
  ZEC: { color: 'var(--c-zec)', glyph: 'Z' },
  // EVM-MULTICHAIN: the chains that hold ETH look like themselves, not like Ethereum.
  BASE: { color: 'var(--c-base)', glyph: 'B' },
  ARB: { color: 'var(--c-arb)', glyph: 'A' },
  OP: { color: 'var(--c-op)', glyph: 'O' },
  TRX: { color: 'var(--c-trx)', glyph: 'T' },
  XLM: { color: 'var(--c-xlm)', glyph: 'X' },
  USDT: { color: cash, glyph: '₮' },
  USDC: { color: cash, glyph: '$' },
  USD: { color: cash, glyph: '$' },
  EUR: { color: cash, glyph: '€' },
  RUB: { color: cash, glyph: '₽' },
};

export function assetIdentity(asset: {
  symbol: string | null;
  name: string;
  assetType?: AssetType;
}): AssetIdentity {
  const ticker = asset.symbol?.trim().toUpperCase();
  const found = ticker ? known[ticker] : undefined;
  if (found) return found;
  return {
    color: asset.assetType === 'fiat' ? cash : other,
    glyph: (ticker || asset.name.trim()).slice(0, 1).toUpperCase() || '?',
  };
}

export type Blockchain = Exclude<Network, 'bybit'>;
const networkCoins: Record<Blockchain, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  base: 'BASE',
  arbitrum: 'ARB',
  optimism: 'OP',
  solana: 'SOL',
  tron: 'TRX',
  stellar: 'XLM',
  zcash: 'ZEC',
};

/** TOKEN-CHAIN: a blockchain looks like its own coin. */
export function networkIdentity(network: Blockchain): AssetIdentity {
  return known[networkCoins[network]];
}

/** Allocation by type: crypto in the prototype's blue, cash in the cash colour. */
export const assetTypeColors: Record<AssetType, string> = {
  crypto: 'var(--c-eth)',
  fiat: cash,
  manual: other,
};

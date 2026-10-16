import type { AccountClass } from '@api/accounting.api';
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
  POL: { color: 'var(--c-pol)', glyph: 'P' },
  BNB: { color: 'var(--c-bnb)', glyph: 'B' },
  AVAX: { color: 'var(--c-avax)', glyph: 'A' },
  TRX: { color: 'var(--c-trx)', glyph: 'T' },
  XLM: { color: 'var(--c-xlm)', glyph: 'X' },
  USDT: { color: 'var(--c-usdt)', glyph: '₮' },
  USDC: { color: 'var(--c-usdc)', glyph: '$' },
  USD: { color: cash, glyph: '$' },
  EUR: { color: cash, glyph: '€' },
  RUB: { color: cash, glyph: '₽' },
};

/** A token with no colour of its own takes one of six by its ticker, the same one every time. */
function paletteColor(ticker: string): string {
  let hash = 0;
  for (const char of ticker) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `var(--c-p${(hash % 6) + 1})`;
}

/** Brokers and real estate (prototype CLASSES): their own colours, apart from the Other grey. */
export const assetClassColors: Record<AccountClass, string> = {
  broker: 'var(--c-broker)',
  property: 'var(--c-prop)',
};

/** Every account's class (v8), by account id: null for a wallet. */
export type AccountClasses = Readonly<Record<string, AccountClass | null | undefined>>;

/**
 * The class of the accounts that hold an asset, when they all share one; an asset held in a
 * wallet as well, or in accounts of two classes, has none.
 */
export function heldClass(
  holdings: readonly { accountId: string }[],
  classes: AccountClasses,
): AccountClass | null {
  const found = new Set(holdings.map((holding) => classes[holding.accountId] ?? null));
  const [only] = found;
  return found.size === 1 ? only : null;
}

export function assetIdentity(asset: {
  symbol: string | null;
  name: string;
  assetType?: AssetType;
  /** The class of the account that holds it, where the caller knows it. */
  assetClass?: AccountClass | null;
}): AssetIdentity {
  const ticker = asset.symbol?.trim().toUpperCase();
  const found = ticker ? known[ticker] : undefined;
  if (found) return found;
  return {
    color:
      asset.assetType === 'fiat'
        ? cash
        : asset.assetType === 'crypto' && ticker
          ? paletteColor(ticker)
          : asset.assetClass
            ? assetClassColors[asset.assetClass]
            : other,
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
  polygon: 'POL',
  bnb: 'BNB',
  avalanche: 'AVAX',
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
/** Bank deposits in the allocation: the type, each deposit and each bank share it. */
export const depositColor = 'var(--c-deposit)';

export const assetTypeColors: Record<AssetType, string> = {
  crypto: 'var(--c-eth)',
  fiat: cash,
  manual: other,
};

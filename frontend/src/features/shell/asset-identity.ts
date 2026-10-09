import type { AssetType } from '@api/portfolio-assets.api';

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
  TRX: { color: 'var(--c-trx)', glyph: 'T' },
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

/** Allocation by type: crypto in the prototype's blue, cash in the cash colour. */
export const assetTypeColors: Record<AssetType, string> = {
  crypto: 'var(--c-eth)',
  fiat: cash,
  manual: other,
};

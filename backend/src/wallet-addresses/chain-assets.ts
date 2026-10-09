// What the tracked networks move (Q6, Q7): Bitcoin, Ethereum, Solana and Tron each with
// exactly the USDT and USDC tokens (ERC-20, SPL and TRC-20), and Stellar's own coin XLM (M23). A raw chain transaction leg names its token in
// `asset`; null is the network's own coin. Amounts are stored in the asset's base units.
// A Bybit account (M22, D8) is synced like a wallet: its records name the coin they move in
// `asset` (it has no coin of its own) and keep 18 decimals, enough for any amount Bybit shows.
// BYBIT-ANY-COIN: it holds any coin Bybit lists, not only the ones below.

export const networks = ['bitcoin', 'ethereum', 'solana', 'bybit', 'tron', 'stellar'] as const;
export type Network = (typeof networks)[number];

export interface ChainAsset {
  network: Network;
  /** The stored `asset` of a leg: null for the network's own coin, the ticker of a token. */
  token: string | null;
  symbol: string;
  name: string;
  decimals: number;
  /**
   * The token contract (Ethereum, lower case; Tron, base58) or mint (Solana); null for the
   * network's own coin.
   */
  contract: string | null;
}

export const networkNames: Record<Network, string> = {
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  solana: 'Solana',
  bybit: 'Bybit',
  tron: 'Tron',
  stellar: 'Stellar',
};

const bybitCoin = (symbol: string, name: string): ChainAsset => ({
  network: 'bybit',
  token: symbol,
  symbol,
  name,
  decimals: 18,
  contract: null,
});

export const chainAssets: readonly ChainAsset[] = [
  { network: 'bitcoin', token: null, symbol: 'BTC', name: 'Bitcoin', decimals: 8, contract: null },
  {
    network: 'ethereum',
    token: null,
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    contract: null,
  },
  {
    network: 'ethereum',
    token: 'USDT',
    symbol: 'USDT',
    name: 'Tether',
    decimals: 6,
    contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  },
  {
    network: 'ethereum',
    token: 'USDC',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  },
  { network: 'solana', token: null, symbol: 'SOL', name: 'Solana', decimals: 9, contract: null },
  {
    network: 'solana',
    token: 'USDT',
    symbol: 'USDT',
    name: 'Tether',
    decimals: 6,
    contract: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
  {
    network: 'solana',
    token: 'USDC',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    contract: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  // TRON-ADD: TRX and the TRC-20 USDT and USDC contracts.
  { network: 'tron', token: null, symbol: 'TRX', name: 'TRON', decimals: 6, contract: null },
  {
    network: 'tron',
    token: 'USDT',
    symbol: 'USDT',
    name: 'Tether',
    decimals: 6,
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  },
  {
    network: 'tron',
    token: 'USDC',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
  },
  // STELLAR-ADD: lumens only; Stellar's issued assets (its USDC among them) are not read.
  {
    network: 'stellar',
    token: null,
    symbol: 'XLM',
    name: 'Stellar',
    decimals: 7,
    contract: null,
  },
  bybitCoin('BTC', 'Bitcoin'),
  bybitCoin('ETH', 'Ethereum'),
  bybitCoin('SOL', 'Solana'),
  bybitCoin('USDT', 'Tether'),
  bybitCoin('USDC', 'USD Coin'),
];

export function isNetwork(value: unknown): value is Network {
  return networks.includes(value as Network);
}

// Fiat Bybit quotes some pairs in: money, not a coin the account holds.
const fiat = ['USD', 'EUR', 'GBP', 'RUB', 'BRL', 'TRY', 'PLN', 'KZT', 'UAH'];

/**
 * BYBIT-ANY-COIN: whether a Bybit account's records can hold this coin: any coin Bybit lists
 * with a ticker the stored records and prices can name (2 to 8 capitals or digits), except fiat.
 */
export function isBybitCoin(code: string): boolean {
  return /^[A-Z0-9]{2,8}$/.test(code) && !fiat.includes(code);
}

/** The asset a stored leg moves; an unknown pair is a programming error, never guessed. */
export function chainAsset(network: string, token: string | null): ChainAsset {
  const found = chainAssets.find((item) => item.network === network && item.token === token);
  if (found) return found;
  // Any other coin of a Bybit account is named by its ticker.
  if (network === 'bybit' && token !== null && isBybitCoin(token)) return bybitCoin(token, token);
  throw new Error('Unknown chain asset');
}

/** Whether the network names its coin in every leg: an exchange account has no coin of its own. */
export const isExchange = (network: string): boolean => network === 'bybit';

/** The coin a leg's fee is paid in: the network's own coin, or on an exchange the leg's coin. */
export function feeAsset(network: string, token: string | null): ChainAsset {
  return chainAsset(network, isExchange(network) ? token : null);
}

/**
 * Every asset a network's wallet can hold, its own coin first; for Bybit the coins it always
 * shows (BYBIT-ANY-COIN: it can hold any other too).
 */
export function networkAssets(network: Network): ChainAsset[] {
  return chainAssets.filter((item) => item.network === network);
}

// Accounting quantities carry 30 decimals (money.ts); base units scale up to them.
const ATOM_DECIMALS = 30;

/** Base units as accounting atoms. */
export function unitsToAtoms(units: bigint, asset: ChainAsset): bigint {
  return units * 10n ** BigInt(ATOM_DECIMALS - asset.decimals);
}

/** Base units as a decimal with the asset's full precision: "0.00100000" BTC. */
export function formatUnits(units: bigint, asset: ChainAsset): string {
  const magnitude = units < 0n ? -units : units;
  const one = 10n ** BigInt(asset.decimals);
  const fraction = (magnitude % one).toString().padStart(asset.decimals, '0');
  return `${units < 0n ? '-' : ''}${magnitude / one}.${fraction}`;
}

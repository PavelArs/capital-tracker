import type { WalletAddress } from '@api/wallet-addresses.api';

// The tracked networks as the Wallets screens present them (M10, M14, M15, Tron, M23, M24): the coin, the tokens a
// wallet on it can hold (USDT and USDC, Q7; every token on Ethereum and Solana, M25) and where its
// history comes from.
export interface NetworkInfo {
  name: string;
  /** The network's own coin. */
  symbol: string;
  /** The icon of a chain that holds another chain's coin (Base holds ETH), keyed like a ticker. */
  icon?: string;
  /** Every asset a wallet on the network holds, its own coin first. */
  assets: readonly string[];
  source: string;
  placeholder: string;
  defaultWallet: string;
  labelExample: string;
  /** TOKEN-ANY (M25): every other token the address moves is read too, named from the chain. */
  anyToken?: true;
  /** An exchange account (M22): read with an API key, its balances as the exchange reports. */
  exchange?: true;
}

export const networks: Record<WalletAddress['network'], NetworkInfo> = {
  bitcoin: {
    name: 'Bitcoin',
    symbol: 'BTC',
    assets: ['BTC'],
    source: 'Blockstream Esplora',
    placeholder: 'bc1q…, 1…, 3… or zpub…',
    defaultWallet: 'Bitcoin wallet',
    labelExample: 'Savings BTC',
  },
  ethereum: {
    name: 'Ethereum',
    symbol: 'ETH',
    assets: ['ETH', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Ethereum wallet',
    labelExample: 'Main ETH',
  },
  // EVM-MULTICHAIN: the same 0x address on another chain is another wallet here, read through the
  // same Etherscan key, holding ETH as its own coin.
  base: {
    name: 'Base',
    symbol: 'ETH',
    icon: 'BASE',
    assets: ['ETH', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Base wallet',
    labelExample: 'Base ETH',
  },
  arbitrum: {
    name: 'Arbitrum One',
    symbol: 'ETH',
    icon: 'ARB',
    assets: ['ETH', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Arbitrum wallet',
    labelExample: 'Arbitrum ETH',
  },
  optimism: {
    name: 'OP Mainnet',
    symbol: 'ETH',
    icon: 'OP',
    assets: ['ETH', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'OP Mainnet wallet',
    labelExample: 'Optimism ETH',
  },
  polygon: {
    name: 'Polygon',
    symbol: 'POL',
    assets: ['POL', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Polygon wallet',
    labelExample: 'Polygon POL',
  },
  bnb: {
    name: 'BNB Smart Chain',
    symbol: 'BNB',
    assets: ['BNB', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'BNB Chain wallet',
    labelExample: 'BNB Chain BNB',
  },
  avalanche: {
    name: 'Avalanche C-Chain',
    symbol: 'AVAX',
    assets: ['AVAX', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Avalanche wallet',
    labelExample: 'Avalanche AVAX',
  },
  solana: {
    name: 'Solana',
    symbol: 'SOL',
    assets: ['SOL', 'USDT', 'USDC'],
    anyToken: true,
    source: 'Solana public RPC',
    placeholder: 'Base58 address, 32 to 44 characters',
    defaultWallet: 'Solana wallet',
    labelExample: 'Main SOL',
  },
  tron: {
    name: 'Tron',
    symbol: 'TRX',
    assets: ['TRX', 'USDT', 'USDC'],
    source: 'TronGrid and Tronscan',
    placeholder: 'T…, 34 characters',
    defaultWallet: 'Tron wallet',
    labelExample: 'Main TRX',
  },
  stellar: {
    name: 'Stellar',
    symbol: 'XLM',
    assets: ['XLM'],
    source: 'Stellar Horizon',
    placeholder: 'G…, 56 characters',
    defaultWallet: 'Stellar wallet',
    labelExample: 'Main XLM',
  },
  zcash: {
    name: 'Zcash',
    symbol: 'ZEC',
    assets: ['ZEC'],
    source: 'Trezor Blockbook',
    placeholder: 't1… or t3…, 35 characters',
    defaultWallet: 'Zcash wallet',
    labelExample: 'Main ZEC',
  },
  bybit: {
    name: 'Bybit',
    symbol: 'USDT',
    assets: ['BTC', 'ETH', 'SOL', 'USDT', 'USDC'],
    source: 'Bybit API, read-only key',
    placeholder: 'API key',
    defaultWallet: 'Bybit',
    labelExample: 'Main account',
    exchange: true,
  },
};

/** The glyph of a network's rows: its coin, or the exchange's initial. */
export const networkIcon = (network: NetworkInfo) =>
  network.exchange
    ? { symbol: null, name: network.name, assetType: 'manual' as const }
    : { symbol: network.icon ?? network.symbol, name: network.name, assetType: 'crypto' as const };

export const networkOf = (address: Pick<WalletAddress, 'network'>): NetworkInfo =>
  networks[address.network];

/**
 * The coins an address's balances are compared with and shown for: the network's assets; an
 * exchange account (BYBIT-ANY-COIN) or an Ethereum or Solana wallet (TOKEN-ANY) also any other
 * coin it reports.
 */
export function addressAssets(
  address: Pick<WalletAddress, 'network' | 'balances'>,
): readonly string[] {
  const network = networkOf(address);
  if (!network.exchange && !network.anyToken) return network.assets;
  const others = (address.balances ?? [])
    .map((balance) => balance.symbol)
    .filter((symbol) => !network.assets.includes(symbol));
  return [...network.assets, ...others];
}

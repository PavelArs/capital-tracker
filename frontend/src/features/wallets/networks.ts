import type { WalletAddress } from '@api/wallet-addresses.api';

// The tracked networks as the Wallets screens present them (M10, M14, M15, Tron): the coin, the tokens a
// wallet on it can hold (USDT and USDC only, Q7) and where its history comes from.
export interface NetworkInfo {
  name: string;
  /** The network's own coin. */
  symbol: string;
  /** Every asset a wallet on the network holds, its own coin first. */
  assets: readonly string[];
  source: string;
  placeholder: string;
  defaultWallet: string;
  labelExample: string;
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
    source: 'Etherscan',
    placeholder: '0x…',
    defaultWallet: 'Ethereum wallet',
    labelExample: 'Main ETH',
  },
  solana: {
    name: 'Solana',
    symbol: 'SOL',
    assets: ['SOL', 'USDT', 'USDC'],
    source: 'Solana public RPC',
    placeholder: 'Base58 address, 32 to 44 characters',
    defaultWallet: 'Solana wallet',
    labelExample: 'Main SOL',
  },
  tron: {
    name: 'Tron',
    symbol: 'TRX',
    assets: ['TRX', 'USDT', 'USDC'],
    source: 'TronGrid',
    placeholder: 'T…, 34 characters',
    defaultWallet: 'Tron wallet',
    labelExample: 'Main TRX',
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
    : { symbol: network.symbol, name: network.name, assetType: 'crypto' as const };

export const networkOf = (address: Pick<WalletAddress, 'network'>): NetworkInfo =>
  networks[address.network];

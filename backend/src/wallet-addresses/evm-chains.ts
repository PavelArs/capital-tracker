// EVM-MULTICHAIN: the Ethereum-like chains whose addresses are read like an Ethereum one, through
// Etherscan's V2 API with the chain's `chainid`. Each chain is its own network in the app (one
// wallet row per address and chain, like any other network); the same 0x address on several
// chains is the same key, so the owner adds it once per chain.

/** The networks that share one address format, history reader and token model. */
export type EvmNetwork =
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'bnb'
  | 'avalanche';

/** A stablecoin the chain's wallets follow by ticker. */
export interface EvmStablecoin {
  /** The contract, lower case. */
  contract: string;
  /** What the contract's own decimals() says: 6 on most chains, 18 on BNB Smart Chain. */
  decimals: number;
}

export interface EvmChain {
  network: EvmNetwork;
  /** "Base", for the owner's messages. */
  name: string;
  /** The chain's own id, which Etherscan's V2 API takes as `chainid`. */
  chainId: number;
  /** CoinGecko's asset platform id, for the price of a token by contract. */
  coingeckoPlatform: string;
  /** The chain's own coin: ETH on the Ethereum family, POL, BNB, AVAX on the others. */
  native: { symbol: string; name: string };
  /** The USDT and USDC contracts the chain's wallets follow by ticker. */
  stablecoins: { USDT?: EvmStablecoin; USDC?: EvmStablecoin };
}

const eth = { symbol: 'ETH', name: 'Ethereum' };
const six = (contract: string): EvmStablecoin => ({ contract, decimals: 6 });

export const evmChains: readonly EvmChain[] = [
  {
    network: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    coingeckoPlatform: 'ethereum',
    native: eth,
    stablecoins: {
      USDT: six('0xdac17f958d2ee523a2206206994597c13d831ec7'),
      USDC: six('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    },
  },
  {
    network: 'base',
    name: 'Base',
    chainId: 8453,
    coingeckoPlatform: 'base',
    native: eth,
    // Native USDC. Base has no Tether-issued USDT in this list: a USDT-named token there is read
    // as any other token and, calling itself USDT, is hidden until the owner brings it back.
    stablecoins: { USDC: six('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') },
  },
  {
    network: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    coingeckoPlatform: 'arbitrum-one',
    native: eth,
    // Native USDC; the bridged USDC.e is another token and shows under its own ticker.
    stablecoins: {
      USDT: six('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'),
      USDC: six('0xaf88d065e77c8cc2239327c5edb3a432268e5831'),
    },
  },
  {
    network: 'optimism',
    name: 'OP Mainnet',
    chainId: 10,
    coingeckoPlatform: 'optimistic-ethereum',
    native: eth,
    stablecoins: {
      USDT: six('0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'),
      USDC: six('0x0b2c639c533813f4aa9d7837caf62653d097ff85'),
    },
  },
  {
    network: 'polygon',
    name: 'Polygon',
    chainId: 137,
    coingeckoPlatform: 'polygon-pos',
    native: { symbol: 'POL', name: 'POL' },
    // Native USDC; the bridged USDC.e is another token and shows under its own ticker.
    stablecoins: {
      USDT: six('0xc2132d05d31c914a87c6611c10748aeb04b58e8f'),
      USDC: six('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'),
    },
  },
  {
    network: 'bnb',
    name: 'BNB Smart Chain',
    chainId: 56,
    coingeckoPlatform: 'binance-smart-chain',
    native: { symbol: 'BNB', name: 'BNB' },
    // Binance-Peg tokens: unlike every other chain here, both have 18 decimals.
    stablecoins: {
      USDT: { contract: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
      USDC: { contract: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    },
  },
  {
    network: 'avalanche',
    name: 'Avalanche C-Chain',
    chainId: 43114,
    coingeckoPlatform: 'avalanche',
    native: { symbol: 'AVAX', name: 'Avalanche' },
    // Native USDC and USDt; the bridged USDC.e and USDT.e are other tokens.
    stablecoins: {
      USDT: six('0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7'),
      USDC: six('0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'),
    },
  },
];

export const evmNetworks: readonly EvmNetwork[] = evmChains.map((chain) => chain.network);

export const isEvmNetwork = (network: string): network is EvmNetwork =>
  evmNetworks.includes(network as EvmNetwork);

export function evmChain(network: EvmNetwork): EvmChain {
  const found = evmChains.find((chain) => chain.network === network);
  if (!found) throw new Error('Unknown EVM chain');
  return found;
}

// EVM-MULTICHAIN: the Ethereum-like chains whose addresses are read like an Ethereum one, through
// Etherscan's V2 API with the chain's `chainid`. Each chain is its own network in the app (one
// wallet row per address and chain, like any other network); the same 0x address on several
// chains is the same key, so the owner adds it once per chain.

/** The networks that share one address format, history reader and token model. */
export type EvmNetwork = 'ethereum' | 'base' | 'arbitrum' | 'optimism';

export interface EvmChain {
  network: EvmNetwork;
  /** "Base", for the owner's messages. */
  name: string;
  /** The chain's own id, which Etherscan's V2 API takes as `chainid`. */
  chainId: number;
  /** CoinGecko's asset platform id, for the price of a token by contract. */
  coingeckoPlatform: string;
  /** The USDT and USDC contracts (lower case) the chain's wallets follow by ticker. */
  stablecoins: { USDT?: string; USDC?: string };
}

export const evmChains: readonly EvmChain[] = [
  {
    network: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    coingeckoPlatform: 'ethereum',
    stablecoins: {
      USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    },
  },
  {
    network: 'base',
    name: 'Base',
    chainId: 8453,
    coingeckoPlatform: 'base',
    // Native USDC. Base has no Tether-issued USDT in this list: a USDT-named token there is read
    // as any other token and, calling itself USDT, is hidden until the owner brings it back.
    stablecoins: { USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  },
  {
    network: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    coingeckoPlatform: 'arbitrum-one',
    // Native USDC; the bridged USDC.e is another token and shows under its own ticker.
    stablecoins: {
      USDT: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      USDC: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    },
  },
  {
    network: 'optimism',
    name: 'OP Mainnet',
    chainId: 10,
    coingeckoPlatform: 'optimistic-ethereum',
    stablecoins: {
      USDT: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
      USDC: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
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

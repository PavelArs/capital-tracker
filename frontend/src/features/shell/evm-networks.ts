import type { Network } from '@api/wallet-addresses.api';

// EVM-MULTICHAIN: the networks that share Ethereum's 0x addresses and hashes.
export const evmNetworks = [
  'ethereum',
  'base',
  'arbitrum',
  'optimism',
] as const satisfies readonly Network[];
export type EvmNetwork = (typeof evmNetworks)[number];

export const isEvm = (network: string): network is EvmNetwork =>
  evmNetworks.includes(network as EvmNetwork);

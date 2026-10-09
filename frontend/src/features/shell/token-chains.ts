import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { useEffect, useState } from 'react';
import type { Blockchain } from './asset-identity';

// TOKEN-CHAIN: USDT and USDC exist on several blockchains, and a portfolio row adds them up,
// so the row names the blockchains its tokens are on, from the wallets' chain balances.

export type TokenChains = ReadonlyMap<string, readonly Blockchain[]>;

const order: Blockchain[] = ['bitcoin', 'ethereum', 'solana', 'tron', 'stellar'];
const ownCoin: Record<Blockchain, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  tron: 'TRX',
  stellar: 'XLM',
};
export const chainNames: Record<Blockchain, string> = {
  bitcoin: 'Bitcoin',
  ethereum: 'Ethereum',
  solana: 'Solana',
  tron: 'Tron',
  stellar: 'Stellar',
};

/**
 * The blockchains each token is held on, by upper-case ticker; a network's own coin is not a
 * token, and an exchange account is no blockchain. Only the addresses of `accountId` count
 * when it is given.
 */
export function tokenChains(
  addresses: readonly WalletAddress[] | null,
  accountId?: string,
): TokenChains {
  const found = new Map<string, Set<Blockchain>>();
  for (const address of addresses ?? []) {
    const { network } = address;
    if (network === 'bybit') continue;
    if (accountId !== undefined && address.accountId !== accountId) continue;
    for (const balance of address.balances ?? []) {
      const symbol = balance.symbol.toUpperCase();
      if (symbol === ownCoin[network] || Number(balance.quantity) === 0) continue;
      found.set(symbol, (found.get(symbol) ?? new Set()).add(network));
    }
  }
  return new Map(
    [...found].map(([symbol, networks]) => [symbol, order.filter((item) => networks.has(item))]),
  );
}

/** "Ethereum, Solana" for a token held on both; null for a coin no wallet holds as a token. */
export function chainsLabel(symbol: string | null, chains: TokenChains): string | null {
  const networks = symbol ? chains.get(symbol.toUpperCase()) : undefined;
  return networks?.length ? networks.map((network) => chainNames[network]).join(', ') : null;
}

/** The one blockchain a token is held on, for its icon; none when it is on several. */
export function onlyChain(symbol: string | null, chains: TokenChains): Blockchain | undefined {
  const networks = symbol ? chains.get(symbol.toUpperCase()) : undefined;
  return networks?.length === 1 ? networks[0] : undefined;
}

/** The token chains of every tracked wallet; empty until they are read or if that fails. */
export function useTokenChains(): TokenChains {
  const [chains, setChains] = useState<TokenChains>(new Map());
  useEffect(() => {
    let current = true;
    walletAddressesApi
      .list()
      .then((addresses) => current && setChains(tokenChains(addresses)))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return chains;
}

/** "500 USDT on Ethereum, Solana": text about a token followed by where it is held. */
export function withChains(text: string, symbol: string | null, chains: TokenChains): string {
  const where = chainsLabel(symbol, chains);
  return where ? `${text} on ${where}` : text;
}

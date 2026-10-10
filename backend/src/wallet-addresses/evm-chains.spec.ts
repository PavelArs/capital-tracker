import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anyTokenNetworks,
  chainAsset,
  isNetwork,
  networkAssets,
  networkNames,
  networks,
} from './chain-assets';
import { evmChain, evmChains, evmNetworks, isEvmNetwork } from './evm-chains';
import { parseRegistration } from './wallet-address-input';

const owned = `0x${'a1'.repeat(20)}`;

describe('EVM-MULTICHAIN: the Ethereum-like chains', () => {
  it('names every chain once, with its own chain id and CoinGecko platform', () => {
    expect(new Set(evmNetworks).size).toBe(evmChains.length);
    expect(new Set(evmChains.map((chain) => chain.chainId)).size).toBe(evmChains.length);
    expect(new Set(evmChains.map((chain) => chain.coingeckoPlatform)).size).toBe(evmChains.length);
    expect(evmChain('base').chainId).toBe(8453);
    expect(evmChain('arbitrum').chainId).toBe(42161);
    expect(evmChain('optimism').chainId).toBe(10);
    expect(isEvmNetwork('base')).toBe(true);
    expect(isEvmNetwork('solana')).toBe(false);
  });

  it('makes every chain a network that holds ETH, follows its stablecoins and moves any token', () => {
    for (const chain of evmChains) {
      expect(isNetwork(chain.network)).toBe(true);
      expect(networkNames[chain.network]).toBe(chain.name);
      expect(anyTokenNetworks).toContain(chain.network);
      const tokens = networkAssets(chain.network).map((asset) => asset.token);
      expect(tokens[0]).toBeNull();
      expect(chainAsset(chain.network, null).symbol).toBe('ETH');
      for (const [ticker, contract] of Object.entries(chain.stablecoins)) {
        expect(contract).toMatch(/^0x[0-9a-f]{40}$/);
        expect(tokens).toContain(ticker);
        expect(chainAsset(chain.network, ticker).contract).toBe(contract);
      }
    }
  });

  it('keeps one contract for one ticker on every chain', () => {
    const contracts = evmChains.flatMap((chain) => Object.values(chain.stablecoins));
    expect(new Set(contracts).size).toBe(contracts.length);
  });

  it('accepts the same checksummed or lower-case address for every chain', () => {
    for (const network of evmNetworks) {
      expect(
        parseRegistration({ network, address: owned.toUpperCase().replace('0X', '0x') }),
      ).toEqual({ network, address: owned, accountId: null, label: null });
      expect(() =>
        parseRegistration({ network, address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' }),
      ).toThrow();
    }
  });

  it('is stored by the migration: every network the app reads is named in its checks', () => {
    const migration = readFileSync(
      join(__dirname, '..', 'migrations', '1796000000000-TrackEvmChains.ts'),
      'utf8',
    );
    for (const network of networks) expect(migration).toContain(`'${network}'`);
  });
});

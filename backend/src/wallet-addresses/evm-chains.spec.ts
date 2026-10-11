import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marketTickers } from '../accounting/asset-classification';
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
    expect(evmChain('polygon').chainId).toBe(137);
    expect(evmChain('bnb').chainId).toBe(56);
    expect(evmChain('avalanche').chainId).toBe(43114);
    expect(isEvmNetwork('base')).toBe(true);
    expect(isEvmNetwork('solana')).toBe(false);
  });

  it('makes every chain a network that holds its own coin, follows its stablecoins and moves any token', () => {
    for (const chain of evmChains) {
      expect(isNetwork(chain.network)).toBe(true);
      expect(networkNames[chain.network]).toBe(chain.name);
      expect(anyTokenNetworks).toContain(chain.network);
      const tokens = networkAssets(chain.network).map((asset) => asset.token);
      expect(tokens[0]).toBeNull();
      expect(chainAsset(chain.network, null).symbol).toBe(chain.native.symbol);
      for (const [ticker, coin] of Object.entries(chain.stablecoins)) {
        expect(coin.contract).toMatch(/^0x[0-9a-f]{40}$/);
        expect(tokens).toContain(ticker);
        expect(chainAsset(chain.network, ticker)).toMatchObject({
          contract: coin.contract,
          decimals: coin.decimals,
        });
      }
    }
  });

  it('names the coin of each chain, which the market prices', () => {
    expect(evmChains.map((chain) => chain.native.symbol)).toEqual([
      'ETH',
      'ETH',
      'ETH',
      'ETH',
      'POL',
      'BNB',
      'AVAX',
    ]);
    for (const { native } of evmChains) expect(marketTickers).toContain(native.symbol);
  });

  it('counts the stablecoins of BNB Smart Chain with its 18 decimals and the rest with 6', () => {
    expect(chainAsset('bnb', 'USDT').decimals).toBe(18);
    expect(chainAsset('bnb', 'USDC').decimals).toBe(18);
    for (const chain of evmChains.filter(({ network }) => network !== 'bnb')) {
      for (const ticker of Object.keys(chain.stablecoins)) {
        expect(chainAsset(chain.network, ticker).decimals).toBe(6);
      }
    }
  });

  it('keeps one contract for one ticker on every chain', () => {
    const contracts = evmChains.flatMap((chain) =>
      Object.values(chain.stablecoins).map((coin) => coin.contract),
    );
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

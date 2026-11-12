import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { BybitMarketClient } from './bybit-market';
import type { CoinGeckoClient, KrakenClient, PriceFailure, TokenQuote } from './price-providers';
import { PricesService } from './prices.service';

// TOKEN-ANY-PRICE characterization: which tokens are asked of CoinGecko, in which requests, and
// what is stored and marked afterwards, with every query and request recorded in order.
// Synthetic contracts and prices only.
const now = new Date('2026-10-18T12:05:00.000Z');

interface Call {
  sql: string;
  parameters: unknown[];
}
type Answer =
  | { ok: true; prices: Map<string, TokenQuote | null> }
  | { ok: false; reason: PriceFailure };

const contract = (prefix: string, index: number) =>
  `0x${prefix}${String(index).padStart(38 - prefix.length + 2, '0')}`;
const quote = (price: string): TokenQuote => ({ price, observedAt: '2026-10-18T12:00:00.000Z' });

async function collect(
  due: { network: string; contract: string; ticker: string }[],
  answer: (platform: string, contracts: readonly string[], call: number) => Answer,
) {
  const calls: Call[] = [];
  const query = async (sql: string, parameters: unknown[] = []) => {
    calls.push({ sql, parameters });
    if (sql.includes('FROM chain_tokens t')) return due;
    if (sql.includes('INSERT INTO price_observations'))
      return (parameters[1] as string[]).map((asset) => ({ asset }));
    return [];
  };
  const manager = { query };
  const source = {
    query,
    manager,
    transaction: async (work: (m: unknown) => unknown) => work(manager),
  };
  let asked = 0;
  const coingecko = {
    tokens: async (platform: string, contracts: readonly string[], at: Date) => {
      calls.push({ sql: 'coingecko.tokens', parameters: [platform, contracts, at] });
      return answer(platform, contracts, asked++);
    },
  };
  const service = new PricesService(
    source as unknown as DataSource,
    new ConfigService({}),
    {} as KrakenClient,
    coingecko as unknown as CoinGeckoClient,
    {} as BybitMarketClient,
  ) as unknown as { collectTokens(now: Date): Promise<number> };
  const stored = await service.collectTokens(now);
  return { stored, calls: JSON.parse(JSON.stringify(calls)) as Call[] };
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kinds = (calls: readonly Call[]) =>
  calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 3).join(' '));

describe('TOKEN-ANY-PRICE characterization of the token price run', () => {
  it('TOKEN-ANY-PRICE asks nothing when no held token is due', async () => {
    const { stored, calls } = await collect([], () => {
      throw new Error('not asked');
    });
    expect(stored).toBe(0);
    expect(kinds(calls)).toEqual(['SELECT t.network, t.contract,']);
    expect(calls[0].parameters).toEqual([
      '2026-10-17T12:05:00.000Z',
      120,
      ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bnb', 'avalanche', 'solana'],
    ]);
  });

  it('TOKEN-ANY-PRICE asks each network in batches of 30 and marks every token asked', async () => {
    const ethereum = Array.from({ length: 31 }, (_, index) => ({
      network: 'ethereum',
      contract: contract('e', index),
      ticker: `SYNE${index}`,
    }));
    const due = [
      {
        network: 'solana',
        contract: 'SynthMint1111111111111111111111111111111111',
        ticker: 'SYNS',
      },
      ...ethereum,
      { network: 'polygon', contract: contract('p', 1), ticker: 'SYNP' },
    ];
    const { stored, calls } = await collect(due, (platform, contracts) => {
      const prices = new Map<string, TokenQuote | null>();
      for (const [index, item] of contracts.entries()) {
        // Every third token is unknown to CoinGecko, every fifth listed with no readable quote.
        if (index % 3 === 1) continue;
        prices.set(item, index % 5 === 4 ? null : quote(`${index + 1}.5`));
      }
      return platform === 'polygon-pos' ? { ok: true, prices: new Map() } : { ok: true, prices };
    });
    expect(
      calls
        .filter((call) => call.sql === 'coingecko.tokens')
        .map((call) => [call.parameters[0], (call.parameters[1] as string[]).length]),
    ).toEqual([
      ['ethereum', 30],
      ['ethereum', 1],
      ['polygon-pos', 1],
      ['solana', 1],
    ]);
    const marks = calls.filter((call) => call.sql.startsWith('UPDATE chain_tokens'));
    expect(marks).toHaveLength(33);
    expect(marks.at(-1)?.parameters).toEqual([
      'solana',
      'SynthMint1111111111111111111111111111111111',
      now.toISOString(),
      true,
    ]);
    expect(stored).toBe(18);
    expect(digest(calls)).toBe('8e2637f82136b81e09455d51bf74ed0b5ae73bcf42cfd07a96d6e1b13c7e1a7e');
  });

  it('TOKEN-ANY-PRICE a failed request stops the run and marks only the tokens answered', async () => {
    const due = [
      ...Array.from({ length: 31 }, (_, index) => ({
        network: 'ethereum',
        contract: contract('e', index),
        ticker: `SYNE${index}`,
      })),
      { network: 'base', contract: contract('b', 1), ticker: 'SYNB' },
    ];
    const { stored, calls } = await collect(due, (_platform, contracts, call) =>
      call === 0
        ? { ok: true, prices: new Map(contracts.map((item) => [item, quote('2')])) }
        : { ok: false, reason: 'rate_limited' },
    );
    expect(calls.filter((call) => call.sql === 'coingecko.tokens')).toHaveLength(2);
    expect(calls.filter((call) => call.sql.startsWith('UPDATE chain_tokens'))).toHaveLength(30);
    expect(calls.find((call) => call.sql.includes('INSERT INTO sync_sources'))?.parameters).toEqual(
      expect.arrayContaining(['prices:tokens', 'failed', 'rate_limited']),
    );
    expect(stored).toBe(30);
    expect(digest(calls)).toBe('2e0eefd9d2448954bb41e7fdc527c9cd5f350b5f2116404430ae18babb566dc2');
  });
});

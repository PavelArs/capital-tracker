import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountingService } from './accounting.service';
import { classifyAsset, instrumentPayload } from './asset-classification';
import { parseInstrument } from './input';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instrumentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const createdAt = new Date('2026-10-04T12:00:00.000Z');

const classify = (body: Record<string, unknown>) =>
  classifyAsset(parseInstrument({ requestId, name: 'Asset', ...body }));
const rejects = (run: () => unknown) => expect(run).toThrow(BadRequestException);

describe('AST-RULES derived price source and valuation currency', () => {
  it.each([
    [{ assetType: 'crypto', symbol: 'BTC' }, 'crypto', 'USD', 'market'],
    [{ assetType: 'crypto', symbol: 'btc' }, 'crypto', 'USD', 'market'],
    [{ assetType: 'crypto', symbol: 'USDT', valuationCurrency: 'USD' }, 'crypto', 'USD', 'market'],
    [{ assetType: 'crypto', symbol: 'XLM' }, 'crypto', 'USD', 'market'],
    [{ assetType: 'crypto', symbol: 'TON' }, 'crypto', 'USD', 'manual'],
    [{ assetType: 'fiat', symbol: 'RUB' }, 'fiat', 'RUB', 'fixed'],
    [{ assetType: 'fiat', symbol: 'eur', valuationCurrency: 'EUR' }, 'fiat', 'EUR', 'fixed'],
    [{ assetType: 'manual', valuationCurrency: 'RUB' }, 'manual', 'RUB', 'manual'],
    [{ assetType: 'manual', symbol: 'GOLD' }, 'manual', 'USD', 'manual'],
    // Only ASCII letters are uppercased, as PostgreSQL upper() does in the checks.
    [{ assetType: 'crypto', symbol: '\u017fol' }, 'crypto', 'USD', 'manual'],
    [{ symbol: '\u017fol' }, 'manual', 'USD', 'manual'],
  ])('classifies %j', (body, assetType, valuationCurrency, priceSource) => {
    expect(classify(body)).toEqual({ assetType, valuationCurrency, priceSource });
  });

  it.each([
    { assetType: 'fiat', symbol: 'GBP' },
    { assetType: 'fiat', symbol: 'u\u017fd' },
    { assetType: 'fiat' },
    { assetType: 'fiat', symbol: 'USD', valuationCurrency: 'RUB' },
    { assetType: 'crypto' },
    { assetType: 'crypto', symbol: 'BTC', valuationCurrency: 'EUR' },
    { valuationCurrency: 'RUB' },
    { symbol: 'BTC', valuationCurrency: 'USD' },
  ])('refuses the contradictory combination %j', (body) => {
    rejects(() => classify(body));
  });

  it.each([
    { assetType: 'stock' },
    { assetType: 'Crypto', symbol: 'BTC' },
    { assetType: 'manual', valuationCurrency: 'GBP' },
    { assetType: 'manual', valuationCurrency: 'usd' },
    { assetType: 42 },
    { assetType: null },
    { assetType: 'manual', valuationCurrency: ['RUB'] },
    { assetType: 'manual', priceSource: 'manual' },
  ])('refuses an invalid raw field %j before classification', (body) => {
    rejects(() => parseInstrument({ requestId, name: 'Asset', ...body }));
  });
});

describe('AST-LEGACY the previous create body', () => {
  it('keeps the exact legacy parse result and classifies by ticker', () => {
    expect(parseInstrument({ requestId, name: 'Ether', symbol: 'ETH' })).toEqual({
      requestId,
      name: 'Ether',
      symbol: 'ETH',
    });
    expect(classify({ symbol: 'ETH' })).toEqual({
      assetType: 'crypto',
      valuationCurrency: 'USD',
      priceSource: 'market',
    });
    expect(classify({ symbol: 'USD' })).toEqual({
      assetType: 'manual',
      valuationCurrency: 'USD',
      priceSource: 'manual',
    });
    expect(classify({})).toEqual({
      assetType: 'manual',
      valuationCurrency: 'USD',
      priceSource: 'manual',
    });
  });

  it('keeps the legacy replay payload and identifies classified bodies by resolved values', () => {
    const legacy = parseInstrument({ requestId, name: 'Ether', symbol: 'ETH' });
    expect(instrumentPayload(legacy, classifyAsset(legacy))).toBe(
      JSON.stringify({ name: 'Ether', symbol: 'ETH' }),
    );
    const implicit = parseInstrument({ requestId, name: 'Deposit', assetType: 'manual' });
    const explicit = parseInstrument({
      requestId,
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'USD',
    });
    const payload = JSON.stringify({
      name: 'Deposit',
      symbol: null,
      assetType: 'manual',
      valuationCurrency: 'USD',
    });
    expect(instrumentPayload(implicit, classifyAsset(implicit))).toBe(payload);
    expect(instrumentPayload(explicit, classifyAsset(explicit))).toBe(payload);
  });
});

interface StoredRow {
  id: string;
  name: string;
  symbol: string | null;
  namespace: 'manual';
  assetType: string;
  valuationCurrency: string;
  priceSource: string;
  createdAt: Date;
  canonicalPayload: string;
}

// Captures SQL parameters only; persistence itself is proven by asset-classification-db.cjs.
function recordingSource(existing: StoredRow[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const source = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT')) {
        if (existing.length) return [];
        const [id, , , canonicalPayload, name, symbol, assetType, valuationCurrency, priceSource] =
          params as string[];
        return [
          {
            id,
            name,
            symbol,
            namespace: 'manual',
            assetType,
            valuationCurrency,
            priceSource,
            createdAt,
            canonicalPayload,
          },
        ];
      }
      return existing;
    }),
  };
  return { source: source as unknown as DataSource, calls };
}

describe('AST-NEW create and list return the classification', () => {
  it('stores a manual deposit valued in rubles', async () => {
    const { source, calls } = recordingSource();
    const result = await new AccountingService(source).createInstrument(owner, {
      requestId,
      name: 'Deposit',
      assetType: 'manual',
      valuationCurrency: 'RUB',
    });
    expect(result.created).toBe(true);
    expect({ ...result.value, id: undefined }).toEqual({
      id: undefined,
      name: 'Deposit',
      symbol: null,
      namespace: 'manual',
      assetType: 'manual',
      valuationCurrency: 'RUB',
      priceSource: 'manual',
      createdAt: createdAt.toISOString(),
    });
    expect(calls[0].sql).toMatch(/"assetType","valuationCurrency","priceSource"/);
    expect(calls[0].params.slice(3)).toEqual([
      JSON.stringify({
        name: 'Deposit',
        symbol: null,
        assetType: 'manual',
        valuationCurrency: 'RUB',
      }),
      'Deposit',
      null,
      'manual',
      'RUB',
      'manual',
    ]);
  });

  it('replays a stored legacy row and returns its classification', async () => {
    const row: StoredRow = {
      id: instrumentId,
      name: 'Bitcoin',
      symbol: 'BTC',
      namespace: 'manual',
      assetType: 'crypto',
      valuationCurrency: 'USD',
      priceSource: 'market',
      createdAt,
      canonicalPayload: JSON.stringify({ name: 'Bitcoin', symbol: 'BTC' }),
    };
    const { source } = recordingSource([row]);
    const result = await new AccountingService(source).createInstrument(owner, {
      requestId,
      name: 'Bitcoin',
      symbol: 'BTC',
    });
    expect(result).toEqual({
      created: false,
      value: {
        id: instrumentId,
        name: 'Bitcoin',
        symbol: 'BTC',
        namespace: 'manual',
        assetType: 'crypto',
        valuationCurrency: 'USD',
        priceSource: 'market',
        createdAt: createdAt.toISOString(),
      },
    });
    const list = await new AccountingService(source).listInstruments(owner);
    expect(list.items[0]).toEqual(result.value);
  });

  it('refuses a contradictory body before any query', async () => {
    const { source, calls } = recordingSource();
    await expect(
      new AccountingService(source).createInstrument(owner, {
        requestId,
        name: 'Pounds',
        symbol: 'GBP',
        assetType: 'fiat',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  });
});

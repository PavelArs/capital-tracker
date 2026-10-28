import type { DataSource } from 'typeorm';
import { type EtherscanClient, parseInternal, parseNormal, parseToken } from './etherscan-client';
import { evmChain } from './evm-chains';
import { EvmSyncAdapter } from './evm-sync.adapter';

const address = `0x${'a'.repeat(40)}`;
const outside = `0x${'b'.repeat(40)}`;
const contract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const raw = (n: number) => ({
  blockNumber: '10',
  timeStamp: '1720000000',
  hash: `0x${'1'.repeat(64)}`,
  blockHash: `0x${'2'.repeat(64)}`,
  from: outside,
  to: address,
  contractAddress: contract,
  value: String(n + 1),
  tokenDecimal: '6',
  tokenName: 'USD Coin',
  tokenSymbol: 'USDC',
});

// One transaction spans two pages without log indices: page-local conversion loses a leg.
function setup(backfill = false, kind: 'normal' | 'internal' | 'tokens' = 'tokens') {
  const row = {
    id: 'wallet',
    ownerId: 'owner',
    address,
    scannedBlock: backfill ? 20 : 9,
    tokenBackfillTo: backfill ? 10 : null,
    tokenBackfillAt: backfill ? 9 : null,
    evmSync: null as unknown,
    removedAt: null as string | null,
  };
  const stored = new Map<string, bigint>();
  const calls: number[] = [];
  let time = 0;
  let failPage = false;
  let beforePage: (() => void) | undefined;
  const manager = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.includes('FROM chain_tokens') && sql.includes('WHERE network'))
        return [
          {
            network: 'optimism',
            contract,
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            ticker: 'USDC',
            coingeckoId: null,
          },
        ];
      if (sql.includes('SELECT') && sql.includes('wallet_addresses'))
        return row.removedAt ? [] : [structuredClone(row)];
      if (sql.includes('SET "evmSync"')) {
        row.evmSync = args[2] === null ? null : JSON.parse(args[2] as string);
        return;
      }
      if (sql.includes('UPDATE wallet_addresses')) {
        if (sql.includes('SET "scannedBlock"')) row.scannedBlock = args[2] as number;
        if (sql.includes('SET "tokenBackfillTo"')) {
          row.tokenBackfillTo = args[2] as number | null;
          row.tokenBackfillAt = args[3] as number | null;
        }
        if (sql.includes('"evmSync" = NULL')) row.evmSync = null;
        return;
      }
      if (sql.includes('INSERT INTO wallet_address_transactions')) {
        const inserted = [];
        for (let i = 0; i < args.length; i += 12) {
          const txid = args[i + 2] as string;
          if (!stored.has(txid)) {
            stored.set(txid, BigInt(args[i + 6] as string));
            inserted.push({ txid });
          }
        }
        return inserted;
      }
      return [];
    },
  };
  const source = {
    query: manager.query,
    transaction: async (_level: string, run: (m: unknown) => unknown) => run(manager),
  };
  const history = async (asked: typeof kind, from: number, page: number) => {
    if (asked !== kind) return { ok: true, items: [] };
    calls.push(page);
    time += 13_000;
    beforePage?.();
    if (failPage && page === 2) return { ok: false, reason: 'unavailable' };
    return {
      ok: true,
      items:
        from > 10
          ? []
          : Array.from({ length: page === 1 ? 1000 : page === 2 ? 1 : 0 }, (_, i) => {
              const n = (page - 1) * 1000 + i;
              if (kind === 'tokens') return parseToken(raw(n));
              const item = { ...raw(n), gasUsed: '0', gasPrice: '0', isError: '0' };
              return kind === 'normal'
                ? parseNormal({ ...item, hash: `0x${(n + 1).toString(16).padStart(64, '0')}` })
                : parseInternal(item);
            }),
    };
  };
  const client = {
    configured: true,
    blockNumber: async () => ({ ok: true, block: 84 }),
    normal: async (_a: string, from: number, _to: number, page = 1) =>
      history('normal', from, page),
    internal: async (_a: string, from: number, _to: number, page = 1) =>
      history('internal', from, page),
    tokens: async (_a: string, from: number, _to: number, page = 1) =>
      history('tokens', from, page),
  };
  const adapter = () =>
    new EvmSyncAdapter(
      source as unknown as DataSource,
      { forChain: () => client } as unknown as EtherscanClient,
      { ...evmChain('optimism'), blockscout: undefined },
    );
  return {
    row,
    stored,
    calls,
    adapter,
    now: () => time,
    fail: (value: boolean) => {
      failPage = value;
    },
    onPage: (fn: () => void) => {
      beforePage = fn;
    },
  };
}

describe('SYNC-PROGRESS EVM saturated block', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([false, true])(
    'resumes complete-block token identities across restarts (backfill=%s)',
    async (backfill) => {
      const test = setup(backfill);
      jest.spyOn(Date, 'now').mockImplementation(test.now);
      let result: Awaited<ReturnType<EvmSyncAdapter['step']>> | undefined;
      for (let pass = 0; pass < 12; pass++) {
        result = await test.adapter().step('owner', 'wallet');
        expect(result.outcome).not.toBe('provider_error');
        if (result.outcome === 'complete') break;
        expect(test.stored.size === 0 || test.stored.size === 1001).toBe(true);
      }
      expect(result?.outcome).toBe('complete');
      expect(test.calls).toContain(2);
      expect(test.stored.size).toBe(1001);
      expect([...test.stored.values()].reduce((a, b) => a + b, 0n)).toBe(501501n);
      expect(test.row.evmSync).toBeNull();
      await test.adapter().step('owner', 'wallet');
      expect(test.stored.size).toBe(1001);
    },
  );
  it('retains unfinished pages on provider failure and never publishes a partial transaction', async () => {
    const test = setup();
    jest.spyOn(Date, 'now').mockImplementation(test.now);
    test.fail(true);
    let result: Awaited<ReturnType<EvmSyncAdapter['step']>> | undefined;
    for (let i = 0; i < 8; i++) {
      result = await test.adapter().step('owner', 'wallet');
      if (result.outcome === 'provider_error') break;
    }
    expect(result).toMatchObject({ outcome: 'provider_error', reason: 'unavailable' });
    expect(test.stored.size).toBe(0);
    expect(test.row.scannedBlock).toBe(9);
    test.fail(false);
    for (let i = 0; i < 8 && test.stored.size === 0; i++)
      await test.adapter().step('owner', 'wallet');
    expect(test.stored.size).toBe(1001);
  });
  it.each(['normal', 'internal'] as const)(
    'resumes the saturated %s sibling without losing native value',
    async (kind) => {
      const test = setup(false, kind);
      jest.spyOn(Date, 'now').mockImplementation(test.now);
      for (let i = 0; i < 12; i++) {
        const result = await test.adapter().step('owner', 'wallet');
        expect(result.outcome).not.toBe('provider_error');
        if (result.outcome === 'complete') break;
      }
      expect(test.row.scannedBlock).toBe(20);
      expect(test.stored.size).toBe(kind === 'normal' ? 1001 : 1);
      expect([...test.stored.values()].reduce((a, b) => a + b, 0n)).toBe(501501n);
    },
  );
  it.each(['removed', 'advanced'] as const)(
    'refuses checkpoint writes after the wallet is %s during a request',
    async (change) => {
      const test = setup();
      jest.spyOn(Date, 'now').mockImplementation(test.now);
      await test.adapter().step('owner', 'wallet');
      test.onPage(() => {
        if (change === 'removed') test.row.removedAt = '2026-10-28T00:00:00Z';
        else test.row.evmSync = { ...(test.row.evmSync as object), revision: 'other-pass' };
      });
      await expect(test.adapter().step('owner', 'wallet')).rejects.toThrow('Another sync');
      expect(test.stored.size).toBe(0);
      expect(test.row.scannedBlock).toBe(9);
    },
  );
});

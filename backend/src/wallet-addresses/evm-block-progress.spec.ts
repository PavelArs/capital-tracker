import type { DataSource } from 'typeorm';
import { parseInternal, parseToken } from './etherscan-client';
import { type EvmScan, readEvmBlock } from './evm-block-progress';
import type { EvmReader } from './evm-reader';

const raw = (index: number) => ({
  blockHash: `0x${'2'.repeat(64)}`,
  blockNumber: '10',
  timeStamp: '1720000000',
  hash: `0x${'1'.repeat(64)}`,
  from: `0x${'a'.repeat(40)}`,
  to: `0x${'b'.repeat(40)}`,
  value: '1',
  isError: '0',
  traceId: String(index),
  logIndex: String(index),
  contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  tokenDecimal: '6',
  tokenName: 'USD Coin',
  tokenSymbol: 'USDC',
});
function setup() {
  let row: EvmScan = {
    id: 'wallet',
    ownerId: 'owner',
    address: raw(0).to,
    scannedBlock: 9,
    tokenBackfillTo: null,
    tokenBackfillAt: 9,
    evmSync: null,
  };
  const query = async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT')) return [structuredClone(row)];
    row = { ...row, evmSync: JSON.parse(params[2] as string) };
    return [];
  };
  const source = {
    transaction: async (_: string, run: (manager: { query: typeof query }) => unknown) =>
      run({ query }),
  };
  return { source: source as DataSource, state: () => structuredClone(row) };
}
describe('SYNC-PROGRESS EVM page boundaries', () => {
  it('preserves legitimate equal token transfers when the provider has no event indices', async () => {
    const test = setup();
    const item = raw(0);
    delete (item as Partial<typeof item>).logIndex;
    const reader = {
      historySource: 'primary',
      fallbackAvailable: false,
      page: async (
        _source: string,
        _kind: string,
        _address: string,
        _block: number,
        page: number,
      ) => ({
        ok: true,
        items: Array.from({ length: page === 1 ? 1000 : 1 }, () => parseToken(item)),
      }),
    } as unknown as EvmReader;
    const result = await readEvmBlock(test.source, reader, test.state(), 'tokens', Date.now());
    expect(result).toMatchObject({ ok: true, complete: true });
    expect(test.state().evmSync?.tokens).toHaveLength(1001);
  });

  it.each(['history', 'tokens'] as const)(
    'rejects overlapping identified events after restart (%s)',
    async (mode) => {
      const test = setup();
      const kind = mode === 'history' ? 'internal' : 'tokens';
      const parse = mode === 'history' ? parseInternal : parseToken;
      let interrupted = false;
      const reader = {
        historySource: 'primary',
        fallbackAvailable: false,
        page: async (
          _source: string,
          asked: string,
          _address: string,
          _block: number,
          page: number,
        ) => {
          if (asked !== kind) return { ok: true, items: [] };
          if (page === 2 && !interrupted) {
            interrupted = true;
            return { ok: false, reason: 'unavailable' };
          }
          return {
            ok: true,
            items: (page === 1 ? Array.from({ length: 1000 }, (_, i) => i) : [999, 1000]).map((i) =>
              parse(raw(i)),
            ),
          };
        },
      } as unknown as EvmReader;
      await readEvmBlock(test.source, reader, test.state(), mode, Date.now());
      const result = await readEvmBlock(test.source, reader, test.state(), mode, Date.now());
      expect(result).toMatchObject({ ok: false, reason: 'invalid_response' });
      expect(test.state().scannedBlock).toBe(9);
      expect(test.state().evmSync?.[kind]).toHaveLength(1000);
    },
  );
  it.each(['history', 'tokens'] as const)(
    'restarts the uncommitted block on fallback after plan refusal (%s)',
    async (mode) => {
      const test = setup();
      let interrupted = false;
      let refused = false;
      const fallbackPages: number[] = [];
      const reader = {
        historySource: 'primary',
        fallbackAvailable: true,
        page: async (
          source: string,
          kind: string,
          _address: string,
          _block: number,
          page: number,
        ) => {
          if (kind !== 'tokens') return { ok: true, items: [] };
          if (source === 'fallback') {
            fallbackPages.push(page);
            return { ok: true, items: [parseToken(raw(2000))] };
          }
          if (page === 2) {
            if (!interrupted) {
              interrupted = true;
              return { ok: false, reason: 'unavailable' };
            }
            refused = true;
            return { ok: false, reason: 'plan_required' };
          }
          return { ok: true, items: Array.from({ length: 1000 }, (_, i) => parseToken(raw(i))) };
        },
      } as unknown as EvmReader;
      await readEvmBlock(test.source, reader, test.state(), mode, Date.now());
      const result = await readEvmBlock(test.source, reader, test.state(), mode, Date.now());
      expect(refused).toBe(true);
      expect(result).toMatchObject({ ok: true, complete: true });
      expect(fallbackPages).toEqual([1]);
      expect(test.state().evmSync?.tokens).toHaveLength(1);
      expect(test.state().evmSync?.source).toBe('fallback');
    },
  );
});

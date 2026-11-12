import type { EntityManager } from 'typeorm';
import { leftOutTokens } from '../wallet-addresses/token-left-out';
import { tokenKey } from '../wallet-addresses/token-visibility';
import { readChainMoves } from './portfolio-valuation.service';

// Only the token filter is replaced; its own rules are tested with the wallet addresses.
jest.mock('../wallet-addresses/token-left-out', () => ({
  ...jest.requireActual('../wallet-addresses/token-left-out'),
  leftOutTokens: jest.fn(),
}));

// Synthetic ids and amounts only.
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1);
const walletAccount = uuid(0xa1);
const savingsAccount = uuid(0xa2);
const ethWallet = uuid(0xb1);
const otherWallet = uuid(0xb2);
const instruments: Record<string, string> = { ETH: uuid(0xe7), SOL: uuid(0x50), USDT: uuid(0x05) };
const at = (n: number) => new Date(Date.UTC(2025, 0, n, 21, 30));
const deposit = {
  receivedUnits: '0',
  sentUnits: '1000000000000000000',
  feeUnits: '1000000000000000',
};

function label(sql: string): string {
  if (sql.includes(`v.type IN ('pool-deposit', 'pool-withdrawal')`)) return 'pools';
  if (sql.includes(`t.raw->>'quoteAsset' AS asset`)) return 'quotes';
  if (sql.includes('coalesce((SELECT sum(m.units)')) return 'legs';
  if (sql.includes('UNION ALL')) return 'stake';
  if (sql.startsWith('SELECT id,name,symbol FROM accounting_instruments')) return 'instrument';
  throw new Error(`Unexpected statement: ${sql.slice(0, 80)}`);
}

function database(answers: Record<string, unknown[]>) {
  const log: [string, unknown[]][] = [];
  const query = async (text: string, params: unknown[] = []) => {
    const name = label(text.replace(/\s+/g, ' ').trim());
    log.push([name, params]);
    if (name !== 'instrument') return answers[name] ?? [];
    const id = instruments[params[2] as string];
    return id ? [{ id, name: params[2], symbol: params[2] }] : [];
  };
  return { log, manager: { query } as unknown as EntityManager };
}

const leg = (overrides: Record<string, unknown>) => ({
  accountId: walletAccount,
  addressId: ethWallet,
  network: 'ethereum',
  asset: null,
  receivedUnits: '0',
  sentUnits: '0',
  stakeUnits: '0',
  ...overrides,
});
const pool = (overrides: Record<string, unknown>) => ({
  ...leg({}),
  feeUnits: '1000000000000000',
  partial: false,
  depositKey: null,
  deposit: null,
  ...overrides,
});

describe('D1-CHAIN-MOVES: the chain movements that count before anyone answers them', () => {
  beforeEach(() =>
    (leftOutTokens as jest.Mock).mockResolvedValue(new Set([tokenKey(ethWallet, '0xhidden')])),
  );

  it('reads every kind of leg, settles pools in order and skips what does not count', async () => {
    const { log, manager } = database({
      legs: [
        leg({ blockTime: at(1), receivedUnits: '1000000000000000000' }),
        // A token the address leaves out is skipped before its coin is looked up.
        leg({ blockTime: at(2), asset: '0xhidden', receivedUnits: '5' }),
        leg({
          accountId: savingsAccount,
          addressId: otherWallet,
          blockTime: at(3),
          receivedUnits: '5',
          sentUnits: '5',
        }),
        leg({
          accountId: savingsAccount,
          addressId: otherWallet,
          blockTime: at(4),
          sentUnits: '2000000000000000000',
        }),
        // A coin without an asset is left out until one exists.
        leg({ addressId: uuid(0xb5), network: 'bitcoin', blockTime: at(5), receivedUnits: '1' }),
        // SOL-STAKE-MOVE: only the fee of a leg into the wallet's own stake accounts leaves.
        leg({
          accountId: savingsAccount,
          addressId: uuid(0xb4),
          network: 'solana',
          blockTime: at(6),
          sentUnits: '1000000000',
          stakeUnits: '999995000',
        }),
      ],
      quotes: [
        {
          accountId: walletAccount,
          network: 'bybit',
          asset: 'USDT',
          blockTime: at(7),
          receivedUnits: '0',
          sentUnits: '25000000000000000000',
          stakeUnits: '0',
        },
      ],
      stake: [
        {
          accountId: savingsAccount,
          network: 'solana',
          asset: null,
          blockTime: at(8),
          units: '-3000',
          stakeUnits: '0',
        },
        {
          accountId: savingsAccount,
          network: 'solana',
          asset: null,
          blockTime: at(9),
          units: '7000',
          stakeUnits: '0',
        },
      ],
      // Out of order: the parts of one deposit are settled in the order they happened.
      pools: [
        pool({
          blockTime: at(12),
          txid: 'p3',
          receivedUnits: '500000000000000000',
          depositKey: `${ethWallet}:p1`,
          deposit,
        }),
        pool({ blockTime: at(10), txid: 'p1', sentUnits: '1000000000000000000' }),
        pool({
          blockTime: at(11),
          txid: 'p2',
          receivedUnits: '400000000000000000',
          partial: true,
          depositKey: `${ethWallet}:p1`,
          deposit,
        }),
      ],
    });
    const moves = await readChainMoves(manager, owner);
    const out = (n: number, instrumentId: string, quantity: string) => ({
      instrumentId,
      occurredAt: at(n).toISOString(),
      inbound: false,
      quantity,
    });
    expect([...moves]).toEqual([
      [
        walletAccount,
        [
          { ...out(1, instruments.ETH, '1'), inbound: true },
          out(7, instruments.USDT, '25'),
          out(10, instruments.ETH, '0.001'),
          out(11, instruments.ETH, '0.001'),
          // What the pool kept below what was still in it leaves with the closing withdrawal.
          out(12, instruments.ETH, '0.098'),
        ],
      ],
      [
        savingsAccount,
        [
          out(4, instruments.ETH, '2'),
          out(6, instruments.SOL, '0.000005'),
          out(8, instruments.SOL, '0.000003'),
          { ...out(9, instruments.SOL, '0.000007'), inbound: true },
        ],
      ],
    ]);
    expect(log).toEqual([
      ['legs', [owner]],
      ['quotes', [owner]],
      ['stake', [owner]],
      ['pools', [owner]],
      ['instrument', [owner, 'crypto', 'ETH']],
      ['instrument', [owner, 'crypto', 'BTC']],
      ['instrument', [owner, 'crypto', 'SOL']],
      ['instrument', [owner, 'crypto', 'USDT']],
    ]);
    expect(leftOutTokens).toHaveBeenCalledWith(manager, owner);
  });

  it('keeps a withdrawal of a deposit it cannot name as its own fee only', async () => {
    const { manager } = database({
      pools: [
        pool({ blockTime: at(11), txid: 'p2', receivedUnits: '1', depositKey: null, deposit }),
      ],
    });
    expect([...(await readChainMoves(manager, owner))]).toEqual([
      [
        walletAccount,
        [
          {
            instrumentId: instruments.ETH,
            occurredAt: at(11).toISOString(),
            inbound: false,
            quantity: '0.001',
          },
        ],
      ],
    ]);
  });

  it('reads nothing into an empty map', async () => {
    const { log, manager } = database({});
    await expect(readChainMoves(manager, owner)).resolves.toEqual(new Map());
    expect(log.map(([name]) => name)).toEqual(['legs', 'quotes', 'stake', 'pools']);
  });
});

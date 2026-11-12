import type { DataSource } from 'typeorm';
import type { HorizonClient, StellarPayment, StellarTransaction } from './horizon-client';
import {
  MAX_STELLAR_PAYMENT_PAGES,
  MAX_STELLAR_TRANSACTION_PAGES,
  StellarSyncAdapter,
} from './stellar-sync.adapter';

// Synthetic accounts, TOIDs and amounts: how one pass reads and commits Stellar history.
const wallet = 'GWALLET';
const other = 'GOTHER';
const TX_PAGE = 5;
const PAY_PAGE = 10;

const toid = (ledger: number, position = 1) => (BigInt(ledger) << 32n) | (BigInt(position) << 12n);
const hash = (id: bigint) => id.toString(16).padStart(64, '0');
const tx = (ledger: number, feeAccount = other, position = 1): StellarTransaction => {
  const id = toid(ledger, position);
  return {
    hash: hash(id),
    toid: id,
    ledger,
    createdAt: `2026-10-01T00:00:${String(ledger % 60).padStart(2, '0')}.000Z`,
    successful: true,
    feeAccount,
    feeCharged: 100n,
    raw: { id: id.toString() },
  };
};
const pay = (
  transaction: StellarTransaction,
  operation: number,
  move: { from: string; to: string; units: bigint } | null,
  merge: StellarPayment['merge'] = null,
): StellarPayment => ({
  id: transaction.toid | BigInt(operation),
  transaction: transaction.toid,
  hash: transaction.hash,
  type: merge ? 'account_merge' : 'payment',
  moves: move ? [move] : [],
  merge,
  raw: { op: operation },
});

/** A Horizon list read oldest first past the cursor, a page at a time. */
const paged =
  <T>(items: T[], size: number, key: (item: T) => bigint) =>
  async (_address: string, after: bigint | null) => ({
    ok: true,
    items: items.filter((item) => after === null || key(item) > after).slice(0, size),
  });

function harness(
  client: Partial<Record<'transactions' | 'payments' | 'mergeAmount' | 'balance', unknown>>,
  readTo: string | null = null,
) {
  const stored = { readTo, events: [] as unknown[][] };
  const row = () => ({ id: 'a', ownerId: 'o', address: wallet, readTo: stored.readTo });
  const query = jest.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('INSERT INTO wallet_stellar_accounts')) return [];
    if (sql.includes('INSERT INTO wallet_address_transactions')) {
      const legs = [];
      for (let index = 0; index < args.length; index += 10)
        legs.push([args[index + 2], args[index + 5], args[index + 6], args[index + 7]]);
      stored.events.push(['insert', ...legs]);
      return legs.map(([txid]) => ({ txid }));
    }
    if (sql.includes('SET "readTo"')) {
      stored.readTo = args[1] as string;
      stored.events.push(['readTo', args[1]]);
      return [];
    }
    if (sql.includes('"reportedUnits"')) {
      stored.events.push(['reported', args[1]]);
      return [];
    }
    if (sql.includes('UPDATE wallet_addresses')) {
      stored.events.push(['address', args[2], args[3]]);
      return [];
    }
    if (sql.includes('FROM wallet_addresses a')) return [row()];
    throw new Error(sql);
  });
  const source = {
    query,
    transaction: async (_level: string, run: (manager: unknown) => unknown) => run({ query }),
  };
  const horizon = {
    transactions: paged<StellarTransaction>([], TX_PAGE, (item) => item.toid),
    payments: paged<StellarPayment>([], PAY_PAGE, (item) => item.id),
    mergeAmount: jest.fn(),
    balance: jest.fn(async () => ({ ok: true, units: 55n })),
    ...client,
  };
  const adapter = new StellarSyncAdapter(
    source as unknown as DataSource,
    horizon as unknown as HorizonClient,
  );
  return { adapter, stored, horizon };
}

const lists = (transactions: StellarTransaction[], payments: StellarPayment[]) => ({
  transactions: paged(transactions, TX_PAGE, (item) => item.toid),
  payments: paged(payments, PAY_PAGE, (item) => item.id),
});

describe('STELLAR-SYNC: one pass reads whole transactions and their payments', () => {
  it('STELLAR-SYNC marks an empty history read and stores the reported balance', async () => {
    const { adapter, stored } = harness({});
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 0,
    });
    expect(stored.events).toEqual([
      ['address', null, true],
      ['reported', '55'],
    ]);
  });

  it('STELLAR-REPORTED fails a read history when Horizon refuses the balance', async () => {
    const { adapter } = harness({
      balance: async () => ({ ok: false, reason: 'rate_limited' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 0,
    });
  });

  it('STELLAR-SYNC fails the pass when the transaction list fails', async () => {
    const { adapter, stored } = harness({
      transactions: async () => ({ ok: false, reason: 'unavailable' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'unavailable',
      imported: 0,
    });
    expect(stored.events).toEqual([]);
  });

  it('STELLAR-SYNC fails the pass when the payment list fails', async () => {
    const { adapter, stored } = harness({
      ...lists([tx(100)], []),
      payments: async () => ({ ok: false, reason: 'unavailable' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({
      outcome: 'provider_error',
      reason: 'unavailable',
    });
    expect(stored.events).toEqual([]);
  });

  it('STELLAR-SYNC refuses transactions that do not come oldest first past the cursor', async () => {
    const { adapter } = harness({
      transactions: async () => ({ ok: true, items: [tx(101), tx(100)] }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'invalid_response',
      imported: 0,
    });
  });

  it('STELLAR-SYNC refuses payments that do not come oldest first', async () => {
    const first = tx(100);
    const { adapter } = harness({
      transactions: paged([first], TX_PAGE, (item) => item.toid),
      payments: async () => ({
        ok: true,
        items: [pay(first, 2, null), pay(first, 1, null)],
      }),
    });
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ reason: 'invalid_response' });
  });

  it('STELLAR-SYNC stores each transaction once with its payments and fee, then completes', async () => {
    const first = tx(100);
    const second = tx(101, wallet);
    const { adapter, stored } = harness(
      lists(
        [first, second],
        [
          pay(first, 1, { from: other, to: wallet, units: 10_000_000n }),
          pay(second, 1, { from: wallet, to: other, units: 3_000_000n }),
        ],
      ),
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'complete',
      reason: null,
      imported: 2,
    });
    expect(stored.events).toEqual([
      ['insert', [first.hash, '10000000', '0', '0'], [second.hash, '0', '3000100', '100']],
      ['readTo', second.toid.toString()],
      ['address', 101, true],
      ['reported', '55'],
    ]);
  });

  it('STELLAR-SYNC continues from the stored transaction, past its own operations', async () => {
    const first = tx(100);
    const second = tx(101);
    const payments = jest.fn(
      paged(
        [
          pay(first, 1, { from: other, to: wallet, units: 1n }),
          pay(second, 1, { from: other, to: wallet, units: 2n }),
        ],
        PAY_PAGE,
        (item) => item.id,
      ),
    );
    const { adapter, stored } = harness(
      { transactions: paged([first, second], TX_PAGE, (item) => item.toid), payments },
      first.toid.toString(),
    );
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({
      outcome: 'complete',
      imported: 1,
    });
    expect(payments.mock.calls[0][1]).toBe(first.toid | 0xfffn);
    expect(stored.events[0]).toEqual(['insert', [second.hash, '2', '0', '0']]);
  });

  it('STELLAR-SYNC reads the amount of a merge into the wallet from its effects', async () => {
    const first = tx(100);
    const mergeAmount = jest.fn(async () => ({ ok: true, units: 7_000_000n }));
    const { adapter, stored } = harness({
      ...lists([first], [pay(first, 1, null, { from: other, into: wallet })]),
      mergeAmount,
    });
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({
      outcome: 'complete',
      imported: 1,
    });
    expect(mergeAmount).toHaveBeenCalledWith(first.toid | 1n, wallet);
    expect(stored.events[0]).toEqual(['insert', [first.hash, '7000000', '0', '0']]);
  });

  it('STELLAR-SYNC stores the transactions before a merge whose amount cannot be read', async () => {
    const first = tx(100);
    const second = tx(101);
    const { adapter, stored } = harness({
      ...lists(
        [first, second],
        [
          pay(first, 1, { from: other, to: wallet, units: 4n }),
          pay(second, 1, null, { from: other, into: wallet }),
        ],
      ),
      mergeAmount: async () => ({ ok: false, reason: 'rate_limited' }),
    });
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'provider_error',
      reason: 'rate_limited',
      imported: 1,
    });
    expect(stored.events).toEqual([
      ['insert', [first.hash, '4', '0', '0']],
      ['readTo', first.toid.toString()],
      ['address', 100, false],
    ]);
  });

  it('STELLAR-SYNC leaves a merge to the next pass when the time is used up', async () => {
    const first = tx(100);
    const second = tx(101);
    const { adapter, stored } = harness({
      ...lists(
        [first, second],
        [
          pay(first, 1, { from: other, to: wallet, units: 4n }),
          pay(second, 1, null, { from: other, into: wallet }),
        ],
      ),
    });
    let clock = 0;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 30_000));
    try {
      await expect(adapter.step('o', 'a')).resolves.toEqual({
        outcome: 'partial',
        reason: null,
        imported: 1,
      });
    } finally {
      now.mockRestore();
    }
    expect(stored.readTo).toBe(first.toid.toString());
  });

  it('STELLAR-SYNC ends partial after its transaction pages, storing what they listed', async () => {
    const all = Array.from({ length: TX_PAGE * MAX_STELLAR_TRANSACTION_PAGES + 2 }, (_, index) =>
      tx(100 + index),
    );
    const { adapter, stored } = harness(
      lists(
        all,
        all.map((item) => pay(item, 1, { from: other, to: wallet, units: 1n })),
      ),
    );
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: TX_PAGE * MAX_STELLAR_TRANSACTION_PAGES,
    });
    const last = all[TX_PAGE * MAX_STELLAR_TRANSACTION_PAGES - 1];
    expect(stored.readTo).toBe(last.toid.toString());
  });

  it('STELLAR-SYNC keeps the transaction whose payments may go on past the page budget', async () => {
    const first = tx(100);
    const second = tx(101);
    const many = Array.from({ length: PAY_PAGE * MAX_STELLAR_PAYMENT_PAGES }, (_, index) =>
      pay(index < 3 ? first : second, index + 1, { from: other, to: wallet, units: 1n }),
    );
    const { adapter, stored } = harness(lists([first, second], many));
    await expect(adapter.step('o', 'a')).resolves.toEqual({
      outcome: 'partial',
      reason: null,
      imported: 1,
    });
    expect(stored.events[0]).toEqual(['insert', [first.hash, '3', '0', '0']]);
    expect(stored.readTo).toBe(first.toid.toString());
  });

  it('STELLAR-SYNC refuses a page budget spent inside the first transaction', async () => {
    const first = tx(100);
    const many = Array.from({ length: PAY_PAGE * MAX_STELLAR_PAYMENT_PAGES }, (_, index) =>
      pay(first, index + 1, null),
    );
    const { adapter, stored } = harness(lists([first], many));
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ reason: 'invalid_response' });
    expect(stored.events).toEqual([]);
  });

  it('STELLAR-SYNC refuses a payment that names its transaction by another hash', async () => {
    const first = tx(100);
    const { adapter } = harness(lists([first], [{ ...pay(first, 1, null), hash: 'f'.repeat(64) }]));
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ reason: 'invalid_response' });
  });

  it('STELLAR-SYNC refuses a payment of a transaction the list did not name', async () => {
    const first = tx(100);
    const second = tx(101);
    const hidden = tx(100, other, 2);
    const { adapter } = harness(
      lists([first, second], [pay(first, 1, null), pay(hidden, 1, null), pay(second, 1, null)]),
    );
    await expect(adapter.step('o', 'a')).resolves.toMatchObject({ reason: 'invalid_response' });
  });
});

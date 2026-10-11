import type { StellarPayment, StellarTransaction } from './horizon-client';
import { stellarLeg } from './stellar-legs';

// Synthetic accounts: the legs compare text only, so short placeholders do.
const wallet = 'G-WALLET';
const other = 'G-OTHER';
const hash = (digit: string) => digit.repeat(64);
const TOID = 1n << 44n;

const transaction = (extra: Partial<StellarTransaction> = {}): StellarTransaction => ({
  hash: hash('1'),
  toid: TOID,
  ledger: 4096,
  createdAt: '2026-10-01T10:00:00.000Z',
  successful: true,
  feeAccount: other,
  feeCharged: 100n,
  raw: { hash: hash('1') },
  ...extra,
});
const operation = (
  moves: StellarPayment['moves'],
  index = 1,
  merge: StellarPayment['merge'] = null,
): StellarPayment => ({
  id: TOID + BigInt(index),
  transaction: TOID,
  hash: hash('1'),
  type: merge ? 'account_merge' : 'payment',
  moves,
  merge,
  raw: { id: String(TOID + BigInt(index)) },
});

describe('STELLAR-IDENTITY: the XLM leg of a transaction', () => {
  it('records XLM received under the bare hash; the sender paid the fee', () => {
    const leg = stellarLeg(wallet, transaction(), [
      { payment: operation([{ from: other, to: wallet, units: 50n }]), merged: null },
    ]);
    expect(leg).toMatchObject({
      txid: hash('1'),
      asset: null,
      blockHeight: 4096,
      blockTime: '2026-10-01T10:00:00.000Z',
      receivedUnits: 50n,
      sentUnits: 0n,
      feeUnits: 0n,
      direction: 'in',
    });
  });

  it('adds the fee the wallet paid to what it sent, over every operation', () => {
    const leg = stellarLeg(wallet, transaction({ feeAccount: wallet, feeCharged: 200n }), [
      { payment: operation([{ from: wallet, to: other, units: 30n }], 1), merged: null },
      { payment: operation([{ from: wallet, to: other, units: 20n }], 2), merged: null },
    ]);
    expect(leg).toMatchObject({
      receivedUnits: 0n,
      sentUnits: 250n,
      feeUnits: 200n,
      direction: 'out',
    });
    expect(leg?.raw.operations).toHaveLength(2);
  });

  it('keeps only the fee of a failed transaction', () => {
    expect(
      stellarLeg(wallet, transaction({ successful: false, feeAccount: wallet }), []),
    ).toMatchObject({ receivedUnits: 0n, sentUnits: 100n, feeUnits: 100n, direction: 'out' });
  });

  it('reads a merge into the wallet by its effect amount', () => {
    const leg = stellarLeg(wallet, transaction(), [
      { payment: operation([], 1, { from: other, into: wallet }), merged: 70n },
    ]);
    expect(leg).toMatchObject({ receivedUnits: 70n, direction: 'in' });
    expect(leg?.raw.operations).toEqual([expect.objectContaining({ merged_amount: '70' })]);
    expect(() =>
      stellarLeg(wallet, transaction(), [
        { payment: operation([], 1, { from: other, into: wallet }), merged: null },
      ]),
    ).toThrow();
  });

  it('marks a payment to itself as self', () => {
    expect(
      stellarLeg(wallet, transaction({ feeAccount: wallet }), [
        { payment: operation([{ from: wallet, to: wallet, units: 5n }]), merged: null },
      ]),
    ).toMatchObject({ receivedUnits: 5n, sentUnits: 105n, direction: 'self' });
  });

  it('gives no leg to a transaction that moved no XLM of the wallet', () => {
    // Someone else paid the fee of an issued-asset payment to the wallet.
    expect(
      stellarLeg(wallet, transaction(), [{ payment: operation([]), merged: null }]),
    ).toBeNull();
  });

  it('refuses an operation of another transaction', () => {
    expect(() =>
      stellarLeg(wallet, transaction(), [
        { payment: { ...operation([]), transaction: TOID + 4096n }, merged: null },
      ]),
    ).toThrow();
  });
});

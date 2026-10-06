import { UnprocessableEntityException } from '@nestjs/common';
import { type MatchableLeg, type OwnLeg, ownTransferPairs, planTransfer } from './chain-transfer';

// Synthetic ids and amounts only (link-own-transfers, XFER-*).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const txid = (n: number) => String(n).padStart(64, 'b');
const [walletA, walletB, accountA, accountB, bybit] = [id(1), id(2), id(10), id(11), id(12)];
// XFER-AUTO: A sends 0.5 BTC to B; 0.5001 BTC leaves A, the 0.0001 BTC fee included.
const sent: OwnLeg & { accountId: string } = {
  addressId: walletA,
  accountId: accountA,
  network: 'bitcoin',
  receivedUnits: '0',
  sentUnits: '50010000',
  feeUnits: '10000',
};
const received: OwnLeg & { accountId: string } = {
  addressId: walletB,
  accountId: accountB,
  network: 'bitcoin',
  receivedUnits: '50000000',
  sentUnits: '0',
  feeUnits: '10000',
};
const matchable = (leg: OwnLeg, overrides: Partial<MatchableLeg> = {}): MatchableLeg => ({
  ...leg,
  txid: txid(1),
  status: null,
  ...overrides,
});

describe('link-own-transfers plan', () => {
  it('XFER-AUTO: the sending leg moves 0.5 BTC to B and pays the 0.0001 BTC fee', () => {
    const plan = {
      fromAccountId: accountA,
      toAccountId: accountB,
      quantity: '0.5',
      feeQuantity: '0.0001',
    };
    expect(planTransfer(sent, accountB, received)).toEqual(plan);
    // The receiving leg names the same transfer, its fee paid by the sender.
    expect(planTransfer(received, accountA, sent)).toEqual(plan);
  });

  it('XFER-MANUAL: a send to an untracked account moves the amount less the fee', () => {
    expect(planTransfer(sent, bybit, null)).toEqual({
      fromAccountId: accountA,
      toAccountId: bybit,
      quantity: '0.5',
      feeQuantity: '0.0001',
    });
    // A receipt from an untracked account arrives whole; its fee is not the owner's.
    expect(planTransfer(received, bybit, null)).toEqual({
      fromAccountId: bybit,
      toAccountId: accountB,
      quantity: '0.5',
      feeQuantity: '0',
    });
  });

  it('refuses a transfer to its own account, a mismatch or nothing moved', () => {
    expect(() => planTransfer(sent, accountA, null)).toThrow(
      'Choose an account other than the one of this wallet',
    );
    const short = { ...received, receivedUnits: '49990000' };
    expect(() => planTransfer(sent, accountB, short)).toThrow(
      'The other wallet did not receive what this one sent, less the network fee',
    );
    expect(() => planTransfer(received, accountA, { ...sent, sentUnits: '50020000' })).toThrow(
      UnprocessableEntityException,
    );
    expect(() => planTransfer({ ...sent, sentUnits: '0' }, bybit, null)).toThrow(
      UnprocessableEntityException,
    );
    // A send of only the fee moves nothing to the other account.
    expect(() => planTransfer({ ...sent, sentUnits: '10000' }, bybit, null)).toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('link-own-transfers automatic matching (D7)', () => {
  it('XFER-AUTO: one send and one receipt between two accounts of the owner are a pair', () => {
    const outgoing = matchable(sent);
    const incoming = matchable(received, { status: 'unclassified' });
    expect(ownTransferPairs([incoming, outgoing])).toEqual([{ outgoing, incoming }]);
  });

  it('XFER-UNKNOWN: a send with no own receiver, or anything uncertain, is not linked', () => {
    expect(ownTransferPairs([matchable(sent)])).toEqual([]);
    const uncertain: MatchableLeg[][] = [
      // The receiver got less than was sent less the fee.
      [matchable(sent), matchable({ ...received, receivedUnits: '40000000' })],
      // An address without an account.
      [matchable(sent), matchable({ ...received, accountId: null })],
      // Both addresses in the same account.
      [matchable(sent), matchable({ ...received, accountId: accountA })],
      // The owner already answered one leg.
      [matchable(sent), matchable(received, { status: 'classified' })],
      [matchable(sent, { status: 'hidden' }), matchable(received)],
      // A third address of the owner received too.
      [
        matchable(sent),
        matchable(received),
        matchable({ ...received, addressId: id(3), accountId: bybit }),
      ],
      // Different transactions.
      [matchable(sent), matchable(received, { txid: txid(2) })],
    ];
    for (const legs of uncertain) expect(ownTransferPairs(legs)).toEqual([]);
  });
});

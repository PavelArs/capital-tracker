import { UnprocessableEntityException } from '@nestjs/common';
import {
  type MatchableLeg,
  type OwnLeg,
  ownTransferPairs,
  pairAmounts,
  pairFits,
  planTransfer,
  proposeTransferPairs,
  sameTransaction,
  type TimedLeg,
} from './chain-transfer';

// Synthetic ids and amounts only (link-own-transfers, XFER-*).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const txid = (n: number) => String(n).padStart(64, 'b');
const [walletA, walletB, accountA, accountB, bybit] = [id(1), id(2), id(10), id(11), id(12)];
// XFER-AUTO: A sends 0.5 BTC to B; 0.5001 BTC leaves A, the 0.0001 BTC fee included.
const sent: OwnLeg & { accountId: string } = {
  addressId: walletA,
  accountId: accountA,
  network: 'bitcoin',
  asset: null,
  receivedUnits: '0',
  sentUnits: '50010000',
  feeUnits: '10000',
};
const received: OwnLeg & { accountId: string } = {
  addressId: walletB,
  accountId: accountB,
  network: 'bitcoin',
  asset: null,
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

describe('link-own-transfers of Ethereum legs (M14)', () => {
  // A sends 250 USDC to B; the ether fee is a leg of its own, so the token transfer has none.
  const token = { network: 'ethereum' as const, asset: 'USDC', feeUnits: '0' };
  const tokenSent = { ...sent, ...token, sentUnits: '250000000' };
  const tokenReceived = { ...received, ...token, receivedUnits: '250000000' };

  it('XFER-AUTO: a token transfer between two own addresses moves the tokens without a fee', () => {
    expect(planTransfer(tokenSent, accountB, tokenReceived)).toEqual({
      fromAccountId: accountA,
      toAccountId: accountB,
      quantity: '250',
      feeQuantity: '0',
    });
    const outgoing = matchable(tokenSent, { txid: `${txid(1)}-4` });
    const incoming = matchable(tokenReceived, { txid: `${txid(1)}-4` });
    expect(ownTransferPairs([outgoing, incoming])).toEqual([{ outgoing, incoming }]);
  });

  it('an ether transfer pays its fee in ether at 18 decimals', () => {
    const ether = { network: 'ethereum' as const, asset: null };
    const plan = planTransfer(
      { ...sent, ...ether, sentUnits: '1000420000000000000', feeUnits: '420000000000000' },
      accountB,
      { ...received, ...ether, receivedUnits: '1000000000000000000', feeUnits: '0' },
    );
    expect(plan).toMatchObject({ quantity: '1', feeQuantity: '0.00042' });
  });

  it('never pairs legs of different assets', () => {
    const outgoing = matchable(tokenSent);
    const incoming = matchable({ ...tokenReceived, asset: 'USDT' });
    expect(ownTransferPairs([outgoing, incoming])).toEqual([]);
  });
});

describe('link-own-transfers of Solana legs (M15)', () => {
  // A Solana token leg is the signature and the token's number on both sides.
  const signature = 'S'.repeat(87);
  const usdc = { network: 'solana' as const, asset: 'USDC', feeUnits: '0' };

  it('XFER-AUTO: an SPL USDC transfer between own wallets links by its shared leg id', () => {
    const tokenSent = { ...sent, ...usdc, sentUnits: '25000000' };
    const tokenReceived = { ...received, ...usdc, receivedUnits: '25000000' };
    const outgoing = matchable(tokenSent, { txid: `${signature}-2` });
    const incoming = matchable(tokenReceived, { txid: `${signature}-2` });
    expect(ownTransferPairs([outgoing, incoming])).toEqual([{ outgoing, incoming }]);
    expect(planTransfer(tokenSent, accountB, tokenReceived)).toMatchObject({
      quantity: '25',
      feeQuantity: '0',
    });
  });

  it('a SOL transfer pays its fee in SOL at 9 decimals', () => {
    const sol = { network: 'solana' as const, asset: null };
    const plan = planTransfer(
      { ...sent, ...sol, sentUnits: '500005000', feeUnits: '5000' },
      accountB,
      { ...received, ...sol, receivedUnits: '500000000', feeUnits: '0' },
    );
    expect(plan).toMatchObject({ quantity: '0.5', feeQuantity: '0.000005' });
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

describe('BYBIT-DEPOSIT: a Bybit account and an own wallet in one transaction (M22)', () => {
  const E18 = 10n ** 18n;
  const exchange = (units: bigint, overrides: Partial<MatchableLeg> = {}): MatchableLeg => ({
    addressId: id(20),
    accountId: bybit,
    network: 'bybit',
    asset: 'BTC',
    receivedUnits: units > 0n ? units.toString() : '0',
    sentUnits: units < 0n ? (-units).toString() : '0',
    feeUnits: '0',
    txid: txid(1),
    status: null,
    ...overrides,
  });

  it('meets a wallet leg by the hash, a token leg by the hash before its log number', () => {
    const wallet = { network: 'ethereum' as const, txid: `${txid(1)}-17` };
    expect(sameTransaction({ network: 'bybit', txid: txid(1) }, wallet)).toBe(true);
    expect(sameTransaction(wallet, { network: 'bybit', txid: txid(1) })).toBe(true);
    expect(sameTransaction({ network: 'bybit', txid: txid(2) }, wallet)).toBe(false);
    // Two wallets meet only by the exact leg id.
    expect(sameTransaction({ network: 'ethereum', txid: txid(1) }, wallet)).toBe(false);
  });

  it('D7: 0.5001 BTC leaving wallet A and 0.5 BTC credited on Bybit form one transfer', () => {
    const outgoing = matchable(sent);
    const incoming = exchange(E18 / 2n);
    expect(ownTransferPairs([outgoing, incoming])).toEqual([{ outgoing, incoming }]);
    const plan = planTransfer(sent, bybit, incoming);
    expect(plan).toMatchObject({
      fromAccountId: accountA,
      toAccountId: bybit,
      quantity: '0.5',
      feeQuantity: '0.0001',
    });
  });

  it('a Bybit withdrawal of 0.5 BTC with its 0.0002 BTC fee arrives as 0.5 BTC in wallet B', () => {
    const outgoing = exchange(-(5002n * E18) / 10000n, {
      feeUnits: ((2n * E18) / 10000n).toString(),
    });
    const incoming = matchable(received);
    expect(ownTransferPairs([incoming, outgoing])).toEqual([{ outgoing, incoming }]);
    expect(planTransfer({ ...outgoing, accountId: bybit }, accountB, received)).toMatchObject({
      quantity: '0.5',
      feeQuantity: '0.0002',
    });
  });

  it('a Bybit leg of another coin, or a different amount, is never linked', () => {
    expect(ownTransferPairs([matchable(sent), exchange(E18 / 2n, { asset: 'USDT' })])).toEqual([]);
    expect(ownTransferPairs([matchable(sent), exchange(E18 / 4n)])).toEqual([]);
    expect(() => planTransfer(sent, bybit, exchange(E18 / 2n, { asset: 'USDT' }))).toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('BYBIT-LINK-HASH: a Bybit withdrawal stored under its own identity (L2 chains)', () => {
  const E18 = 10n ** 18n;
  // Bybit's own id for the withdrawal, and the hash it names; Arbitrum's wallet leg carries the hash.
  const ownId = 'bybit-withdrawal-7000001';
  const withdrawal = (overrides: Partial<MatchableLeg> = {}): MatchableLeg => ({
    addressId: id(20),
    accountId: bybit,
    network: 'bybit',
    asset: 'ETH',
    // 0.02208814 arrives, 0.00004 is Bybit's fee.
    receivedUnits: '0',
    sentUnits: ((2212814n * E18) / 100000000n).toString(),
    feeUnits: ((4n * E18) / 100000n).toString(),
    txid: ownId,
    hash: txid(1),
    status: null,
    ...overrides,
  });
  const arrival = (overrides: Partial<MatchableLeg> = {}): MatchableLeg => ({
    addressId: walletB,
    accountId: accountB,
    network: 'arbitrum',
    asset: null,
    receivedUnits: ((2208814n * E18) / 100000000n).toString(),
    sentUnits: '0',
    feeUnits: '0',
    txid: txid(1),
    status: null,
    ...overrides,
  });

  it('meets the wallet leg by the hash the record names, not by its own identity', () => {
    const wallet = { network: 'arbitrum' as const, txid: txid(1) };
    const record = { network: 'bybit' as const, txid: ownId };
    expect(sameTransaction(record, wallet)).toBe(false);
    expect(sameTransaction({ ...record, hash: txid(1) }, wallet)).toBe(true);
    expect(sameTransaction(wallet, { ...record, hash: txid(1) })).toBe(true);
    expect(sameTransaction({ ...record, hash: txid(1) }, { ...wallet, txid: `${txid(1)}-4` })).toBe(
      true,
    );
    expect(sameTransaction({ ...record, hash: txid(2) }, wallet)).toBe(false);
    expect(sameTransaction({ ...record, hash: null }, wallet)).toBe(false);
  });

  it('XFER-AUTO: the withdrawal and the receipt are a pair, the fee being Bybit’s', () => {
    const outgoing = withdrawal();
    const incoming = arrival();
    expect(ownTransferPairs([incoming, outgoing])).toEqual([{ outgoing, incoming }]);
    expect(ownTransferPairs([incoming, withdrawal({ hash: null })])).toEqual([]);
  });

  it('XFER-REJOIN: one side answered alone as a transfer with the other account is still a pair', () => {
    const outgoing = withdrawal();
    const answered = arrival({ status: 'classified', loneTo: bybit });
    expect(ownTransferPairs([answered, outgoing])).toEqual([{ outgoing, incoming: answered }]);
    const sender = withdrawal({ status: 'classified', loneTo: accountB });
    const open = arrival();
    expect(ownTransferPairs([open, sender])).toEqual([{ outgoing: sender, incoming: open }]);
  });

  it('XFER-REJOIN: any other answer, or a transfer with a third account, is left alone', () => {
    const outgoing = withdrawal();
    for (const answer of [
      arrival({ status: 'classified', loneTo: null }),
      arrival({ status: 'classified', loneTo: id(99) }),
      arrival({ status: 'hidden', loneTo: bybit }),
    ])
      expect(ownTransferPairs([answer, outgoing])).toEqual([]);
    // Both sides answered: nothing left to join.
    expect(
      ownTransferPairs([
        arrival({ status: 'classified', loneTo: bybit }),
        withdrawal({ status: 'classified', loneTo: accountB }),
      ]),
    ).toEqual([]);
  });
});

describe('XFER-PROPOSED: a withdrawal and a receipt that name different transactions', () => {
  // A withdraws 100.5 USDT from Bybit-like account A; 100 USDT reaches B ten minutes later.
  const usdt = { network: 'ethereum' as const, asset: 'USDT', feeUnits: '0' };
  const T0 = new Date('2026-10-09T10:00:00.000Z');
  const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const out = (overrides: Partial<TimedLeg> = {}): TimedLeg => ({
    ...sent,
    ...usdt,
    sentUnits: '100500000',
    txid: txid(1),
    status: null,
    blockTime: T0,
    ...overrides,
  });
  const into = (overrides: Partial<TimedLeg> = {}): TimedLeg => ({
    ...received,
    ...usdt,
    receivedUnits: '100000000',
    txid: txid(2),
    status: null,
    blockTime: later(10),
    ...overrides,
  });

  it('pairs them, the difference being the fee of the transfer', () => {
    const [proposal] = proposeTransferPairs([into(), out()]);
    expect(pairAmounts(proposal)).toEqual({
      coin: 'USDT',
      sent: '100.5',
      arrived: '100',
      fee: '0.5',
    });
    expect(proposal.outgoing.txid).toBe(txid(1));
    expect(proposal.incoming.txid).toBe(txid(2));
  });

  it('plans the transfer from what arrived, with the difference as its fee', () => {
    const plan = planTransfer({ ...out(), accountId: accountA }, accountB, into(), true);
    expect(plan).toEqual({
      fromAccountId: accountA,
      toAccountId: accountB,
      quantity: '100',
      feeQuantity: '0.5',
    });
    // The same plan from the receiving side.
    expect(planTransfer({ ...into(), accountId: accountB }, accountA, out(), true)).toEqual(plan);
    // More arrived than left: refused.
    expect(() =>
      planTransfer(
        { ...out(), accountId: accountA },
        accountB,
        into({ receivedUnits: '100600000' }),
        true,
      ),
    ).toThrow(UnprocessableEntityException);
  });

  it('never proposes what is not certain', () => {
    const none: TimedLeg[][] = [
      // The receipt is before the withdrawal, or a day and more after it.
      [out(), into({ blockTime: later(-1) })],
      [out(), into({ blockTime: later(24 * 60 + 1) })],
      // More than 2% went missing, or more arrived than left.
      [out(), into({ receivedUnits: '98000000' })],
      [out(), into({ receivedUnits: '100600000' })],
      // Another coin, the same account, no account, or an answer already given.
      [out(), into({ asset: 'USDC' })],
      [out(), into({ accountId: accountA })],
      [out(), into({ accountId: null })],
      [out({ status: 'classified' }), into()],
      [out(), into({ status: 'hidden' })],
      // The same transaction is XFER-AUTO's.
      [out(), into({ txid: txid(1) })],
    ];
    for (const legs of none) expect(proposeTransferPairs(legs)).toEqual([]);
    expect(pairFits(out(), into({ blockTime: later(24 * 60) }))).toBe(true);
    expect(pairFits(out(), into({ receivedUnits: '98500000' }))).toBe(true);
  });

  it('leaves a leg with two equally good candidates to the owner', () => {
    const second = into({ txid: txid(3), addressId: id(4) });
    expect(proposeTransferPairs([out(), into(), second])).toEqual([]);
    // A nearer one wins, and the farther receipt stays unmatched.
    const nearer = into({ txid: txid(3), addressId: id(4), blockTime: later(2) });
    const pairs = proposeTransferPairs([out(), into(), nearer]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].incoming.txid).toBe(txid(3));
  });

  it('pairs two withdrawals with their own receipts, newest first', () => {
    const olderOut = out({ txid: txid(4), blockTime: later(-600) });
    const olderIn = into({ txid: txid(5), blockTime: later(-590) });
    const pairs = proposeTransferPairs([olderIn, olderOut, into(), out()]);
    expect(pairs.map((pair) => pair.outgoing.txid)).toEqual([txid(1), txid(4)]);
    expect(pairs.map((pair) => pair.incoming.txid)).toEqual([txid(2), txid(5)]);
  });
});

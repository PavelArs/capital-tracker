import {
  DUPLICATE_WINDOW_HOURS,
  duplicateFits,
  type Movement,
  proposeDuplicates,
  rewardAnswer,
  tradeAnswer,
} from './chain-duplicate';

const unit = 10n ** 30n;
const hour = 3_600_000;
const start = new Date('2026-09-01T10:00:00.000Z');

// CLS-DUPLICATE: a record the owner added and the transaction of a wallet that repeats it.
// Synthetic coins, accounts and amounts only.
const move = (over: Partial<Movement> = {}): Movement => ({
  accountId: 'account-a',
  coin: 'TRX',
  inbound: true,
  atoms: 100n * unit,
  at: start,
  ...over,
});
const at = (hours: number) => new Date(start.getTime() + hours * hour);

describe('CLS-DUPLICATE what can be one movement', () => {
  it('the same coin, way and account at nearly the same time and amount', () => {
    expect(duplicateFits(move(), move())).toBe(true);
    expect(duplicateFits(move(), move({ atoms: 99n * unit, at: at(-30) }))).toBe(true);
    expect(duplicateFits(move({ atoms: 100n * unit }), move({ atoms: 101n * unit }))).toBe(true);
  });

  it('not another account, coin or way', () => {
    expect(duplicateFits(move(), move({ accountId: 'account-b' }))).toBe(false);
    expect(duplicateFits(move(), move({ coin: 'ETH' }))).toBe(false);
    expect(duplicateFits(move(), move({ inbound: false }))).toBe(false);
  });

  it('not when the time or the amount is too far apart', () => {
    expect(duplicateFits(move(), move({ at: at(DUPLICATE_WINDOW_HOURS) }))).toBe(true);
    expect(duplicateFits(move(), move({ at: at(DUPLICATE_WINDOW_HOURS + 1) }))).toBe(false);
    expect(duplicateFits(move(), move({ at: at(-DUPLICATE_WINDOW_HOURS - 1) }))).toBe(false);
    expect(duplicateFits(move(), move({ atoms: 102n * unit }))).toBe(false);
    expect(duplicateFits(move(), move({ atoms: 98n * unit }))).toBe(false);
  });

  it('never an empty movement', () => {
    expect(duplicateFits(move({ atoms: 0n }), move({ atoms: 0n }))).toBe(false);
  });
});

describe('CLS-DUPLICATE which pairs are proposed', () => {
  const leg = (id: string, over: Partial<Movement> = {}) => ({ ...move(over), id });

  it('proposes a pair that is each other single closest match', () => {
    const found = proposeDuplicates([leg('l1')], [leg('r1', { at: at(2) })]);
    expect(found.map(({ leg: l, record }) => [l.id, record.id])).toEqual([['l1', 'r1']]);
  });

  it('proposes nothing when a transaction has two equally close records', () => {
    const twin = [leg('r1', { at: at(-1) }), leg('r2', { at: at(1) })];
    expect(proposeDuplicates([leg('l1')], twin)).toEqual([]);
  });

  it('prefers the record whose amount differs least, then the nearest in time', () => {
    const records = [
      leg('same-time', { atoms: 99n * unit }),
      leg('exact', { at: at(20) }),
      leg('later', { at: at(1), atoms: 99n * unit }),
    ];
    const found = proposeDuplicates([leg('l1')], records);
    expect(found.map(({ record }) => record.id)).toEqual(['exact']);
    const same = proposeDuplicates([leg('l1')], [records[0], records[2]]);
    expect(same.map(({ record }) => record.id)).toEqual(['same-time']);
  });

  it('proposes nothing when another transaction is closer to the record', () => {
    const found = proposeDuplicates(
      [leg('far', { at: at(10) }), leg('near', { at: at(1) })],
      [leg('r1')],
    );
    expect(found.map(({ leg: l }) => l.id)).toEqual(['near']);
    const rival = proposeDuplicates(
      [leg('l1', { at: at(1) }), leg('l2', { at: at(-1) })],
      [leg('r1')],
    );
    expect(rival).toEqual([]);
  });

  it('lists the newest transaction first', () => {
    const found = proposeDuplicates(
      [leg('old', { at: at(-200) }), leg('new', { at: at(200) })],
      [leg('r-old', { at: at(-200) }), leg('r-new', { at: at(200) })],
    );
    expect(found.map(({ leg: l }) => l.id)).toEqual(['new', 'old']);
  });
});

describe('CLS-DUPLICATE what a record says as an answer', () => {
  const trade = {
    side: 'buy' as const,
    grossUsd: '1000',
    feeUsd: '0',
  };

  it('a plain purchase is a buy in USD, a sale a sell', () => {
    expect(tradeAnswer(trade)).toEqual({ type: 'buy', currency: 'USD', amount: '1000' });
    expect(tradeAnswer({ ...trade, side: 'sell', feeUsd: '5' })).toEqual({
      type: 'sell',
      currency: 'USD',
      amount: '1000',
      fee: '5',
    });
  });

  it('keeps the cash it was settled in', () => {
    expect(tradeAnswer({ ...trade, settlementSymbol: 'USDT' })).toEqual({
      type: 'buy',
      currency: 'USDT',
      amount: '1000',
    });
    expect(tradeAnswer({ ...trade, settlementSymbol: 'DOGE' })).toBeNull();
  });

  it('keeps an amount stated in RUB or EUR with the rate paid', () => {
    expect(
      tradeAnswer({
        ...trade,
        paid: { currency: 'RUB', gross: '90000', fee: '100', perUsd: '90' },
      }),
    ).toEqual({ type: 'buy', currency: 'RUB', amount: '90000', fee: '100', perUsd: '90' });
  });

  it('income, expense, gifts and fees carry their value', () => {
    expect(tradeAnswer({ ...trade, purpose: 'income' })).toEqual({
      type: 'income',
      valueUsd: '1000',
    });
    expect(tradeAnswer({ ...trade, side: 'sell', purpose: 'expense' })).toEqual({
      type: 'expense',
      valueUsd: '1000',
    });
    expect(tradeAnswer({ ...trade, purpose: 'gift-received' })).toEqual({
      type: 'gift',
      valueUsd: '1000',
    });
    expect(tradeAnswer({ ...trade, side: 'sell', purpose: 'gift-sent' })).toEqual({
      type: 'gift',
      valueUsd: '1000',
    });
    expect(
      tradeAnswer({ ...trade, side: 'sell', purpose: 'fee', grossUsd: '3', feeUsd: '3' }),
    ).toEqual({ type: 'fee', valueUsd: '3' });
  });

  it('is not offered when the answer could not repeat the record', () => {
    expect(tradeAnswer({ ...trade, purpose: 'income', feeUsd: '2' })).toBeNull();
    expect(tradeAnswer({ ...trade, side: 'sell', purpose: 'fee', feeUsd: '2' })).toBeNull();
  });

  it('a reward keeps its kind and value', () => {
    const reward = {
      category: 'staking' as const,
      acquisitionBasisUsd: '12',
      incomeValueUsd: '12.0',
    };
    expect(rewardAnswer(reward)).toEqual({ type: 'staking-reward', valueUsd: '12.0' });
    expect(rewardAnswer({ ...reward, category: 'airdrop' })).toEqual({
      type: 'airdrop',
      valueUsd: '12.0',
    });
    expect(rewardAnswer({ ...reward, category: 'other' })).toEqual({
      type: 'reward',
      valueUsd: '12.0',
    });
    expect(
      rewardAnswer({ category: 'other', acquisitionBasisUsd: null, incomeValueUsd: null }),
    ).toEqual({ type: 'reward', valueUsd: null });
    expect(
      rewardAnswer({ category: 'unclassified', acquisitionBasisUsd: null, incomeValueUsd: null }),
    ).toEqual({ type: 'other' });
  });

  it('a reward whose basis differs from its income is not offered', () => {
    expect(
      rewardAnswer({ category: 'staking', acquisitionBasisUsd: '10', incomeValueUsd: '12' }),
    ).toBeNull();
    expect(
      rewardAnswer({ category: 'unclassified', acquisitionBasisUsd: '1', incomeValueUsd: null }),
    ).toBeNull();
  });
});

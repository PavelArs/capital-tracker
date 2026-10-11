import {
  carryTime,
  type PurchaseRecord,
  recordMoves,
  swapCoins,
  tradeCoins,
  unpaidFor,
} from './chain-recorded';

// CLS-RECORDED: which way a manual or CSV record moved each coin. Synthetic symbols only.
describe('CLS-RECORDED record coins', () => {
  it('a buy paid in USDT received the coin and spent the USDT', () => {
    const coins = tradeCoins('buy', 'eth', 'USDT');
    expect(recordMoves(coins, 'ETH', true)).toBe(true);
    expect(recordMoves(coins, 'usdt', false)).toBe(true);
    expect(recordMoves(coins, 'ETH', false)).toBe(false);
    expect(recordMoves(coins, 'USDT', true)).toBe(false);
    expect(recordMoves(coins, 'BTC', true)).toBe(false);
  });

  it('a sale for USDC spent the coin and received the USDC', () => {
    const coins = tradeCoins('sell', 'BTC', 'USDC');
    expect(recordMoves(coins, 'BTC', false)).toBe(true);
    expect(recordMoves(coins, 'USDC', true)).toBe(true);
    expect(recordMoves(coins, 'BTC', true)).toBe(false);
  });

  it('a buy without a cash asset spent nothing a wallet could send', () => {
    const coins = tradeCoins('buy', 'SOL', null);
    expect(recordMoves(coins, 'SOL', true)).toBe(true);
    expect(recordMoves(coins, 'SOL', false)).toBe(false);
  });

  it('a swap spent what it paid and received what it got', () => {
    const coins = swapCoins('USDT', 'BTC');
    expect(recordMoves(coins, 'USDT', false)).toBe(true);
    expect(recordMoves(coins, 'BTC', true)).toBe(true);
    expect(recordMoves(coins, 'BTC', false)).toBe(false);
  });
});

// CLS-PAID: USDT or USDC sent from one wallet to pay for a purchase made by hand elsewhere.
describe('CLS-PAID purchases paid from another wallet', () => {
  const purchase = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
    side: 'buy',
    asset: 'ZEC',
    cash: 'USDT',
    cashSpent: 0n,
    total: 300n * 10n ** 30n,
    other: false,
    ...over,
  });

  it('a purchase nothing has paid yet is owed its whole cost', () => {
    expect(unpaidFor(purchase(), 'usdt')).toBe(300n * 10n ** 30n);
    expect(unpaidFor(purchase({ cash: null }), 'USDC')).toBe(300n * 10n ** 30n);
  });

  it('only the part the account cash did not pay is owed', () => {
    expect(unpaidFor(purchase({ cashSpent: 100n * 10n ** 30n }), 'USDT')).toBe(200n * 10n ** 30n);
  });

  it('refuses a purchase the account cash paid in full', () => {
    expect(() => unpaidFor(purchase({ cashSpent: 300n * 10n ** 30n }), 'USDT')).toThrow(
      'That purchase was already paid from the cash of its account',
    );
  });

  it('refuses sales, entries that are not settled in coins and other cash', () => {
    expect(() => unpaidFor(purchase({ side: 'sell' }), 'USDT')).toThrow('Only a purchase paid');
    expect(() => unpaidFor(purchase({ other: true }), 'USDT')).toThrow('Only a purchase paid');
    expect(() => unpaidFor(purchase(), 'ETH')).toThrow('Only USDT or USDC');
    expect(() => unpaidFor(purchase({ cash: 'USDC', cashSpent: 1n * 10n ** 30n }), 'USDT')).toThrow(
      'That purchase was paid with USDC',
    );
    // Cash of another kind that nothing was taken from does not stand in the way.
    expect(unpaidFor(purchase({ cash: 'USDC', cashSpent: 0n }), 'USDT')).toBe(300n * 10n ** 30n);
  });

  it('the coins reach the purchase just before it unless they were sent earlier', () => {
    const sent = new Date('2026-09-01T10:00:00.000Z');
    const earlier = new Date('2026-08-31T10:00:00.000Z');
    const later = new Date('2026-09-02T10:00:00.000Z');
    expect(carryTime(sent, later)).toEqual(sent);
    expect(carryTime(sent, earlier).toISOString()).toBe('2026-08-31T09:59:59.999Z');
    expect(carryTime(sent, sent).toISOString()).toBe('2026-09-01T09:59:59.999Z');
  });
});

import { recordMoves, swapCoins, tradeCoins } from './chain-recorded';

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

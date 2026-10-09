import { forgetTokens, otherTokenByTicker, rememberTokens } from './chain-assets';
import { copiesTrackedCoin } from './chain-tokens';
import { hiddenReason } from './token-visibility';

// Synthetic contracts only (TOKEN-HIDE).
const contract = `0x${'7f3a'.repeat(10)}`;
const other = `0x${'9c1d'.repeat(10)}`;

describe('TOKEN-HIDE: which tokens an address leaves out', () => {
  const plain = { token: contract };

  it('shows a token the address really holds', () => {
    expect(hiddenReason(plain, 5n, [], [])).toBeNull();
  });

  it('hides a negative balance: the history cannot send what the wallet never held', () => {
    expect(hiddenReason(plain, -3000n, [], [])).toBe('negative');
  });

  it('hides a token that copies the symbol of a tracked coin', () => {
    expect(hiddenReason({ token: contract, lookalike: true }, 40n, [], [])).toBe('lookalike');
    expect(hiddenReason({ token: contract, lookalike: false }, 40n, [], [])).toBeNull();
  });

  it('hides what the owner hid, whatever the balance', () => {
    expect(hiddenReason(plain, 5n, [contract], [])).toBe('owner');
    expect(hiddenReason(plain, -5n, [contract], [])).toBe('owner');
    expect(hiddenReason(plain, 5n, [other], [])).toBeNull();
  });

  it('shows what the owner brought back, even a negative or copied one', () => {
    expect(hiddenReason(plain, -5n, [], [contract])).toBeNull();
    expect(hiddenReason({ token: contract, lookalike: true }, 5n, [], [contract])).toBeNull();
  });
});

describe('TOKEN-HIDE: how a token copies a tracked coin', () => {
  it.each(['USDT', 'usdt', 'USDC', 'ETH', 'SOL', 'BTC', 'TRX', 'USD', ' U.S.D.T '])(
    'treats %s as a copy',
    (symbol) => expect(copiesTrackedCoin(symbol)).toBe(true),
  );

  it.each(['WETH', 'USDT.e', 'ETHG', 'HEX', 'T', ''])('treats %s as its own token', (symbol) =>
    expect(copiesTrackedCoin(symbol)).toBe(false),
  );
});

describe('TOKEN-HIDE: finding a token by its ticker', () => {
  afterEach(() => forgetTokens());

  it('finds an other token of the network, and nothing else', () => {
    rememberTokens([
      {
        network: 'ethereum',
        token: contract,
        symbol: 'SYN',
        name: 'Synthetic',
        decimals: 18,
        contract,
      },
    ]);
    expect(otherTokenByTicker('ethereum', 'SYN')?.token).toBe(contract);
    expect(otherTokenByTicker('solana', 'SYN')).toBeUndefined();
    expect(otherTokenByTicker('ethereum', 'USDT')).toBeUndefined();
  });
});

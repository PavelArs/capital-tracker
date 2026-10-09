import {
  chainAsset,
  forgetTokens,
  isOtherToken,
  isUnlistedToken,
  rememberTokens,
} from './chain-assets';
import { countableLegs, newTicker, reservedTickers, storedFacts, tokenText } from './chain-tokens';

// Synthetic contracts only (TOKEN-ANY).
const contract = `0x${'7f3a'.repeat(10)}`;
const mint = 'Syn1111111111111111111111111111111111111111';

describe('TOKEN-ANY: how an other token is named', () => {
  afterEach(() => forgetTokens());

  it('keeps the symbol the chain gives as the ticker when no asset has it', () => {
    expect(newTicker('Syn', contract, () => false)).toBe('SYN');
    expect(newTicker('wSOL', mint, () => false)).toBe('WSOL');
  });

  it('appends the start of the contract when another asset has the ticker', () => {
    const taken = (ticker: string) => reservedTickers.has(ticker);
    // A token calling itself USDT from a contract that is not Tether's never adds to USDT.
    expect(newTicker('USDT', contract, taken)).toBe('USDT7F3A');
    expect(newTicker('ETH', contract, taken)).toBe('ETH7F3A');
    expect(newTicker('USD', mint, taken)).toBe('USDSYN1');
    const more = new Set(['USDT', 'USDT7F3A']);
    expect(newTicker('USDT', contract, (ticker) => more.has(ticker))).toBe('USDT7F3A7');
  });

  it('makes a ticker of 2 to 15 capitals and digits from any symbol', () => {
    expect(newTicker('$ Visit claim-site.example', contract, () => false)).toBe('VISITCLAIM');
    expect(newTicker('é', contract, () => false)).toBe('T');
    expect(newTicker('x', contract, () => false)).toBe('TX');
    // With every longer form taken, the contract alone after one letter: still unique.
    expect(newTicker('x', contract, (ticker) => ticker !== 'T7F3A7F3A7F3A7F')).toBe(
      'T7F3A7F3A7F3A7F',
    );
    for (const ticker of ['SYN', 'USDT7F3A', 'VISITCLAIM', 'TX'])
      expect(ticker).toMatch(/^[A-Z0-9]{2,15}$/);
  });

  it('cleans the text a token chose and falls back to its name or contract', () => {
    expect(tokenText(' Fake\u0000  Token‮ ', 64)).toBe('Fake Token');
    expect(tokenText('   ', 64)).toBeNull();
    expect(tokenText(42, 64)).toBeNull();
    expect(tokenText('a'.repeat(80), 32)).toBe('a'.repeat(32));
    const base = { network: 'ethereum' as const, contract, decimals: 18 };
    expect(storedFacts({ ...base, symbol: 'SYN', name: null })).toEqual({
      symbol: 'SYN',
      name: 'SYN',
    });
    expect(storedFacts({ ...base, symbol: null, name: 'Synthetic' })).toEqual({
      symbol: 'Synthetic',
      name: 'Synthetic',
    });
    expect(storedFacts({ ...base, symbol: null, name: null })).toEqual({
      symbol: '7F3A7F',
      name: '7F3A7F',
    });
  });

  it('finds a remembered token by network and contract, and knows whether it is listed', () => {
    expect(() => chainAsset('ethereum', contract)).toThrow('Unknown chain asset');
    rememberTokens([
      {
        network: 'ethereum',
        token: contract,
        symbol: 'SYN',
        name: 'Synthetic',
        decimals: 18,
        contract,
        listed: false,
      },
    ]);
    expect(chainAsset('ethereum', contract)).toMatchObject({ symbol: 'SYN', decimals: 18 });
    expect(() => chainAsset('solana', contract)).toThrow('Unknown chain asset');
    expect([isOtherToken('ethereum', contract), isUnlistedToken('ethereum', contract)]).toEqual([
      true,
      true,
    ]);
    expect([isOtherToken('ethereum', 'USDT'), isUnlistedToken('ethereum', 'USDT')]).toEqual([
      false,
      false,
    ]);
    expect(isUnlistedToken('ethereum', null)).toBe(false);
  });

  it('stores only legs of the coin, USDT, USDC and the countable tokens', () => {
    const legs = [{ asset: null }, { asset: 'USDC' }, { asset: contract }, { asset: mint }];
    expect(countableLegs('ethereum', legs, new Set([contract]))).toEqual(legs.slice(0, 3));
    expect(countableLegs('ethereum', legs, new Set())).toEqual(legs.slice(0, 2));
  });
});

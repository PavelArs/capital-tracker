import {
  chainAsset,
  forgetTokens,
  isBybitCoin,
  isOtherToken,
  isUnlistedToken,
  rememberTokens,
} from './chain-assets';
import {
  countableLegs,
  loadChainTokens,
  MIN_TOKEN_TICKER,
  newTicker,
  reservedTickers,
  storedFacts,
  tokenText,
} from './chain-tokens';

// Synthetic contracts only (TOKEN-ANY).
const contract = `0x${'7f3a'.repeat(10)}`;
const mint = 'Syn1111111111111111111111111111111111111111';

describe('TOKEN-ANY: how an other token is named', () => {
  afterEach(() => forgetTokens());

  it('TOKEN-TICKER keeps the symbol the chain gives and appends the contract to 9 characters', () => {
    expect(newTicker('Syn', contract, () => false)).toBe('SYN7F3A7F');
    expect(newTicker('wSOL', mint, () => false)).toBe('WSOLSYN11');
    // A symbol 9 characters long or more needs nothing appended.
    expect(newTicker('$ Visit claim-site.example', contract, () => false)).toBe('VISITCLAIM');
  });

  it('appends more of the contract when another asset has the ticker', () => {
    const taken = (ticker: string) => reservedTickers.has(ticker);
    // A token calling itself USDT from a contract that is not Tether's never adds to USDT.
    expect(newTicker('USDT', contract, taken)).toBe('USDT7F3A7');
    expect(newTicker('ETH', contract, taken)).toBe('ETH7F3A7F');
    expect(newTicker('USD', mint, taken)).toBe('USDSYN111');
    const more = new Set(['USDT7F3A7']);
    expect(newTicker('USDT', contract, (ticker) => more.has(ticker))).toBe('USDT7F3A7F');
  });

  it('TOKEN-TICKER makes a ticker of 9 to 15 capitals and digits, never an exchange code', () => {
    expect(newTicker('é', contract, () => false)).toBe('T7F3A7F3A');
    expect(newTicker('x', contract, () => false)).toBe('TX7F3A7F3');
    // With every longer form taken, the contract alone after one letter: still unique.
    expect(newTicker('x', contract, (ticker) => ticker !== 'T7F3A7F3A7F3A7F')).toBe(
      'T7F3A7F3A7F3A7F',
    );
    const tickers = ['SYN', 'USDT', 'ETH', 'é', 'x', 'BTC', 'a1', 'PEPE', 'Visit claim'].flatMap(
      (symbol) => [contract, mint].map((source) => newTicker(symbol, source, () => false)),
    );
    for (const ticker of tickers) {
      expect(ticker).toMatch(/^[A-Z0-9]{9,15}$/);
      expect(ticker.length).toBeGreaterThanOrEqual(MIN_TOKEN_TICKER);
      expect(isBybitCoin(ticker)).toBe(false);
    }
  });

  it('TOKEN-TICKER remembers no reading of the tokens that ends after one begun later', async () => {
    const row = (ticker: string) => ({
      network: 'ethereum',
      contract,
      symbol: 'SYN',
      name: 'Synthetic',
      decimals: 18,
      ticker,
      coingeckoId: null,
    });
    const answers: ((rows: unknown[]) => void)[] = [];
    const manager = {
      query: () => new Promise<unknown[]>((resolve) => answers.push(resolve)),
    } as never;
    // A reading begun before a rename answers last, with the ticker the token gave up.
    const before = loadChainTokens(manager);
    const after = loadChainTokens(manager);
    answers[1]([row('SYN7F3A7F')]);
    await after;
    answers[0]([row('SYN')]);
    await before;
    expect(chainAsset('ethereum', contract).symbol).toBe('SYN7F3A7F');
    // A reading begun later is remembered again.
    const next = loadChainTokens(manager);
    answers[2]([row('SYN7F3A7F2')]);
    await next;
    expect(chainAsset('ethereum', contract).symbol).toBe('SYN7F3A7F2');
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

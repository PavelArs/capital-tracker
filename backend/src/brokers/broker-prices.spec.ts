import { fallbackRenames, lowestPrices, pickPrices } from './broker-prices';
import type { TBankOperation, TBankPosition } from './tbank-client';

const share = '00000000-0000-4000-8000-0000000000b1';
const venue = '00000000-0000-4000-8000-0000000000b2';
const fund = '00000000-0000-4000-8000-0000000000b3';
const held = (over: Partial<TBankPosition> = {}): TBankPosition => ({
  instrumentUid: share,
  instrumentType: 'share',
  quantity: '6',
  averagePrice: '250',
  averagePriceCurrency: 'rub',
  currentPrice: '305.57',
  currentPriceCurrency: 'rub',
  virtual: false,
  expiresAt: '',
  ...over,
});
const operation = (over: Partial<TBankOperation> = {}): TBankOperation => ({
  id: '100000001',
  parentId: '',
  state: 'executed',
  type: 'OPERATION_TYPE_BUY',
  occurredAt: '2024-03-01T12:00:00Z',
  instrumentUid: fund,
  instrumentType: 'etf',
  ticker: 'SYNTH',
  quantity: '2',
  payment: '-100',
  paymentCurrency: 'rub',
  price: '50',
  priceCurrency: 'rub',
  commission: '',
  commissionCurrency: '',
  fills: [],
  ...over,
});

describe('BPR-PICK only usable T-Bank prices of linked securities are kept', () => {
  const linked = new Map([
    [share, 'instrument-share'],
    [fund, 'instrument-fund'],
  ]);

  it('keeps the RUB price of a held linked share exactly as T-Bank wrote it', () => {
    expect(pickPrices([held()], linked)).toEqual([
      { instrumentId: 'instrument-share', price: '305.57', currency: 'RUB' },
    ]);
  });

  it('keeps nothing without a price, in another currency, for a gift, a futures or unlinked', () => {
    expect(
      pickPrices(
        [
          held({ currentPrice: '', currentPriceCurrency: '' }),
          held({ instrumentUid: fund, instrumentType: 'etf', currentPriceCurrency: 'cny' }),
          held({ virtual: true }),
          held({ instrumentType: 'futures' }),
          held({ instrumentUid: venue }),
        ],
        linked,
      ),
    ).toEqual([]);
  });

  it('keeps nothing for a zero or negative price or a position not held', () => {
    expect(
      pickPrices(
        [
          held({ currentPrice: '0' }),
          held({ instrumentUid: fund, instrumentType: 'etf', currentPrice: '-1' }),
        ],
        linked,
      ),
    ).toEqual([]);
    expect(pickPrices([held({ quantity: '0' })], linked)).toEqual([]);
    expect(pickPrices([held({ quantity: '-1' })], linked)).toEqual([]);
  });

  it('keeps the lower price when two venues of one asset are both held', () => {
    // Both venue rows carry the asset's one canonical UID after identity resolution.
    expect(
      pickPrices(
        [
          held({ currentPrice: '305.6' }),
          held({ providerInstrumentUid: venue, currentPrice: '305.57' }),
        ],
        linked,
      ),
    ).toEqual([{ instrumentId: 'instrument-share', price: '305.57', currency: 'RUB' }]);
  });

  it('keeps the lower price of one asset held in two accounts', () => {
    expect(
      lowestPrices([
        { instrumentId: 'instrument-share', price: '305.6', currency: 'RUB' },
        { instrumentId: 'instrument-share', price: '305.57', currency: 'RUB' },
        { instrumentId: 'instrument-fund', price: '10', currency: 'RUB' },
      ]),
    ).toEqual([
      { instrumentId: 'instrument-fund', price: '10', currency: 'RUB' },
      { instrumentId: 'instrument-share', price: '305.57', currency: 'RUB' },
    ]);
  });

  it('keeps nothing for an asset whose venues name two currencies', () => {
    expect(
      pickPrices(
        [held(), held({ providerInstrumentUid: venue, currentPriceCurrency: 'usd' })],
        linked,
      ),
    ).toEqual([]);
  });
});

describe('BPR-RENAME a fallback name learns the ticker T-Bank names', () => {
  const fallback = {
    uid: fund,
    assetUid: null,
    instrumentType: 'etf',
    id: 'instrument-fund',
    name: `T-Bank ${fund}`,
    symbol: null,
  };

  it('names the fund by the ticker of its operations', () => {
    expect(fallbackRenames([fallback], [operation()])).toEqual([
      { instrumentId: 'instrument-fund', ticker: 'SYNTH' },
    ]);
  });

  it('finds the ticker through another venue of the same instrument', () => {
    expect(
      fallbackRenames(
        [fallback],
        [operation({ instrumentUid: venue, providerInstrumentUid: fund, ticker: 'SYNTH' })],
      ),
    ).toEqual([{ instrumentId: 'instrument-fund', ticker: 'SYNTH' }]);
  });

  it('leaves an owner-chosen or ticker-named asset as it is', () => {
    expect(
      fallbackRenames(
        [
          { ...fallback, name: 'My fund' },
          { ...fallback, symbol: 'OLD' },
        ],
        [operation()],
      ),
    ).toEqual([]);
  });

  it('leaves it when no operation names a ticker or two operations disagree', () => {
    expect(fallbackRenames([fallback], [operation({ ticker: '' })])).toEqual([]);
    expect(
      fallbackRenames([fallback], [operation(), operation({ id: '100000002', ticker: 'OTHER' })]),
    ).toEqual([]);
  });
});

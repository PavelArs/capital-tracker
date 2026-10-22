import type { TBankOperation, TBankPosition } from './tbank-client';
import { planImport } from './tbank-import-plan';
import { positionIdentities } from './tbank-position-identities';

const position = '00000000-0000-4000-8000-000000000001';
const old = '00000000-0000-4000-8000-000000000002';
const current = '00000000-0000-4000-8000-000000000003';
const buy: TBankOperation = {
  id: '100000001',
  parentId: '',
  state: 'executed',
  type: 'OPERATION_TYPE_BUY',
  occurredAt: '2024-03-01T12:00:00Z',
  instrumentUid: old,
  positionUid: position,
  instrumentType: 'share',
  ticker: 'SYNTH',
  quantity: '2',
  payment: '-100',
  paymentCurrency: 'rub',
  price: '50',
  priceCurrency: 'rub',
  commission: '',
  commissionCurrency: '',
  fills: [],
};
const sell: TBankOperation = {
  ...buy,
  id: '100000002',
  type: 'OPERATION_TYPE_SELL',
  occurredAt: '2024-03-02T12:00:00Z',
  instrumentUid: current,
  payment: '120',
};
const holding: TBankPosition = {
  instrumentUid: current,
  positionUid: position,
  instrumentType: 'share',
  quantity: '1',
  averagePrice: '50',
  averagePriceCurrency: 'rub',
  currentPrice: '60',
  currentPriceCurrency: 'rub',
  virtual: false,
  expiresAt: '',
};

it('BROKER-POSITION-ID imports a sale through another trading mode using the same position, preserving original identity', () => {
  expect(planImport([buy, sell]).skipped).toMatchObject([{ reason: 'not-held' }]);
  const result = positionIdentities([buy, { ...sell, quantity: '1', payment: '60' }], [holding]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected consistent identities');
  expect(result.value.operations[0]).toMatchObject({
    instrumentUid: current,
    providerInstrumentUid: old,
  });
  expect(planImport(result.value.operations).skipped).toEqual([]);
  expect(buy.instrumentUid).toBe(old);
});

it('BROKER-POSITION-ID never joins by ticker, FIGI or different positions, and keeps cash separate', () => {
  for (const other of [undefined, '00000000-0000-4000-8000-000000000004']) {
    const result = positionIdentities([buy, { ...sell, positionUid: other }], []);
    if (!result.ok) throw new Error('Expected distinct identities');
    expect(planImport(result.value.operations).skipped).toMatchObject([{ reason: 'not-held' }]);
  }
  const cash = positionIdentities(
    [
      { ...buy, instrumentType: 'currency' },
      { ...sell, instrumentType: 'currency' },
    ],
    [],
  );
  expect(cash.ok && cash.value.operations.map((row) => row.instrumentUid)).toEqual([old, current]);
});

it('BROKER-POSITION-ID rejects conflicting position metadata and ambiguous current holdings', () => {
  expect(positionIdentities([buy, { ...buy, positionUid: current }], []).ok).toBe(false);
  expect(positionIdentities([buy, { ...sell, instrumentType: 'bond' }], []).ok).toBe(false);
  expect(positionIdentities([buy, sell], [holding, { ...holding, instrumentUid: old }]).ok).toBe(
    false,
  );
  for (const instrumentType of ['bond', 'currency']) {
    expect(
      positionIdentities([buy, sell, { ...buy, positionUid: undefined, instrumentType }], [holding])
        .ok,
    ).toBe(false);
  }
});

it('BROKER-ASSET-ID joins a fund bought on the exchange and sold on another venue: one asset, two positions', () => {
  // As T-Bank answered for a real fund: bought as TITR on TQTF, sold as TITR@ on SPBRU. Each
  // venue is its own position, but both name the same asset.
  const asset = '00000000-0000-4000-8000-0000000000a1';
  const venue = '00000000-0000-4000-8000-000000000005';
  const bought = { ...buy, assetUid: asset };
  const sold = { ...sell, positionUid: venue, assetUid: asset };
  const result = positionIdentities([bought, sold], []);
  if (!result.ok) throw new Error('Expected one asset');
  expect(planImport(result.value.operations).skipped).toEqual([]);
  // Different assets stay apart, and one instrument never names two assets.
  const apart = positionIdentities(
    [bought, { ...sold, assetUid: '00000000-0000-4000-8000-0000000000a2' }],
    [],
  );
  if (!apart.ok) throw new Error('Expected distinct assets');
  expect(planImport(apart.value.operations).skipped).toMatchObject([{ reason: 'not-held' }]);
  expect(
    positionIdentities(
      [bought, { ...bought, id: '100000003', assetUid: '00000000-0000-4000-8000-0000000000a2' }],
      [],
    ).ok,
  ).toBe(false);
  // Units still held on both venues are two real holdings of one asset, not a duplicate.
  const both = positionIdentities(
    [bought, sold],
    [
      { ...holding, instrumentUid: old, quantity: '1' },
      { ...holding, positionUid: venue },
    ],
  );
  if (!both.ok) throw new Error('Expected one asset held on two venues');
  expect(new Set(both.value.positions.map((row) => row.instrumentUid)).size).toBe(1);
  expect(new Set(both.value.operations.map((row) => row.instrumentUid)).size).toBe(1);
  // A held instrument that names no position may duplicate the other; never summed on a guess.
  const unnamed = '00000000-0000-4000-8000-000000000006';
  expect(
    positionIdentities(
      [bought, sold, { ...sold, id: '100000004', instrumentUid: unnamed, positionUid: undefined }],
      [
        { ...holding, instrumentUid: unnamed, positionUid: undefined, quantity: '1' },
        { ...holding, positionUid: venue },
      ],
    ).ok,
  ).toBe(false);
  // One position never names two assets: that would join two securities.
  expect(
    positionIdentities([bought, { ...sell, assetUid: '00000000-0000-4000-8000-0000000000a2' }], [])
      .ok,
  ).toBe(false);
});

it('BROKER-POSITION-ID chooses a deterministic identity for closed positions regardless of API page order', () => {
  const a = positionIdentities([buy, sell], []);
  const b = positionIdentities([sell, buy], []);
  expect(a.ok && b.ok && a.value.operations.map((row) => row.instrumentUid)).toEqual(
    b.ok && b.value.operations.map((row) => row.instrumentUid),
  );
});

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

it('BROKER-POSITION-ID chooses a deterministic identity for closed positions regardless of API page order', () => {
  const a = positionIdentities([buy, sell], []);
  const b = positionIdentities([sell, buy], []);
  expect(a.ok && b.ok && a.value.operations.map((row) => row.instrumentUid)).toEqual(
    b.ok && b.value.operations.map((row) => row.instrumentUid),
  );
});

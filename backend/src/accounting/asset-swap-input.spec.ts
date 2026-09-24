import { BadRequestException } from '@nestjs/common';
import {
  parseSwapAllocationQuery,
  parseSwapCorrection,
  parseSwapCreate,
  parseSwapHistoryQuery,
  parseSwapListQuery,
  parseSwapVoid,
  swapPayload,
} from './asset-swap-input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const swapId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const outgoingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const incomingId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const feeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const create = () => ({
  requestId,
  expectedJournalRevision: 4,
  assertExecuted: true,
  outgoingInstrumentId: outgoingId,
  incomingInstrumentId: incomingId,
  occurredAt: '2025-01-02T00:00:00.000Z',
  orderWithinTimestamp: 0,
  outgoingQuantity: '1.25',
  incomingQuantity: '2',
  considerationUsd: null,
  feeSource: null,
  feeInstrumentId: null,
  feeQuantity: '0',
});
const correction = () => ({ ...create(), expectedVersion: 3 });
const voidCommand = () => ({ requestId, expectedJournalRevision: 4, expectedVersion: 3 });
const invalid = (action: () => unknown) => expect(action).toThrow(BadRequestException);

describe('SWAP-INPUT strict economic command parsing', () => {
  it('canonicalizes UUIDs, time, order zero and exact decimals while preserving unknown versus known zero', () => {
    const unknown = parseSwapCreate(create());
    const equivalent = parseSwapCreate({
      ...create(),
      requestId: requestId.toUpperCase(),
      outgoingInstrumentId: outgoingId.toUpperCase(),
      incomingInstrumentId: incomingId.toUpperCase(),
      occurredAt: '2025-01-02T02:00:00+02:00',
      orderWithinTimestamp: -0,
      outgoingQuantity: '01.2500',
      incomingQuantity: '02.000',
      feeQuantity: '0.000',
    });
    expect(equivalent).toEqual(unknown);
    expect(parseSwapCreate({ ...create(), considerationUsd: '0.000' }).considerationUsd).toBe('0');
    expect(unknown.considerationUsd).toBeNull();

    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    expect(
      parseSwapCreate({
        ...create(),
        outgoingQuantity: maximum,
        incomingQuantity: maximum,
        considerationUsd: maximum,
      }).considerationUsd,
    ).toBe(maximum);
  });

  it('enforces explicit no-fee, held-fee, and incoming-fee identities and exact bounds', () => {
    expect(parseSwapCreate(create()).feeSource).toBeNull();
    expect(
      parseSwapCreate({
        ...create(),
        feeSource: 'held',
        feeInstrumentId: feeId,
        feeQuantity: '0.125',
      }),
    ).toMatchObject({ feeSource: 'held', feeInstrumentId: feeId, feeQuantity: '0.125' });
    expect(
      parseSwapCreate({
        ...create(),
        feeSource: 'incoming',
        feeInstrumentId: incomingId,
        feeQuantity: '2',
      }).feeQuantity,
    ).toBe('2');

    for (const patch of [
      { feeSource: 'held', feeInstrumentId: null, feeQuantity: '0' },
      { feeSource: null, feeInstrumentId: feeId, feeQuantity: '0' },
      { feeSource: null, feeInstrumentId: null, feeQuantity: '0.1' },
      { feeSource: 'incoming', feeInstrumentId: feeId, feeQuantity: '0.1' },
      { feeSource: 'incoming', feeInstrumentId: incomingId, feeQuantity: '2.0001' },
      {
        feeSource: 'incoming',
        feeInstrumentId: incomingId,
        incomingQuantity: '1.99',
        feeQuantity: '2',
      },
      { feeSource: 'unknown', feeInstrumentId: feeId, feeQuantity: '0.1' },
      { feeSource: 'held', feeInstrumentId: feeId, feeQuantity: '-1' },
      { feeSource: 'held', feeInstrumentId: feeId, feeQuantity: '1e-2' },
      { feeSource: 'held', feeInstrumentId: feeId, feeQuantity: 0 },
    ])
      invalid(() => parseSwapCreate({ ...create(), ...patch }));

    invalid(() => parseSwapCreate({ ...create(), outgoingInstrumentId: incomingId }));
  });

  it('requires every declared create/correction field, literal attestation and strict plain objects', () => {
    for (const key of Object.keys(create())) {
      const row: Record<string, unknown> = create();
      delete row[key];
      invalid(() => parseSwapCreate(row));
    }
    for (const key of Object.keys(correction())) {
      const row: Record<string, unknown> = correction();
      delete row[key];
      invalid(() => parseSwapCorrection(row));
    }
    for (const raw of [null, false, 'input', 1, [], Object.create(create())]) {
      invalid(() => parseSwapCreate(raw));
      invalid(() => parseSwapCorrection(raw));
      invalid(() => parseSwapVoid(raw));
    }
    for (const assertExecuted of [false, 'true', 1, null, {}, []])
      invalid(() => parseSwapCreate({ ...create(), assertExecuted }));
    for (const key of ['ownerId', 'accountId', 'canonicalPayload', 'createdAt', 'kind', 'version'])
      invalid(() => parseSwapCreate({ ...create(), [key]: requestId }));
    const withSymbol = { ...create(), [Symbol('unexpected')]: 1 };
    invalid(() => parseSwapCreate(withSymbol));
    invalid(() => parseSwapCorrection({ ...correction(), swapId }));
  });

  it('rejects raw amount, UUID, date, order and pin coercion or overflow', () => {
    for (const patch of [
      { outgoingQuantity: '0' },
      { outgoingQuantity: 1 },
      { incomingQuantity: null },
      { considerationUsd: false },
      { considerationUsd: '-1' },
      { considerationUsd: '1e3' },
      { considerationUsd: `${'9'.repeat(49)}` },
      { feeQuantity: `0.${'1'.repeat(31)}` },
      { requestId: 'not-a-uuid' },
      { outgoingInstrumentId: 42 },
      { occurredAt: '2025-02-29T00:00:00Z' },
      { occurredAt: '2025-01-02T00:00:00.0001Z' },
      { occurredAt: '2025-01-02' },
      { orderWithinTimestamp: '2' },
      { orderWithinTimestamp: -1 },
      { orderWithinTimestamp: 2147483648 },
      { expectedJournalRevision: '4' },
      { expectedJournalRevision: 10001 },
      { expectedJournalRevision: Number.NaN },
    ])
      invalid(() => parseSwapCreate({ ...create(), ...patch }));

    for (const expectedVersion of [0, '1', null, 10001, 0.5])
      invalid(() => parseSwapCorrection({ ...correction(), expectedVersion }));
    for (const expectedVersion of [0, '1', null, 10001])
      invalid(() => parseSwapVoid({ ...voidCommand(), expectedVersion }));
    invalid(() => parseSwapVoid({ ...voidCommand(), outgoingQuantity: '1' }));
    invalid(() => parseSwapVoid({ ...voidCommand(), expectedJournalRevision: -1 }));
  });

  it('canonicalizes payloads, excludes requestId, and pins kind, target, version and normalized economics', () => {
    const first = parseSwapCreate(create());
    const equivalent = parseSwapCreate({
      ...create(),
      requestId: swapId,
      occurredAt: '2025-01-02T02:00:00+02:00',
      outgoingQuantity: '1.2500',
      incomingQuantity: '2.000',
    });
    expect(swapPayload('create', first)).toBe(swapPayload('create', equivalent));
    expect(swapPayload('create', first)).not.toBe(
      swapPayload('create', { ...first, considerationUsd: '0' }),
    );
    expect(swapPayload('create', first)).not.toBe(
      swapPayload('create', { ...first, expectedJournalRevision: 5 }),
    );

    const corrected = parseSwapCorrection({ ...create(), expectedVersion: 3 });
    expect(swapPayload('correct', corrected, swapId)).not.toBe(
      swapPayload('correct', corrected, outgoingId),
    );
    expect(swapPayload('correct', corrected, swapId)).not.toBe(
      swapPayload('correct', { ...corrected, expectedVersion: 4 }, swapId),
    );
    expect(swapPayload('void', parseSwapVoid(voidCommand()), swapId)).not.toBe(
      swapPayload('correct', corrected, swapId),
    );
  });
});

describe('SWAP-INPUT bounded reads', () => {
  it('uses the raw-head page cap and requires a current pin for continuation', () => {
    expect(parseSwapListQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(parseSwapListQuery({ journalRevision: '10000', offset: '9999', limit: '100' })).toEqual({
      journalRevision: 10000,
      offset: 9999,
      limit: 100,
    });
    for (const query of [
      { offset: '1' },
      { journalRevision: '1', offset: '10000' },
      { limit: '0' },
      { limit: 101 },
      { unexpected: 'x' },
      Object.assign(Object.create({ journalRevision: '1' }), { offset: '1' }),
      { [Symbol('unexpected')]: 'x' },
    ])
      invalid(() => parseSwapListQuery(query));
  });

  it('bounds version history independently from current-head paging', () => {
    expect(parseSwapHistoryQuery({})).toEqual({ limit: 10 });
    expect(parseSwapHistoryQuery({ beforeVersion: '10001', limit: '20' })).toEqual({
      beforeVersion: 10001,
      limit: 20,
    });
    for (const query of [
      { beforeVersion: '0' },
      { beforeVersion: '10002' },
      { beforeVersion: 1 },
      { limit: '21' },
      { offset: '1' },
      { expectedVersion: '1' },
      Object.assign(Object.create({ beforeVersion: '1' }), { limit: '1' }),
      { [Symbol('unexpected')]: 'x' },
    ])
      invalid(() => parseSwapHistoryQuery(query));
  });

  it('allows an unpinned first allocation page but pins all continuations to revision and version', () => {
    expect(parseSwapAllocationQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(
      parseSwapAllocationQuery({
        journalRevision: '10000',
        expectedVersion: '10000',
        offset: '99999',
        limit: '100',
      }),
    ).toEqual({ journalRevision: 10000, expectedVersion: 10000, offset: 99999, limit: 100 });
    expect(
      parseSwapAllocationQuery({ journalRevision: '0', expectedVersion: '1', limit: '1' }),
    ).toEqual({ journalRevision: 0, expectedVersion: 1, offset: 0, limit: 1 });
    for (const query of [
      { offset: '1' },
      { journalRevision: '1', offset: '1' },
      { expectedVersion: '1', offset: '1' },
      { journalRevision: '1' },
      { expectedVersion: '1' },
      { journalRevision: '10001', expectedVersion: '1' },
      { journalRevision: '1', expectedVersion: '0' },
      { journalRevision: '1', expectedVersion: '10001' },
      { journalRevision: '1', expectedVersion: '1', offset: '100000' },
      { journalRevision: '1', expectedVersion: '1', limit: '101' },
      { journalRevision: '1', expectedVersion: '1', ownerId: requestId },
    ])
      invalid(() => parseSwapAllocationQuery(query));
  });
});

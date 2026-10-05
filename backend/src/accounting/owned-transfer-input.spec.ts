import { BadRequestException } from '@nestjs/common';
import {
  parseTransferAllocationQuery,
  parseTransferCorrection,
  parseTransferCreate,
  parseTransferListQuery,
  parseTransferVoid,
} from './owned-transfer-input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fromAccountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const toAccountId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const instrumentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const movement = {
  instrumentId,
  occurredAt: '2025-01-03T00:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '1.5',
  feeInstrumentId: instrumentId,
  feeQuantity: '0.1',
};
const pins = { expectedFromJournalRevision: 2, expectedToJournalRevision: 0 };
const create = {
  requestId,
  fromAccountId,
  toAccountId,
  ...pins,
  assertInternal: true,
  ...movement,
};
const correct = { requestId, expectedVersion: 1, ...pins, assertInternal: true, ...movement };
const voidInput = { requestId, expectedVersion: 1, ...pins };

describe('TRANSFER-002 strict canonical command boundary', () => {
  it('canonicalizes only valid UUID, decimal and explicit time representations', () => {
    expect(
      parseTransferCreate({
        ...create,
        requestId: requestId.toUpperCase(),
        fromAccountId: fromAccountId.toUpperCase(),
        instrumentId: instrumentId.toUpperCase(),
        feeInstrumentId: instrumentId.toUpperCase(),
        quantity: '001.500',
        feeQuantity: '00.100',
        occurredAt: '2025-01-03T01:00:00+01:00',
      }),
    ).toEqual(create);
    expect(parseTransferCorrection(correct)).toEqual(correct);
    expect(parseTransferVoid(voidInput)).toEqual(voidInput);
  });

  it.each([
    ['create', parseTransferCreate, create],
    ['correct', parseTransferCorrection, correct],
    ['void', parseTransferVoid, voidInput],
  ] as const)(
    '%s rejects missing mandatory fields and raw type/mass assignment',
    (_name, parse, valid) => {
      for (const key of Object.keys(valid)) {
        const input: Record<string, unknown> = { ...valid };
        delete input[key];
        // M9: without an order the transfer goes after every event at its instant.
        if (key === 'orderWithinTimestamp')
          expect(parse(input)).toMatchObject({ orderWithinTimestamp: null });
        else expect(() => parse(input)).toThrow(BadRequestException);
      }
      for (const raw of [null, false, '1', 1, [], Object.create(valid)])
        expect(() => parse(raw)).toThrow(BadRequestException);
      for (const key of [
        'ownerId',
        'createdAt',
        'kind',
        'canonicalPayload',
        'summary',
        '__proto__',
      ]) {
        const input = { ...valid, [key]: 'untrusted' };
        expect(() => parse(input)).toThrow(BadRequestException);
      }
      for (const value of ['0', true, -1, 0.5, 10001, Number.MAX_SAFE_INTEGER])
        expect(() => parse({ ...valid, expectedFromJournalRevision: value })).toThrow(
          BadRequestException,
        );
    },
  );

  it('validates fee identity and independent precision without bounding a derived debit sum', () => {
    expect(
      parseTransferCreate({ ...create, feeInstrumentId: null, feeQuantity: '0.00' }).feeQuantity,
    ).toBe('0');
    const maximum = `${'9'.repeat(48)}.${'9'.repeat(30)}`;
    expect(
      parseTransferCreate({ ...create, quantity: maximum, feeQuantity: maximum }).quantity,
    ).toBe(maximum);
    for (const patch of [
      { quantity: 1 },
      { quantity: '0' },
      { quantity: '1e2' },
      { quantity: ' 1' },
      { quantity: '9'.repeat(49) },
      { quantity: `1.${'0'.repeat(31)}` },
      { feeQuantity: '-1' },
      { feeQuantity: 'NaN' },
      { feeQuantity: 0 },
      { feeQuantity: '0' },
      { feeInstrumentId: null },
      { assertInternal: 'true' },
      { occurredAt: '2025-02-29T00:00:00Z' },
      { occurredAt: '2025-01-03' },
      { occurredAt: '2025-01-03T00:00:00.0001Z' },
      { orderWithinTimestamp: 2147483648 },
    ])
      expect(() => parseTransferCreate({ ...create, ...patch })).toThrow(BadRequestException);
    for (const expectedVersion of [0, '1', true, 10001])
      expect(() => parseTransferCorrection({ ...correct, expectedVersion })).toThrow(
        BadRequestException,
      );
    expect(() => parseTransferCorrection({ ...correct, toAccountId })).toThrow(BadRequestException);
  });
});

describe('TRANSFER-004 bounded current reads', () => {
  it('requires both account pins together and on allocation continuation', () => {
    expect(parseTransferAllocationQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(
      parseTransferAllocationQuery({
        fromJournalRevision: '2',
        toJournalRevision: '0',
        offset: '99999',
        limit: '100',
      }),
    ).toEqual({ fromJournalRevision: 2, toJournalRevision: 0, offset: 99999, limit: 100 });
    for (const input of [
      { fromJournalRevision: '1' },
      { toJournalRevision: '1' },
      { offset: '1' },
      { fromJournalRevision: '1', toJournalRevision: '1', offset: '100000' },
      { limit: '101' },
      { limit: 1 },
      { limit: ['1', '2'] },
      { offset: '00' },
      { ownerId: requestId },
      { fromJournalRevision: '10001', toJournalRevision: '0' },
    ])
      expect(() => parseTransferAllocationQuery(input)).toThrow(BadRequestException);
  });

  it('retains the smaller raw head page range and requires a current list pin', () => {
    expect(parseTransferListQuery({})).toEqual({ offset: 0, limit: 50 });
    expect(
      parseTransferListQuery({ journalRevision: '10000', offset: '9999', limit: '1' }),
    ).toEqual({ journalRevision: 10000, offset: 9999, limit: 1 });
    for (const input of [
      { offset: '1' },
      { journalRevision: '1', offset: '10000' },
      { limit: '0' },
    ])
      expect(() => parseTransferListQuery(input)).toThrow(BadRequestException);
  });
});

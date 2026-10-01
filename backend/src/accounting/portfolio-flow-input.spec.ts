import { BadRequestException } from '@nestjs/common';
import {
  parseFlowCreate,
  parseFlowInitialization,
  parseFlowPeriod,
  parseFlowVoid,
} from './portfolio-flow-input';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const from = '2025-01-01T00:00:00.000Z';
const to = '2025-02-01T00:00:00.000Z';
const command = {
  requestId,
  expectedJournalRevision: 0,
  direction: 'contribution',
  occurredAt: from,
  amountUsd: '1000',
  assertExternal: true,
};

describe('FLOW-001/003 exact external USD input boundary', () => {
  it('normalizes equivalent inputs without inferring a flow or an owner', () => {
    expect(
      parseFlowCreate({
        ...command,
        requestId: requestId.toUpperCase(),
        amountUsd: '001000.000',
        occurredAt: '2025-01-01T03:00:00+03:00',
      }),
    ).toEqual(command);
    expect(
      parseFlowInitialization({ requestId, coverageFrom: from, assertReviewed: true }),
    ).toEqual({
      requestId,
      coverageFrom: from,
      assertReviewed: true,
    });
    expect(parseFlowVoid({ requestId, expectedJournalRevision: 10000 })).toEqual({
      requestId,
      expectedJournalRevision: 10000,
    });
    expect(parseFlowPeriod({ from, to })).toEqual({ from, to, offset: 0, limit: 50 });
    expect(
      parseFlowPeriod({ from, to, offset: '9999', limit: '100', journalRevision: '10000' }),
    ).toEqual({
      from,
      to,
      offset: 9999,
      limit: 100,
      journalRevision: 10000,
    });
  });

  it.each<unknown>([
    null,
    [],
    100,
    '100',
    {},
    { ...command, ownerId: requestId },
    { ...command, currency: 'EUR' },
    { ...command, flowId: requestId },
    { ...command, version: 1 },
    { ...command, kind: 'create' },
    { ...command, direction: 'transfer' },
    { ...command, direction: 'buy' },
    { ...command, direction: 'reward' },
    { ...command, direction: null },
    { ...command, amountUsd: 1000 },
    { ...command, amountUsd: '0' },
    { ...command, amountUsd: '-1' },
    { ...command, amountUsd: '1e3' },
    { ...command, amountUsd: 'NaN' },
    { ...command, amountUsd: 'Infinity' },
    { ...command, amountUsd: '1'.repeat(49) },
    { ...command, amountUsd: `0.${'0'.repeat(30)}1` },
    { ...command, amountUsd: ['1'] },
    { ...command, assertExternal: false },
    { ...command, assertExternal: 'true' },
    { ...command, assertExternal: undefined },
    { ...command, expectedJournalRevision: -1 },
    { ...command, expectedJournalRevision: '0' },
    { ...command, expectedJournalRevision: 10001 },
    { ...command, expectedJournalRevision: 0.1 },
    { ...command, occurredAt: '2025-01-01' },
    { ...command, occurredAt: '2025-02-30T00:00:00Z' },
    { ...command, occurredAt: '2025-01-01T00:00:00.0001Z' },
    { ...command, occurredAt: '2025-01-01T00:00:00+14:01' },
    { ...command, requestId: 'missing' },
  ])('refuses unreviewed, nonexternal or malformed flow input %#', (input) => {
    expect(() => parseFlowCreate(input)).toThrow(BadRequestException);
  });

  it.each<unknown>([
    null,
    [],
    {},
    { from },
    { from, to: from },
    { from: to, to: from },
    { from, to, at: from },
    { from: [from, from], to },
    { from, to, ownerId: requestId },
    { from, to, offset: '1' },
    { from, to, offset: '10000', journalRevision: '1' },
    { from, to, limit: '101' },
    { from, to, limit: '0' },
    { from, to, journalRevision: '01' },
    { from, to, journalRevision: ['0'] },
  ])('refuses malformed or unpinned period pages %#', (input) => {
    expect(() => parseFlowPeriod(input)).toThrow(BadRequestException);
  });

  it('keeps exact supported atoms, finite bounds and literal origin review', () => {
    for (const amountUsd of [
      '0.000000000000000000000000000001',
      `${'9'.repeat(48)}.${'9'.repeat(30)}`,
    ]) {
      expect(parseFlowCreate({ ...command, direction: 'withdrawal', amountUsd }).amountUsd).toBe(
        amountUsd,
      );
    }
    expect(() =>
      parseFlowInitialization({ requestId, coverageFrom: from, assertReviewed: false }),
    ).toThrow(BadRequestException);
    expect(() => parseFlowVoid({ requestId, expectedJournalRevision: 0, amountUsd: '1' })).toThrow(
      BadRequestException,
    );
    const poison = { toString: jest.fn(() => '1000') };
    expect(() => parseFlowCreate({ ...command, amountUsd: poison })).toThrow(BadRequestException);
    expect(poison.toString).not.toHaveBeenCalled();
    expect(() => parseFlowCreate(Object.assign(Object.create({ hidden: true }), command))).toThrow(
      BadRequestException,
    );
    expect(parseFlowCreate(Object.assign(Object.create(null), command))).toEqual(command);
  });
});

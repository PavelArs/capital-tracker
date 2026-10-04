import { describe, expect, it } from 'vitest';
import { normalizeSwapDraft, type SwapDraft, swapCommandFor } from './swap-draft';

const draft: SwapDraft = {
  outgoingInstrumentId: '11111111-1111-4111-8111-111111111111',
  incomingInstrumentId: '22222222-2222-4222-8222-222222222222',
  occurredAt: '2025-01-03T02:00:00+02:00',
  orderWithinTimestamp: '0001',
  outgoingQuantity: '1.000',
  incomingQuantity: '3.000',
  considerationKnown: false,
  considerationUsd: '',
  feeSource: 'none',
  feeInstrumentId: '',
  feeQuantity: '0',
  assertExecuted: true,
};

describe('SWAP-005 exact owner intent', () => {
  it('reviews normalized UTC/decimals and preserves unknown versus known zero in the command', () => {
    const normalized = normalizeSwapDraft(draft);
    expect(normalized).toMatchObject({
      occurredAt: '2025-01-03T00:00:00.000Z',
      orderWithinTimestamp: '1',
      outgoingQuantity: '1',
      incomingQuantity: '3',
    });
    const command = swapCommandFor(
      'create',
      { journalRevision: 7, version: null, draft: normalized },
      null,
    );
    expect(command.body).toMatchObject({
      expectedJournalRevision: 7,
      considerationUsd: null,
      feeSource: null,
      feeInstrumentId: null,
      feeQuantity: '0',
    });
    const zero = swapCommandFor(
      'create',
      {
        journalRevision: 7,
        version: null,
        draft: { ...draft, considerationKnown: true, considerationUsd: '0.000' },
      },
      null,
    );
    expect(zero.body).toMatchObject({ considerationUsd: '0' });
    expect(draft.outgoingQuantity).toBe('1.000');
  });
  it('compares incoming fee bounds exactly beyond binary precision without consuming another instrument', () => {
    const large = {
      ...draft,
      incomingQuantity: '9007199254740993.000000000000000000000000000001',
      feeSource: 'incoming' as const,
      feeQuantity: '9007199254740993.000000000000000000000000000001',
    };
    expect(normalizeSwapDraft(large).feeInstrumentId).toBe(draft.incomingInstrumentId);
    expect(() =>
      normalizeSwapDraft({
        ...large,
        feeQuantity: '9007199254740993.000000000000000000000000000002',
      }),
    ).toThrow('превышать');
    expect(
      normalizeSwapDraft({
        ...draft,
        feeSource: 'held',
        feeInstrumentId: draft.outgoingInstrumentId,
        feeQuantity: '0.000000000000000000000000000001',
      }),
    ).toMatchObject({
      feeSource: 'held',
      feeInstrumentId: draft.outgoingInstrumentId,
      feeQuantity: '0.000000000000000000000000000001',
    });
  });
  it('refuses invalid identities, dates, amounts and omitted explicit evidence before review', () => {
    for (const changes of [
      { assertExecuted: false },
      { incomingInstrumentId: draft.outgoingInstrumentId },
      { incomingInstrumentId: 'SAME' },
      { outgoingQuantity: '0' },
      { incomingQuantity: '1e3' },
      { incomingQuantity: '0.0000000000000000000000000000001' },
      { considerationKnown: true, considerationUsd: '' },
      { considerationKnown: true, considerationUsd: '-1' },
      { occurredAt: '2025-02-29T00:00:00Z' },
      { occurredAt: '2025-01-01T00:00:00' },
      { orderWithinTimestamp: '2147483648' },
      { orderWithinTimestamp: 'NaN' },
      { feeSource: 'held' as const, feeQuantity: '1', feeInstrumentId: '' },
      { feeSource: 'incoming' as const, feeQuantity: '0' },
    ])
      expect(() => normalizeSwapDraft({ ...draft, ...changes })).toThrow();
  });
});

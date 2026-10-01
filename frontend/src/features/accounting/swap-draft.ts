import type { SwapCommand, SwapFields, SwapVersion, SwapVoidCommand } from '@api/asset-swaps.api';
import { newRequestId } from './feedback';

export type SwapMode = 'create' | 'correct' | 'void';
export interface SwapDraft {
  outgoingInstrumentId: string;
  incomingInstrumentId: string;
  occurredAt: string;
  orderWithinTimestamp: string;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationKnown: boolean;
  considerationUsd: string;
  feeSource: 'none' | 'held' | 'incoming';
  feeInstrumentId: string;
  feeQuantity: string;
  assertExecuted: boolean;
}
export type ReviewedSwapCommand =
  | { kind: 'create'; body: SwapCommand }
  | { kind: 'correct'; swapId: string; body: SwapCommand & { expectedVersion: number } }
  | { kind: 'void'; swapId: string; body: SwapVoidCommand };
export type SwapReview = { journalRevision: number; version: number | null; draft: SwapDraft };

export const emptySwapDraft = (): SwapDraft => ({
  outgoingInstrumentId: '',
  incomingInstrumentId: '',
  occurredAt: new Date().toISOString(),
  orderWithinTimestamp: '0',
  outgoingQuantity: '',
  incomingQuantity: '',
  considerationKnown: false,
  considerationUsd: '',
  feeSource: 'none',
  feeInstrumentId: '',
  feeQuantity: '0',
  assertExecuted: false,
});

export function draftFromSwap(fields: SwapFields): SwapDraft {
  return {
    outgoingInstrumentId: fields.outgoingInstrumentId,
    incomingInstrumentId: fields.incomingInstrumentId,
    occurredAt: fields.occurredAt,
    orderWithinTimestamp: String(fields.orderWithinTimestamp),
    outgoingQuantity: fields.outgoingQuantity,
    incomingQuantity: fields.incomingQuantity,
    considerationKnown: fields.considerationUsd !== null,
    considerationUsd: fields.considerationUsd ?? '',
    feeSource: fields.feeSource ?? 'none',
    feeInstrumentId: fields.feeInstrumentId ?? '',
    feeQuantity: fields.feeQuantity,
    assertExecuted: false,
  };
}

function decimal(value: string, positive: boolean): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,30}))?$/.exec(value);
  if (!match || match[1].length > 48 || (positive && !/[1-9]/.test(value)))
    throw new Error(
      'Введите точное неотрицательное число; количества должны быть больше нуля. Пустая сумма не равна нулю.',
    );
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return match[1] + (fraction ? `.${fraction}` : '');
}
const atoms = (value: string): bigint => {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(30, '0'));
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validInstant(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  const utcYear = new Date(value).getUTCFullYear();
  return Boolean(
    year >= 1970 &&
      year <= 9999 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= days[month - 1] &&
      hour <= 23 &&
      minute <= 59 &&
      second <= 59 &&
      offsetHour <= 14 &&
      offsetMinute <= 59 &&
      !(offsetHour === 14 && offsetMinute !== 0) &&
      Number.isFinite(Date.parse(value)) &&
      utcYear >= 1970 &&
      utcYear <= 9999,
  );
}

export function normalizeSwapDraft(draft: SwapDraft): SwapDraft {
  if (!draft.assertExecuted)
    throw new Error('Подтвердите уже выполненный обмен внутри этого счёта.');
  if (
    !uuid.test(draft.outgoingInstrumentId) ||
    !uuid.test(draft.incomingInstrumentId) ||
    draft.outgoingInstrumentId.toLowerCase() === draft.incomingInstrumentId.toLowerCase()
  )
    throw new Error('Выберите два разных актива по их UUID.');
  if (
    !validInstant(draft.occurredAt) ||
    !/^\d+$/.test(draft.orderWithinTimestamp) ||
    Number(draft.orderWithinTimestamp) > 2147483647
  )
    throw new Error('Проверьте момент обмена с часовым поясом и целый порядок от 0 до 2147483647.');
  const outgoingQuantity = decimal(draft.outgoingQuantity, true);
  const incomingQuantity = decimal(draft.incomingQuantity, true);
  const feeQuantity = draft.feeSource === 'none' ? '0' : decimal(draft.feeQuantity, true);
  const feeInstrumentId =
    draft.feeSource === 'none'
      ? ''
      : draft.feeSource === 'incoming'
        ? draft.incomingInstrumentId.toLowerCase()
        : draft.feeInstrumentId.toLowerCase();
  if (draft.feeSource !== 'none' && !uuid.test(feeInstrumentId))
    throw new Error('Выберите актив комиссии.');
  if (draft.feeSource === 'incoming' && atoms(feeQuantity) > atoms(incomingQuantity))
    throw new Error('Комиссия из получаемого актива не может превышать получаемое количество.');
  return {
    ...draft,
    outgoingInstrumentId: draft.outgoingInstrumentId.toLowerCase(),
    incomingInstrumentId: draft.incomingInstrumentId.toLowerCase(),
    occurredAt: new Date(draft.occurredAt).toISOString(),
    orderWithinTimestamp: String(Number(draft.orderWithinTimestamp)),
    outgoingQuantity,
    incomingQuantity,
    considerationUsd: draft.considerationKnown ? decimal(draft.considerationUsd, false) : '',
    feeInstrumentId,
    feeQuantity,
  };
}

export function swapCommandFor(
  mode: SwapMode,
  review: SwapReview,
  target: SwapVersion | null,
): ReviewedSwapCommand {
  const pins = { requestId: newRequestId(), expectedJournalRevision: review.journalRevision };
  if (mode !== 'create' && (!target || review.version !== target.version))
    throw new Error('Текущая версия не проверена.');
  if (mode === 'void' && target)
    return {
      kind: 'void',
      swapId: target.swapId,
      body: { ...pins, expectedVersion: target.version },
    };
  const draft = normalizeSwapDraft(review.draft);
  const body: SwapCommand = {
    ...pins,
    assertExecuted: true,
    outgoingInstrumentId: draft.outgoingInstrumentId,
    incomingInstrumentId: draft.incomingInstrumentId,
    occurredAt: draft.occurredAt,
    orderWithinTimestamp: Number(draft.orderWithinTimestamp),
    outgoingQuantity: draft.outgoingQuantity,
    incomingQuantity: draft.incomingQuantity,
    considerationUsd: draft.considerationKnown ? draft.considerationUsd : null,
    feeSource: draft.feeSource === 'none' ? null : draft.feeSource,
    feeInstrumentId: draft.feeSource === 'none' ? null : draft.feeInstrumentId,
    feeQuantity: draft.feeQuantity,
  };
  if (mode === 'correct' && target)
    return {
      kind: 'correct',
      swapId: target.swapId,
      body: { ...body, expectedVersion: target.version },
    };
  return { kind: 'create', body };
}

import type { RewardCategory } from './asset-reward-types';
import { bad, integer, journalPins, object } from './command-input';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { parseTradePageQuery } from './trade-input';

export { parseTradeHistoryQuery as parseRewardHistoryQuery } from './trade-input';
export const parseRewardListQuery = parseTradePageQuery;

interface RewardFields {
  assertReward: true;
  instrumentId: string;
  category: RewardCategory;
  occurredAt: string;
  /** null: place after every event already at this instant (M9, OPS-SAME-DAY). */
  orderWithinTimestamp: number | null;
  quantity: string;
  acquisitionBasisUsd: string | null;
  incomeValueUsd: string | null;
}
interface RewardPins {
  requestId: string;
  expectedJournalRevision: number;
}
export interface RewardCreateInput extends RewardFields, RewardPins {}
export interface RewardCorrectionInput extends RewardFields, RewardPins {
  expectedVersion: number;
}
export interface RewardVoidInput extends RewardPins {
  expectedVersion: number;
}

function fields(row: Record<string, unknown>): RewardFields {
  if (row.assertReward !== true) return bad();
  if (
    row.category !== 'staking' &&
    row.category !== 'airdrop' &&
    row.category !== 'other' &&
    row.category !== 'unclassified'
  )
    return bad();
  return {
    assertReward: true,
    instrumentId: parseUuid(row.instrumentId),
    category: row.category,
    occurredAt: parseAsOf(row.occurredAt),
    orderWithinTimestamp:
      'orderWithinTimestamp' in row ? integer(row.orderWithinTimestamp, 0, 2147483647) : null,
    quantity: parseDecimal(row.quantity, true),
    acquisitionBasisUsd:
      row.acquisitionBasisUsd === null ? null : parseDecimal(row.acquisitionBasisUsd, false),
    incomeValueUsd: row.incomeValueUsd === null ? null : parseDecimal(row.incomeValueUsd, false),
  };
}
const fieldKeys = [
  'assertReward',
  'instrumentId',
  'category',
  'occurredAt',
  'orderWithinTimestamp',
  'quantity',
  'acquisitionBasisUsd',
  'incomeValueUsd',
] as const;
const pinKeys = ['requestId', 'expectedJournalRevision'] as const;

export function parseRewardCreate(raw: unknown): RewardCreateInput {
  const row = object(raw, [...pinKeys, ...fieldKeys]);
  return { ...journalPins(row), ...fields(row) };
}
export function parseRewardCorrection(raw: unknown): RewardCorrectionInput {
  const row = object(raw, [...pinKeys, 'expectedVersion', ...fieldKeys]);
  return {
    ...journalPins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
    ...fields(row),
  };
}
export function parseRewardVoid(raw: unknown): RewardVoidInput {
  const row = object(raw, [...pinKeys, 'expectedVersion']);
  return {
    ...journalPins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
  };
}

/** Fixed field order captures all normalized command values and excludes the request namespace key. */
export function rewardPayload(
  kind: 'create' | 'correct' | 'void',
  input: RewardCreateInput | RewardCorrectionInput | RewardVoidInput,
  rewardId?: string,
): string {
  const target =
    kind === 'create'
      ? {}
      : {
          rewardId,
          expectedVersion: 'expectedVersion' in input ? input.expectedVersion : undefined,
        };
  return JSON.stringify({
    kind,
    ...target,
    expectedJournalRevision: input.expectedJournalRevision,
    ...('quantity' in input
      ? {
          assertReward: true,
          instrumentId: input.instrumentId,
          category: input.category,
          occurredAt: input.occurredAt,
          orderWithinTimestamp: input.orderWithinTimestamp,
          quantity: input.quantity,
          acquisitionBasisUsd: input.acquisitionBasisUsd,
          incomeValueUsd: input.incomeValueUsd,
        }
      : {}),
  });
}

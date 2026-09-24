import { BadRequestException } from '@nestjs/common';
import type { RewardCategory } from './asset-reward-types';
import { parseAsOf, parseDecimal, parseUuid } from './input';
import { parseTradePageQuery } from './trade-input';

export { parseTradeHistoryQuery as parseRewardHistoryQuery } from './trade-input';
export const parseRewardListQuery = parseTradePageQuery;

interface RewardFields {
  assertReward: true;
  instrumentId: string;
  category: RewardCategory;
  occurredAt: string;
  orderWithinTimestamp: number;
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

const bad = (): never => {
  throw new BadRequestException('Invalid accounting input');
};
function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return bad();
  if (Reflect.ownKeys(raw).some((key) => typeof key !== 'string' || !keys.includes(key)))
    return bad();
  return raw as Record<string, unknown>;
}
function integer(raw: unknown, minimum: number, maximum: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < minimum || raw > maximum)
    return bad();
  return raw === 0 ? 0 : raw;
}
function pins(row: Record<string, unknown>): RewardPins {
  return {
    requestId: parseUuid(row.requestId),
    expectedJournalRevision: integer(row.expectedJournalRevision, 0, 10000),
  };
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
    orderWithinTimestamp: integer(row.orderWithinTimestamp, 0, 2147483647),
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
  return { ...pins(row), ...fields(row) };
}
export function parseRewardCorrection(raw: unknown): RewardCorrectionInput {
  const row = object(raw, [...pinKeys, 'expectedVersion', ...fieldKeys]);
  return {
    ...pins(row),
    expectedVersion: integer(row.expectedVersion, 1, 10000),
    ...fields(row),
  };
}
export function parseRewardVoid(raw: unknown): RewardVoidInput {
  const row = object(raw, [...pinKeys, 'expectedVersion']);
  return {
    ...pins(row),
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

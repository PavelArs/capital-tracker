import { BadRequestException } from '@nestjs/common';
import { parseAmount, parseDate, parseRate, parseUuid } from '../deposits/deposit-input';

export { parseUuid };

export const goalCurrencies = ['USD', 'EUR', 'RUB'] as const;
export type GoalCurrency = (typeof goalCurrencies)[number];

export interface GoalInput {
  name: string;
  currency: GoalCurrency;
  targetAmount: string;
  deadline: string | null;
  expectedReturnPercent: string;
  monthlyContribution: string | null;
}

const bad = (): never => {
  throw new BadRequestException('Invalid goal input');
};

function object(input: unknown, keys: readonly string[], required: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return bad();
  if (required.some((key) => record[key] === undefined)) return bad();
  return record;
}

function name(value: unknown): string {
  if (typeof value !== 'string') return bad();
  const trimmed = value.trim();
  const chars = Array.from(trimmed);
  if (
    chars.length === 0 ||
    chars.length > 120 ||
    chars.some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    return bad();
  return trimmed;
}

const fields = [
  'name',
  'currency',
  'targetAmount',
  'deadline',
  'expectedReturnPercent',
  'monthlyContribution',
] as const;

function goalFields(record: Record<string, unknown>): GoalInput {
  if (!(goalCurrencies as readonly unknown[]).includes(record.currency)) return bad();
  return {
    name: name(record.name),
    currency: record.currency as GoalCurrency,
    targetAmount: parseAmount(record.targetAmount),
    deadline: record.deadline === null ? null : parseDate(record.deadline),
    expectedReturnPercent: parseRate(record.expectedReturnPercent),
    monthlyContribution:
      record.monthlyContribution === null ? null : parseAmount(record.monthlyContribution, true),
  };
}

/** A new goal: every field is given, nullable ones as null, and a request id makes a retry safe. */
export function parseGoal(input: unknown): GoalInput & { requestId: string } {
  const record = object(input, ['requestId', ...fields], ['requestId', ...fields]);
  return { requestId: parseUuid(record.requestId), ...goalFields(record) };
}

/** A goal replaced as a whole. */
export function parseGoalUpdate(input: unknown): GoalInput {
  return goalFields(object(input, fields, fields));
}

/** The terms a goal would have, without a name; a missing, null or empty date or sum is none. */
export type GoalPreviewInput = Omit<GoalInput, 'name'>;

const previewFields = fields.filter((key) => key !== 'name');

/** GOAL-PREVIEW: what the add and edit dialogs ask about before anything is saved. */
export function parseGoalPreview(input: unknown): GoalPreviewInput {
  const record = object(input, previewFields, [
    'currency',
    'targetAmount',
    'expectedReturnPercent',
  ]);
  if (!(goalCurrencies as readonly unknown[]).includes(record.currency)) return bad();
  const given = (value: unknown) =>
    value === undefined || value === null || value === '' ? null : value;
  const deadline = given(record.deadline);
  const monthly = given(record.monthlyContribution);
  return {
    currency: record.currency as GoalCurrency,
    targetAmount: parseAmount(record.targetAmount),
    deadline: deadline === null ? null : parseDate(deadline),
    expectedReturnPercent: parseRate(record.expectedReturnPercent),
    monthlyContribution: monthly === null ? null : parseAmount(monthly, true),
  };
}

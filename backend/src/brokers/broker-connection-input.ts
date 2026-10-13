import { BadRequestException } from '@nestjs/common';
import { parseUuid } from '../deposits/deposit-input';
import { isTBankToken } from './tbank-client';

export { parseUuid };

const bad = (): never => {
  throw new BadRequestException('Invalid broker connection input');
};

function object(input: unknown, keys: readonly string[], required: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad();
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) return bad();
  if (required.some((key) => record[key] === undefined)) return bad();
  return record;
}

function token(value: unknown): string {
  return isTBankToken(value) ? value : bad();
}

/** BROKER-CONNECT: the token alone, to see which broker accounts it reaches. */
export function parseCheck(input: unknown): { token: string } {
  const record = object(input, ['token'], ['token']);
  return { token: token(record.token) };
}

/** BROKER-CONNECT: the token and the broker's own account the app reads. */
export function parseConnection(input: unknown): { token: string; brokerAccountId: string } {
  const record = object(input, ['token', 'brokerAccountId'], ['token', 'brokerAccountId']);
  const id = record.brokerAccountId;
  if (typeof id !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) return bad();
  return { token: token(record.token), brokerAccountId: id };
}

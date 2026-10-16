import { BadRequestException } from '@nestjs/common';
import { parseAccount } from '../accounting/input';
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

/**
 * BROKER-SYNC: one import of the broker history, named by the client's request and pinned to
 * the preview the owner saw.
 */
export function parseImport(input: unknown): { requestId: string; previewHash: string } {
  const record = object(input, ['requestId', 'previewHash'], ['requestId', 'previewHash']);
  const hash = record.previewHash;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return bad();
  return { requestId: parseUuid(record.requestId), previewHash: hash };
}

export const MAX_SETUP_ACCOUNTS = 20;

/**
 * BROKER-SETUP: the token and the T-Bank accounts to make a broker account for, each with the
 * client's request id and the name the owner saw. A T-Bank account or a request id is named once.
 */
export function parseSetup(input: unknown): {
  token: string;
  accounts: { brokerAccountId: string; requestId: string; name: string }[];
} {
  const record = object(input, ['token', 'accounts'], ['token', 'accounts']);
  const list = record.accounts;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SETUP_ACCOUNTS) return bad();
  const accounts = list.map((item) => {
    const pick = object(
      item,
      ['brokerAccountId', 'requestId', 'name'],
      ['brokerAccountId', 'requestId', 'name'],
    );
    const id = pick.brokerAccountId;
    if (typeof id !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(id)) return bad();
    const account = parseAccount({
      requestId: pick.requestId,
      name: pick.name,
      assetClass: 'broker',
    });
    return { brokerAccountId: id, requestId: account.requestId, name: account.name };
  });
  if (
    new Set(accounts.map((item) => item.brokerAccountId)).size !== accounts.length ||
    new Set(accounts.map((item) => item.requestId)).size !== accounts.length
  )
    return bad();
  return { token: token(record.token), accounts };
}

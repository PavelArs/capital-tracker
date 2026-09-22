import { isUUID } from 'class-validator';
import { hiddenQuestion } from './owner-input';

export class MfaInputError extends Error {}

export type MfaCommand =
  | { action: 'prepare'; userId: string; output: string; replace: boolean }
  | { action: 'confirm'; userId: string; candidateId: string; output: string; codeStdin: boolean };

export function parseMfaCommand(args: string[]): MfaCommand {
  const [action, ...options] = args;
  if (action !== 'prepare' && action !== 'confirm') {
    throw new MfaInputError(
      'Use mfa-cli.js prepare --user-id UUID --output PATH [--replace] or confirm --user-id UUID --candidate-id UUID --output PATH [--code-stdin]',
    );
  }
  const allowed =
    action === 'prepare'
      ? ['--user-id', '--output', '--replace']
      : ['--user-id', '--candidate-id', '--output', '--code-stdin'];
  const values = new Map<string, string>();
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (!allowed.includes(option) || values.has(option)) {
      throw new MfaInputError('Invalid or duplicate MFA CLI option');
    }
    if (option === '--replace' || option === '--code-stdin') values.set(option, 'true');
    else {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new MfaInputError('Missing MFA CLI option value');
      values.set(option, value);
    }
  }
  const userId = values.get('--user-id');
  const output = values.get('--output');
  if (!userId || !isUUID(userId)) throw new MfaInputError('Invalid or missing owner user ID');
  if (!output || output.includes('\0')) throw new MfaInputError('Invalid or missing output path');
  if (action === 'prepare') return { action, userId, output, replace: values.has('--replace') };
  const candidateId = values.get('--candidate-id');
  if (!candidateId || !isUUID(candidateId))
    throw new MfaInputError('Invalid or missing candidate ID');
  return { action, userId, candidateId, output, codeStdin: values.has('--code-stdin') };
}

function validatedCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) {
    throw new MfaInputError('The confirmation code must contain exactly six ASCII digits');
  }
  return value;
}

export function parseMfaCodeJson(input: Buffer): string {
  if (input.length > 256) throw new MfaInputError('Code input exceeds 256 bytes');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
  } catch {
    throw new MfaInputError('Invalid code JSON input');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MfaInputError('Code JSON requires only the code field');
  }
  const fields = parsed as Record<string, unknown>;
  if (Object.keys(fields).join(',') !== 'code') {
    throw new MfaInputError('Code JSON requires only the code field');
  }
  return validatedCode(fields.code);
}

export async function readMfaCode(codeStdin: boolean): Promise<string> {
  if (codeStdin) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 256) throw new MfaInputError('Code input exceeds 256 bytes');
      chunks.push(bytes);
    }
    return parseMfaCodeJson(Buffer.concat(chunks));
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new MfaInputError(
      'Hidden code input requires a TTY; use --code-stdin for controlled automation',
    );
  }
  let code: string;
  try {
    code = await hiddenQuestion('Authenticator confirmation code (hidden): ');
  } catch {
    throw new MfaInputError('Code input cancelled or invalid');
  }
  return validatedCode(code);
}

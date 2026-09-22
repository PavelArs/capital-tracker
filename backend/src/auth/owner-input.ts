import { isEmail, isUUID } from 'class-validator';
import { validPasswordInput } from './password';

export class OwnerInputError extends Error {}

export interface OwnerCommand {
  action: 'bootstrap' | 'recover';
  email?: string;
  userId?: string;
  passwordStdin: boolean;
}

export function parseOwnerCommand(args: string[]): OwnerCommand {
  const [action, ...options] = args;
  if (action !== 'bootstrap' && action !== 'recover') {
    throw new OwnerInputError(
      'Use owner-cli.js bootstrap --email EMAIL [--existing-user-id UUID] or recover --user-id UUID; optional --password-stdin',
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    const allowed =
      action === 'bootstrap'
        ? ['--email', '--existing-user-id', '--password-stdin']
        : ['--user-id', '--password-stdin'];
    if (!allowed.includes(option) || values.has(option))
      throw new OwnerInputError('Invalid or duplicate CLI option');
    if (option === '--password-stdin') values.set(option, 'true');
    else {
      const value = options[++index];
      if (!value || value.startsWith('--')) throw new OwnerInputError('Missing CLI option value');
      values.set(option, value);
    }
  }
  const email = values.get('--email')?.trim().toLowerCase();
  const userId = values.get(action === 'bootstrap' ? '--existing-user-id' : '--user-id');
  if (action === 'bootstrap' && (!email || email.length > 254 || !isEmail(email))) {
    throw new OwnerInputError('Invalid owner email input');
  }
  if ((action === 'recover' && !userId) || (userId !== undefined && !isUUID(userId))) {
    throw new OwnerInputError('Invalid or missing owner user ID');
  }
  return { action, email, userId, passwordStdin: values.has('--password-stdin') };
}

function confirmedPassword(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OwnerInputError('Invalid password JSON input');
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'confirmation,password') {
    throw new OwnerInputError('Password JSON requires only password and confirmation');
  }
  if (!validPasswordInput(fields.password) || fields.password !== fields.confirmation) {
    throw new OwnerInputError(
      'Invalid password or confirmation; require matching 15–128 characters, at most 512 UTF-8 bytes, no NUL/CR/LF',
    );
  }
  return fields.password;
}

export function parsePasswordJson(input: Buffer): string {
  if (input.length > 4096) throw new OwnerInputError('Password input exceeds 4096 bytes');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input));
  } catch {
    throw new OwnerInputError('Invalid password JSON input');
  }
  return confirmedPassword(parsed);
}

export async function hiddenQuestion(prompt: string): Promise<string> {
  const input = process.stdin;
  const wasRaw = input.isRaw;
  process.stderr.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const cleanup = () => {
        input.removeListener('data', onData);
        input.removeListener('end', onCancel);
        process.removeListener('SIGTERM', onCancel);
      };
      const onCancel = () => {
        cleanup();
        reject(new OwnerInputError('Password input cancelled'));
      };
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === '\u0003' || character === '\u0004') return onCancel();
          if (character === '\r' || character === '\n') {
            cleanup();
            resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b')
            value = Array.from(value).slice(0, -1).join('');
          else value += character;
          if (Buffer.byteLength(value, 'utf8') > 512) {
            cleanup();
            reject(new OwnerInputError('Password input exceeds 512 bytes'));
            return;
          }
        }
      };
      input.on('data', onData);
      input.once('end', onCancel);
      process.once('SIGTERM', onCancel);
    });
  } finally {
    input.setRawMode(wasRaw ?? false);
    input.pause();
    process.stderr.write('\n');
  }
}

export async function readOwnerPassword(passwordStdin: boolean): Promise<string> {
  if (passwordStdin) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 4096) throw new OwnerInputError('Password input exceeds 4096 bytes');
      chunks.push(bytes);
    }
    return parsePasswordJson(Buffer.concat(chunks));
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new OwnerInputError(
      'Hidden password input requires a TTY; use --password-stdin for controlled automation',
    );
  }
  const password = await hiddenQuestion('Owner password (hidden): ');
  const confirmation = await hiddenQuestion('Confirm password (hidden): ');
  return confirmedPassword({ password, confirmation });
}

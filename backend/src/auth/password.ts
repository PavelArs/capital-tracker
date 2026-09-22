import * as argon2 from 'argon2';

export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

export function validPasswordInput(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 512) return false;
  // Reject lone UTF-16 surrogates; UTF-8 encoding would silently replace them.
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) return false;
  const length = Array.from(value).length;
  return (
    length >= 15 &&
    length <= 128 &&
    !['\0', '\r', '\n'].some((character) => value.includes(character))
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPasswordInput(password)) throw new Error('Invalid password input');
  return argon2.hash(password, passwordOptions);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!validPasswordInput(password) || !hash.startsWith('$argon2id$')) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

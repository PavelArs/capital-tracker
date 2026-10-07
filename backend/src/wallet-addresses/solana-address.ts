import { BadRequestException } from '@nestjs/common';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bad(): never {
  throw new BadRequestException('Invalid Solana address');
}

/** The bytes a base58 text encodes; each leading "1" is a zero byte. */
export function base58Bytes(value: string): Buffer | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return null;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const hex = number === 0n ? '' : number.toString(16);
  const leadingZeros = value.length - value.replace(/^1+/, '').length;
  return Buffer.concat([
    Buffer.alloc(leadingZeros),
    Buffer.from(hex.padStart(hex.length + (hex.length % 2), '0'), 'hex'),
  ]);
}

/**
 * WAL-INVALID: a Solana account address is the base58 text of a 32-byte public key. A 64-byte
 * secret key in the same alphabet is refused like any other invalid input. Base58 is
 * case-sensitive, so the address is stored exactly as given.
 */
export function normalizeSolanaAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return bad();
  return base58Bytes(value)?.length === 32 ? value : bad();
}

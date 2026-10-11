import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bad(): never {
  throw new BadRequestException('Invalid Bitcoin address');
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();

// P2PKH (version 0x00) and P2SH (0x05) with a verified double-SHA-256 checksum.
function isBase58Address(value: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/.test(value)) return false;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const body = number.toString(16);
  const leadingZeros = value.length - value.replace(/^1+/, '').length;
  const bytes = Buffer.concat([
    Buffer.alloc(leadingZeros),
    number === 0n
      ? Buffer.alloc(0)
      : Buffer.from(body.padStart(body.length + (body.length % 2), '0'), 'hex'),
  ]);
  if (bytes.length !== 25 || (bytes[0] !== 0x00 && bytes[0] !== 0x05)) return false;
  const checksum = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
  return checksum.equals(bytes.subarray(21));
}

export function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) checksum ^= GENERATOR[bit];
  }
  return checksum >>> 0;
}

export function convertBits(data: number[], from: number, to: number): number[] | null {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  for (const value of data) {
    accumulator = (accumulator << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((accumulator >>> bits) & ((1 << to) - 1));
    }
  }
  if (bits >= from || (accumulator << (to - bits)) & ((1 << to) - 1)) return null;
  return result;
}

// Segwit v0 (BIP-173 bech32) and v1+ (BIP-350 bech32m) on mainnet HRP "bc".
function isSegwitAddress(value: string): boolean {
  if (!/^bc1[02-9ac-hj-np-z]{6,87}$/.test(value)) return false;
  const data = [...value.slice(3)].map((character) => BECH32.indexOf(character));
  const constant = polymod([3, 3, 0, 2, 3, ...data]);
  const version = data[0];
  if (version > 16) return false;
  if (constant !== (version === 0 ? BECH32_CONST : BECH32M_CONST)) return false;
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program || program.length < 2 || program.length > 40) return false;
  return version !== 0 || program.length === 20 || program.length === 32;
}

export function normalizeBitcoinAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 90) return bad();
  if (/^bc1/i.test(value)) {
    // BIP-173 forbids mixed case; the canonical stored form is lowercase.
    if (value !== value.toLowerCase() && value !== value.toUpperCase()) return bad();
    const lower = value.toLowerCase();
    return isSegwitAddress(lower) ? lower : bad();
  }
  return isBase58Address(value) ? value : bad();
}

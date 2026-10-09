import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { base58Bytes } from './solana-address';

// TRON-ADD: a Tron account address is 21 bytes, the prefix 0x41 and a 20-byte account id, with
// a four-byte checksum (the start of a double SHA-256) in base58. Wallet apps show it as
// "T…", 34 characters; Tron's own API also writes it as hex, "41…".

const PREFIX = 0x41;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();

function bad(): never {
  throw new BadRequestException('Invalid Tron address');
}

/** The 21 address bytes of a base58check Tron address, or null when it is not one. */
function addressBytes(value: string): Buffer | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return null;
  const bytes = base58Bytes(value);
  if (bytes?.length !== 25 || bytes[0] !== PREFIX) return null;
  const payload = bytes.subarray(0, 21);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return checksum.equals(bytes.subarray(21)) ? payload : null;
}

/** WAL-INVALID: a "T…" address with a valid checksum; base58 is case-sensitive, kept as given. */
export function normalizeTronAddress(value: unknown): string {
  if (typeof value !== 'string') return bad();
  return addressBytes(value) ? value : bad();
}

/**
 * The hex form of an address Tron's API wrote either way ("T…" or "41…"), lower case; null
 * when it is neither.
 */
export function tronHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^41[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  return addressBytes(value)?.toString('hex') ?? null;
}

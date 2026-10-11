import { BadRequestException } from '@nestjs/common';

// STELLAR-ADD: a Stellar account is shown as its StrKey, "G…", 56 characters of base32: a
// version byte (6 << 3, the account ID), the 32-byte public key and a CRC16-XModem checksum,
// low byte first. A muxed "M…" address names an account of an exchange, not a wallet.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ACCOUNT_VERSION = 6 << 3;

function bad(): never {
  throw new BadRequestException('Invalid Stellar address');
}

function base32Bytes(value: string): Buffer | null {
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // Leftover bits are padding and must be zero, so each address has one spelling.
  if ((buffer & ((1 << bits) - 1)) !== 0) return null;
  return Buffer.from(bytes);
}

/** CRC16-XModem: polynomial 0x1021, initial value 0. */
export function crc16(bytes: Buffer): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Whether the text is a Stellar account ID with a valid checksum. */
export function isStellarAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^G[A-Z2-7]{55}$/.test(value)) return false;
  const bytes = base32Bytes(value);
  if (bytes?.length !== 35 || bytes[0] !== ACCOUNT_VERSION) return false;
  return crc16(bytes.subarray(0, 33)) === bytes.readUInt16LE(33);
}

/** WAL-INVALID: a "G…" account ID with a valid checksum; base32 is upper case, kept as given. */
export function normalizeStellarAddress(value: unknown): string {
  return isStellarAddress(value) ? value : bad();
}

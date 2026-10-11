import { BadRequestException } from '@nestjs/common';
import { BASE58, sha256 } from './bitcoin-address';

// track-zcash-wallets (ZCASH-ADD): a transparent Zcash address, "t1…" (P2PKH, version bytes
// 1C B8) or "t3…" (P2SH, 1C BD), Base58Check like Bitcoin with a two-byte version. Shielded
// addresses (zs…, u1…, zc…) and TEX addresses keep their history out of public view or need
// other decoding, so they are refused; the dialog says why.
const VERSIONS = new Set([0x1cb8, 0x1cbd]);

function bad(): never {
  throw new BadRequestException('Invalid Zcash address');
}

/** Whether the text is a mainnet transparent Zcash address with a valid checksum. */
export function isZcashAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) return false;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const hex = number.toString(16).padStart(52, '0');
  if (hex.length !== 52) return false;
  const bytes = Buffer.from(hex, 'hex');
  if (!VERSIONS.has(bytes.readUInt16BE(0))) return false;
  return sha256(sha256(bytes.subarray(0, 22)))
    .subarray(0, 4)
    .equals(bytes.subarray(22));
}

/** WAL-INVALID: a "t1…"/"t3…" address with a valid checksum; Base58 is kept as given. */
export function normalizeZcashAddress(value: unknown): string {
  return isZcashAddress(value) ? value : bad();
}

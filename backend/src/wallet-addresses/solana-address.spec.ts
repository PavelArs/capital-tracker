import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { base58Bytes, normalizeSolanaAddress } from './solana-address';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// Base58 restated here so the test does not trust the decoder it checks.
function base58(bytes: Buffer): string {
  let number = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
// Synthetic keys: hashes of fixed labels, never a real wallet.
const bytes = (label: string, length: number) =>
  Buffer.concat([
    createHash('sha256').update(`ct-test-sol:${label}`).digest(),
    createHash('sha256').update(`ct-test-sol-2:${label}`).digest(),
  ]).subarray(0, length);
const wallet = base58(bytes('wallet', 32));

describe('WAL-INVALID: Solana addresses', () => {
  it('keeps a 32-byte base58 key exactly as given', () => {
    expect(normalizeSolanaAddress(wallet)).toBe(wallet);
    expect(base58Bytes(wallet)).toEqual(bytes('wallet', 32));
  });

  it('reads leading ones as zero bytes', () => {
    const zeros = Buffer.concat([Buffer.alloc(2), bytes('zeros', 30)]);
    expect(normalizeSolanaAddress(base58(zeros))).toBe(base58(zeros));
    expect(base58Bytes('11111111111111111111111111111111')).toEqual(Buffer.alloc(32));
  });

  it.each([
    ['a Bitcoin legacy address', '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
    ['an Ethereum address', `0x${'a1'.repeat(20)}`],
    ['a 64-byte secret key', base58(bytes('secret', 64))],
    ['a 31-byte key', base58(bytes('short', 31))],
    ['a key with a letter outside base58', `${wallet.slice(0, -1)}0`],
    ['a key with spaces', ` ${wallet}`],
    ['nothing', ''],
    ['a number', 7],
  ])('refuses %s', (_case, input) => {
    expect(() => normalizeSolanaAddress(input)).toThrow(BadRequestException);
  });
});

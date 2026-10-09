import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { normalizeTronAddress, tronHex } from './tron-address';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
// Base58check restated here so the test does not trust the decoder it checks.
function base58check(payload: Buffer): string {
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = ALPHABET[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic accounts: hashes of fixed labels, never a real wallet.
const account = (label: string) =>
  createHash('sha256').update(`ct-test-tron:${label}`).digest().subarray(0, 20);
const payload = (label: string, prefix = 0x41) =>
  Buffer.concat([Buffer.from([prefix]), account(label)]);
const wallet = base58check(payload('wallet'));
const walletHex = payload('wallet').toString('hex');

describe('TRON-ADD: Tron addresses', () => {
  it('keeps a base58check "T…" address exactly as given', () => {
    expect(wallet).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(normalizeTronAddress(wallet)).toBe(wallet);
  });

  it('accepts the public USDT contract address', () => {
    expect(normalizeTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
  });

  it.each([
    ['a changed character (checksum)', `${wallet.slice(0, -1)}${wallet.endsWith('a') ? 'b' : 'a'}`],
    ['the hex form', walletHex],
    ['another network prefix', base58check(payload('other', 0x00))],
    ['a lower-cased address', wallet.toLowerCase()],
    ['a letter outside base58', `${wallet.slice(0, -1)}0`],
    ['spaces', ` ${wallet}`],
    ['an Ethereum address', `0x${'a1'.repeat(20)}`],
    ['nothing', ''],
    ['a number', 7],
  ])('refuses %s', (_case, input) => {
    expect(() => normalizeTronAddress(input)).toThrow(BadRequestException);
    expect(() => normalizeTronAddress(input)).toThrow('Invalid Tron address');
  });
});

describe('TRON-IDENTITY: one hex form for both spellings', () => {
  it('reads "T…" and "41…" as the same lower-case hex', () => {
    expect(tronHex(wallet)).toBe(walletHex);
    expect(tronHex(walletHex.toUpperCase())).toBe(walletHex);
  });

  it.each([
    ['a bad checksum', `${wallet.slice(0, -1)}${wallet.endsWith('a') ? 'b' : 'a'}`],
    ['hex without the prefix', account('wallet').toString('hex')],
    ['nothing', undefined],
    ['a number', 41],
  ])('gives null for %s', (_case, input) => {
    expect(tronHex(input)).toBeNull();
  });
});

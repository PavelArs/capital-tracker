import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { crc16, isStellarAddress, normalizeStellarAddress } from './stellar-address';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// StrKey restated here so the test does not trust the decoder it checks.
function strKey(version: number, key: Buffer): string {
  const payload = Buffer.concat([Buffer.from([version]), key]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc16(payload));
  const bytes = Buffer.concat([payload, checksum]);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let text = '';
  for (let at = 0; at < bits.length; at += 5)
    text += ALPHABET[Number.parseInt(bits.slice(at, at + 5).padEnd(5, '0'), 2)];
  return text;
}
// Synthetic accounts: hashes of fixed labels, never a real wallet.
const key = (label: string) => createHash('sha256').update(`ct-test-stellar:${label}`).digest();
const wallet = strKey(6 << 3, key('wallet'));

describe('STELLAR-ADD: Stellar addresses', () => {
  it('computes CRC16-XModem', () => {
    // The standard check value of CRC-16/XMODEM.
    expect(crc16(Buffer.from('123456789'))).toBe(0x31c3);
  });

  it('keeps a "G…" account ID exactly as given', () => {
    expect(wallet).toMatch(/^G[A-Z2-7]{55}$/);
    expect(normalizeStellarAddress(wallet)).toBe(wallet);
  });

  it('accepts the published StrKey test vectors (SEP-23)', () => {
    expect(isStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ')).toBe(true);
    expect(isStellarAddress('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7')).toBe(true);
  });

  it.each([
    [
      'a changed character (checksum)',
      `${wallet.slice(0, -2)}${wallet.endsWith('AA') ? 'BA' : 'AA'}`,
    ],
    ['lower case', wallet.toLowerCase()],
    ['a secret seed', strKey(18 << 3, key('seed'))],
    ['a muxed account', strKey(12 << 3, Buffer.concat([key('muxed'), Buffer.alloc(8)]))],
    ['a short value', wallet.slice(0, 55)],
    ['a Tron address', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'],
    ['not text', 42],
  ])('refuses %s', (_name, value) => {
    expect(isStellarAddress(value)).toBe(false);
    expect(() => normalizeStellarAddress(value)).toThrow(BadRequestException);
  });
});

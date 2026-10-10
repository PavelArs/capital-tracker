import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { isZcashAddress, normalizeZcashAddress } from './zcash-address';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();
// Base58Check restated here so the test does not trust the decoder it checks.
function base58Check(version: number, hash: Buffer): string {
  const payload = Buffer.concat([Buffer.from([version >> 8, version & 0xff]), hash]);
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let number = BigInt(`0x${bytes.toString('hex')}`);
  let text = '';
  while (number > 0n) {
    text = BASE58[Number(number % 58n)] + text;
    number /= 58n;
  }
  return text;
}
// Synthetic addresses: hashes of fixed labels, never a real wallet.
const hash = (label: string) =>
  createHash('sha256').update(`ct-test-zcash:${label}`).digest().subarray(0, 20);
const p2pkh = base58Check(0x1cb8, hash('wallet'));
const p2sh = base58Check(0x1cbd, hash('script'));

describe('ZCASH-ADD: transparent Zcash addresses', () => {
  it('keeps a "t1…" or "t3…" address exactly as given', () => {
    expect(p2pkh).toMatch(/^t1[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(p2sh).toMatch(/^t3[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(normalizeZcashAddress(p2pkh)).toBe(p2pkh);
    expect(normalizeZcashAddress(p2sh)).toBe(p2sh);
  });

  it('refuses a changed character, another version, shielded and other addresses', () => {
    const changed = `${p2pkh.slice(0, -1)}${p2pkh.endsWith('2') ? '3' : '2'}`;
    const testnet = base58Check(0x1d25, hash('wallet'));
    expect(testnet).toMatch(/^tm/);
    for (const value of [
      changed,
      testnet,
      p2pkh.toLowerCase(),
      ` ${p2pkh}`,
      `zs1${'q'.repeat(75)}`,
      `u1${'q'.repeat(104)}`,
      `zc${'A'.repeat(93)}`,
      `tex1${'q'.repeat(38)}`,
      '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
      42,
      null,
    ]) {
      expect(isZcashAddress(value)).toBe(false);
      expect(() => normalizeZcashAddress(value)).toThrow(BadRequestException);
    }
  });
});

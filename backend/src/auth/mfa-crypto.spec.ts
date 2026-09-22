import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MfaCipher, createTotp, recoveryHash } from './mfa-crypto';

describe('MFA-003-A / MFA-006-A factor cryptography', () => {
  let directory: string;
  let keyFile: string;
  const owner = '11111111-1111-4111-8111-111111111111';
  const version = '22222222-2222-4222-8222-222222222222';
  const config = () => new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: 'test-key' });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-mfa-crypto-'));
    keyFile = join(directory, 'key');
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches six-digit RFC6238 SHA1 truncation at %s seconds', (seconds, expected) => {
    // RFC secret ASCII "12345678901234567890", independently published expected values.
    const totp = createTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp.generate({ timestamp: Number(seconds) * 1000 })).toBe(expected);
    expect(
      totp.validate({ token: String(expected), timestamp: Number(seconds) * 1000, window: 0 }),
    ).toBe(0);
  });

  it('encrypts with randomized authenticated envelopes bound to owner and enrollment', () => {
    const cipher = new MfaCipher(config());
    const secret = createTotp().secret.base32;
    const first = cipher.encrypt(secret, owner, version);
    const second = cipher.encrypt(secret, owner, version);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(first).not.toEqual(second);
    expect(cipher.decrypt(first, owner, version)).toBe(secret);
    expect(() => cipher.decrypt(first, version, version)).toThrow();
    expect(() => cipher.decrypt(first, owner, owner)).toThrow();
    expect(() =>
      cipher.decrypt({ ...first, tag: randomBytes(16).toString('base64') }, owner, version),
    ).toThrow();
    writeFileSync(keyFile, randomBytes(32));
    expect(() => new MfaCipher(config()).decrypt(first, owner, version)).toThrow();
  });

  it.each([0, 31, 33, 4096])('refuses a %s-byte key', (size) => {
    writeFileSync(keyFile, Buffer.alloc(size));
    expect(() => new MfaCipher(config())).toThrow('MFA encryption key configuration invalid');
  });
  it('refuses missing, world-readable and symlink key files', () => {
    chmodSync(keyFile, 0o644);
    expect(() => new MfaCipher(config())).toThrow();
    chmodSync(keyFile, 0o600);
    const link = join(directory, 'link');
    symlinkSync(keyFile, link);
    expect(
      () => new MfaCipher(new ConfigService({ MFA_KEY_FILE: link, MFA_KEY_ID: 'test-key' })),
    ).toThrow();
    expect(() => new MfaCipher(new ConfigService())).toThrow();
  });
  it('domain-separates recovery hashes by owner and enrollment without storing raw codes', () => {
    const code = '01234567-89abcdef-01234567-89abcdef';
    const hash = recoveryHash(code, owner, version);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(code);
    expect(recoveryHash(code.toUpperCase(), owner, version)).toBe(hash);
    expect(recoveryHash(code, version, version)).not.toBe(hash);
    expect(recoveryHash(code, owner, owner)).not.toBe(hash);
  });
});

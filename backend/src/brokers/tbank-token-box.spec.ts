import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { TBankTokenBox } from './tbank-token-box';

// BROKER-CONNECT: synthetic tokens and ids only.
describe('BROKER-CONNECT: the stored T-Bank token', () => {
  let directory: string;
  let keyFile: string;
  const owner = '11111111-1111-4111-8111-111111111111';
  const account = '22222222-2222-4222-8222-222222222222';
  const token = 't.SyntheticToken000000000000000001';
  const box = (keyId = 'test-key') =>
    new TBankTokenBox(new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: keyId }));
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-tbank-token-'));
    keyFile = join(directory, 'key');
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('is stored encrypted and opens only for its owner and account', () => {
    const sealed = box().seal(token, owner, account);
    expect(JSON.stringify(sealed)).not.toContain(token);
    expect(sealed).toMatchObject({ v: 1, keyId: 'test-key' });
    expect(box().open(sealed, owner, account)).toBe(token);
    expect(box().open(sealed, account, owner)).toBeNull();
    expect(box().open(sealed, owner, owner)).toBeNull();
    // Another server key, or any change to the envelope, opens nothing.
    expect(box('other-key').open(sealed, owner, account)).toBeNull();
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 1;
    expect(
      box().open({ ...sealed, ciphertext: flipped.toString('base64') }, owner, account),
    ).toBeNull();
    expect(box().open(null, owner, account)).toBeNull();
    expect(box().open({ ...sealed, v: 2 }, owner, account)).toBeNull();
  });

  it('never seals anything but a token of plain characters', () => {
    expect(() => box().seal('short', owner, account)).toThrow();
    expect(() => box().seal(`${token} x`, owner, account)).toThrow();
  });

  it('needs the server key only when a token is stored or read', () => {
    const missing = new TBankTokenBox(new ConfigService({}));
    expect(() => missing.seal(token, owner, account)).toThrow(
      'MFA encryption key configuration invalid',
    );
    expect(missing.open({ v: 1 }, owner, account)).toBeNull();
  });
});

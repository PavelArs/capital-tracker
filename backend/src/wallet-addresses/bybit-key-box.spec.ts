import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BybitKeyBox } from './bybit-key-box';

// BYBIT-KEY: synthetic keys and ids only.
describe('BYBIT-KEY: the stored API key', () => {
  let directory: string;
  let keyFile: string;
  const owner = '11111111-1111-4111-8111-111111111111';
  const wallet = '22222222-2222-4222-8222-222222222222';
  const credentials = { apiKey: 'SyntheticKey0001', apiSecret: 'SyntheticSecret000000000000001' };
  const box = (keyId = 'test-key') =>
    new BybitKeyBox(new ConfigService({ MFA_KEY_FILE: keyFile, MFA_KEY_ID: keyId }));
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'capital-bybit-key-'));
    keyFile = join(directory, 'key');
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('is stored encrypted and opens only for its owner and account', () => {
    const sealed = box().seal(credentials, owner, wallet);
    const stored = JSON.stringify(sealed);
    expect(stored).not.toContain(credentials.apiKey);
    expect(stored).not.toContain(credentials.apiSecret);
    expect(sealed).toMatchObject({ v: 1, keyId: 'test-key' });
    expect(box().open(sealed, owner, wallet)).toEqual(credentials);
    expect(box().open(sealed, wallet, owner)).toBeNull();
    expect(box().open(sealed, owner, owner)).toBeNull();
    // Another server key, or any change to the envelope, opens nothing.
    expect(box('other-key').open(sealed, owner, wallet)).toBeNull();
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 1;
    expect(
      box().open({ ...sealed, ciphertext: flipped.toString('base64') }, owner, wallet),
    ).toBeNull();
    expect(box().open(null, owner, wallet)).toBeNull();
    expect(box().open({ ...sealed, v: 2 }, owner, wallet)).toBeNull();
  });

  it('never seals anything but a key and secret of plain letters and digits', () => {
    expect(() => box().seal({ ...credentials, apiSecret: 'short' }, owner, wallet)).toThrow();
    expect(() =>
      box().seal({ ...credentials, apiKey: 'Synthetic Key 0001' }, owner, wallet),
    ).toThrow();
  });

  it('needs the server key only when a key is stored or read', () => {
    const missing = new BybitKeyBox(new ConfigService({}));
    expect(() => missing.seal(credentials, owner, wallet)).toThrow(
      'MFA encryption key configuration invalid',
    );
    expect(missing.open({ v: 1 }, owner, wallet)).toBeNull();
  });
});

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Secret, TOTP } from 'otpauth';

export interface MfaEnvelope {
  v: 1;
  keyId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export function createTotp(secret?: string, label = 'Owner'): TOTP {
  return new TOTP({
    issuer: 'Capital Tracker',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret ?? new Secret({ size: 20 }),
  });
}

export const recoveryPattern = /^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{8}){3}$/;

export function recoveryHash(code: string, userId: string, version: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify(['capital-tracker/mfa-recovery/v1', userId, version, code.toLowerCase()]),
    )
    .digest('hex');
}

export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    randomBytes(16).toString('hex').match(/.{8}/g)!.join('-'),
  );
}

/**
 * The server's 32-byte MFA key file and its identifier, checked as MfaCipher needs them: an
 * absolute, owner-only regular file that is not a link. Provider credentials are sealed by a
 * SealedBox with keys derived from the same file.
 */
export function readMfaKey(config: ConfigService): { key: Buffer; keyId: string } {
  const file = config.get<string>('MFA_KEY_FILE');
  const keyId = config.get<string>('MFA_KEY_ID');
  let descriptor: number | undefined;
  try {
    if (!file || !isAbsolute(file) || !keyId || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId))
      throw new Error();
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size !== 32 || ![0o400, 0o600].includes(stat.mode & 0o7777))
      throw new Error();
    const bytes = Buffer.alloc(33);
    if (readSync(descriptor, bytes, 0, bytes.length, 0) !== 32) throw new Error();
    return { key: bytes.subarray(0, 32), keyId };
  } catch {
    throw new Error('MFA encryption key configuration invalid');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export class MfaCipher {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(config: ConfigService) {
    const { key, keyId } = readMfaKey(config);
    this.key = key;
    this.keyId = keyId;
  }

  private context(userId: string, version: string): Buffer {
    return Buffer.from(JSON.stringify(['capital-tracker/mfa/v1', this.keyId, userId, version]));
  }

  encrypt(secret: string, userId: string, version: string): MfaEnvelope {
    if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid factor secret');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.context(userId, version));
    const encrypted = Buffer.concat([cipher.update(secret, 'ascii'), cipher.final()]);
    return {
      v: 1,
      keyId: this.keyId,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  decrypt(envelope: unknown, userId: string, version: string): string {
    try {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error();
      const value = envelope as MfaEnvelope;
      if (value.v !== 1 || value.keyId !== this.keyId) throw new Error();
      const decode = (encoded: unknown, length: number) => {
        if (typeof encoded !== 'string' || encoded.length > 64) throw new Error();
        const result = Buffer.from(encoded, 'base64');
        if (result.length !== length || result.toString('base64') !== encoded) throw new Error();
        return result;
      };
      const decipher = createDecipheriv('aes-256-gcm', this.key, decode(value.nonce, 12));
      decipher.setAAD(this.context(userId, version));
      decipher.setAuthTag(decode(value.tag, 16));
      const secret = Buffer.concat([
        decipher.update(decode(value.ciphertext, 32)),
        decipher.final(),
      ]).toString('ascii');
      if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error();
      return secret;
    } catch {
      throw new Error('MFA secret could not be opened');
    }
  }
}

/**
 * A provider credential stored encrypted and never shown again: AES-256-GCM under a key derived
 * (HKDF-SHA256, `info`) from the server's MFA key file, so no new secret has to be provisioned.
 * The envelope is bound to [label, keyId, owner, id]. `encode` validates the value (throwing when
 * it is invalid) and `decode` returns null for anything it does not accept.
 */
export class SealedBox<T> {
  private derived: { key: Buffer; keyId: string } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly info: string,
    private readonly label: string,
    private readonly encode: (value: T) => unknown[],
    private readonly decode: (parts: unknown[]) => T | null,
  ) {}

  // Read on first use: a server without the MFA key cannot store a credential either.
  private material() {
    if (!this.derived) {
      const { key, keyId } = readMfaKey(this.config);
      const derived = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), this.info, 32));
      this.derived = { key: derived, keyId };
    }
    return this.derived;
  }

  private context(keyId: string, ownerId: string, id: string): Buffer {
    return Buffer.from(JSON.stringify([this.label, keyId, ownerId, id]));
  }

  seal(value: T, ownerId: string, id: string): MfaEnvelope {
    const plain = JSON.stringify(this.encode(value));
    const { key, keyId } = this.material();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.context(keyId, ownerId, id));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return {
      v: 1,
      keyId,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /** The stored value, or null when it cannot be opened (another server key, or tampering). */
  open(envelope: unknown, ownerId: string, id: string): T | null {
    try {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
      const value = envelope as MfaEnvelope;
      const { key, keyId } = this.material();
      if (value.v !== 1 || value.keyId !== keyId) return null;
      const decode = (encoded: unknown, maximum: number) => {
        if (typeof encoded !== 'string' || encoded.length > maximum) throw new Error();
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.toString('base64') !== encoded) throw new Error();
        return bytes;
      };
      const nonce = decode(value.nonce, 16);
      const tag = decode(value.tag, 24);
      if (nonce.length !== 12 || tag.length !== 16) return null;
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(this.context(keyId, ownerId, id));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(decode(value.ciphertext, 512)),
        decipher.final(),
      ]).toString('utf8');
      const parts = JSON.parse(plain) as unknown;
      return Array.isArray(parts) ? this.decode(parts) : null;
    } catch {
      return null;
    }
  }
}

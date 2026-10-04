import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
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

export class MfaCipher {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(config: ConfigService) {
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
      this.key = bytes.subarray(0, 32);
      this.keyId = keyId;
    } catch {
      throw new Error('MFA encryption key configuration invalid');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
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

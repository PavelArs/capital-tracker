import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { readMfaKey } from '../auth/mfa-crypto';
import type { BybitCredentials } from './bybit-client';

// BYBIT-KEY, PR-EXC-1: the owner's Bybit API key and secret are stored encrypted and never
// shown again. AES-256-GCM with a key derived (HKDF-SHA256) from the server's MFA key file, so
// no new secret has to be provisioned; the envelope is bound to the owner and the account.

export interface SealedKey {
  v: 1;
  keyId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

const keyPattern = /^[0-9A-Za-z]{10,64}$/;
const secretPattern = /^[0-9A-Za-z]{10,128}$/;

export const isApiKey = (value: unknown): value is string =>
  typeof value === 'string' && keyPattern.test(value);
export const isApiSecret = (value: unknown): value is string =>
  typeof value === 'string' && secretPattern.test(value);

export class BybitKeyBox {
  private derived: { key: Buffer; keyId: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  // Read on first use: a server without the MFA key cannot store a Bybit key either.
  private material() {
    if (!this.derived) {
      const { key, keyId } = readMfaKey(this.config);
      const derived = Buffer.from(
        hkdfSync('sha256', key, Buffer.alloc(0), 'capital-tracker/bybit-api-key/v1', 32),
      );
      this.derived = { key: derived, keyId };
    }
    return this.derived;
  }

  private context(keyId: string, ownerId: string, walletId: string): Buffer {
    return Buffer.from(JSON.stringify(['capital-tracker/bybit/v1', keyId, ownerId, walletId]));
  }

  seal(credentials: BybitCredentials, ownerId: string, walletId: string): SealedKey {
    if (!isApiKey(credentials.apiKey) || !isApiSecret(credentials.apiSecret))
      throw new Error('Invalid Bybit key');
    const { key, keyId } = this.material();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.context(keyId, ownerId, walletId));
    const plain = JSON.stringify([credentials.apiKey, credentials.apiSecret]);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return {
      v: 1,
      keyId,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /** The stored key, or null when it cannot be opened (another server key, or tampering). */
  open(envelope: unknown, ownerId: string, walletId: string): BybitCredentials | null {
    try {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
      const value = envelope as SealedKey;
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
      decipher.setAAD(this.context(keyId, ownerId, walletId));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(decode(value.ciphertext, 512)),
        decipher.final(),
      ]).toString('utf8');
      const [apiKey, apiSecret] = JSON.parse(plain) as unknown[];
      if (!isApiKey(apiKey) || !isApiSecret(apiSecret)) return null;
      return { apiKey, apiSecret };
    } catch {
      return null;
    }
  }
}

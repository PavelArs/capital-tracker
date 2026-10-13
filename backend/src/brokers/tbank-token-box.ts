import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { readMfaKey } from '../auth/mfa-crypto';
import { isTBankToken } from './tbank-client';

// BROKER-CONNECT: the owner's T-Bank API token is stored encrypted and never shown again.
// AES-256-GCM with a key derived (HKDF-SHA256) from the server's MFA key file, so no new secret
// has to be provisioned; the envelope is bound to the owner and the broker account.

export interface SealedToken {
  v: 1;
  keyId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export class TBankTokenBox {
  private derived: { key: Buffer; keyId: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  // Read on first use: a server without the MFA key cannot store a token either.
  private material() {
    if (!this.derived) {
      const { key, keyId } = readMfaKey(this.config);
      const derived = Buffer.from(
        hkdfSync('sha256', key, Buffer.alloc(0), 'capital-tracker/tbank-api-token/v1', 32),
      );
      this.derived = { key: derived, keyId };
    }
    return this.derived;
  }

  private context(keyId: string, ownerId: string, accountId: string): Buffer {
    return Buffer.from(JSON.stringify(['capital-tracker/tbank/v1', keyId, ownerId, accountId]));
  }

  seal(token: string, ownerId: string, accountId: string): SealedToken {
    if (!isTBankToken(token)) throw new Error('Invalid T-Bank token');
    const { key, keyId } = this.material();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.context(keyId, ownerId, accountId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify([token]), 'utf8'),
      cipher.final(),
    ]);
    return {
      v: 1,
      keyId,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  /** The stored token, or null when it cannot be opened (another server key, or tampering). */
  open(envelope: unknown, ownerId: string, accountId: string): string | null {
    try {
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
      const value = envelope as SealedToken;
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
      decipher.setAAD(this.context(keyId, ownerId, accountId));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(decode(value.ciphertext, 512)),
        decipher.final(),
      ]).toString('utf8');
      const [token] = JSON.parse(plain) as unknown[];
      return isTBankToken(token) ? token : null;
    } catch {
      return null;
    }
  }
}

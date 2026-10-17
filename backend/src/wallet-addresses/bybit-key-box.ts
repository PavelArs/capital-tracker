import { ConfigService } from '@nestjs/config';
import { SealedBox } from '../auth/mfa-crypto';
import type { BybitCredentials } from './bybit-client';

// BYBIT-KEY, PR-EXC-1: the owner's Bybit API key and secret are stored encrypted and never
// shown again, bound to the owner and the account.

const keyPattern = /^[0-9A-Za-z]{10,64}$/;
const secretPattern = /^[0-9A-Za-z]{10,128}$/;

export const isApiKey = (value: unknown): value is string =>
  typeof value === 'string' && keyPattern.test(value);
export const isApiSecret = (value: unknown): value is string =>
  typeof value === 'string' && secretPattern.test(value);

export class BybitKeyBox extends SealedBox<BybitCredentials> {
  constructor(config: ConfigService) {
    super(
      config,
      'capital-tracker/bybit-api-key/v1',
      'capital-tracker/bybit/v1',
      ({ apiKey, apiSecret }) => {
        if (!isApiKey(apiKey) || !isApiSecret(apiSecret)) throw new Error('Invalid Bybit key');
        return [apiKey, apiSecret];
      },
      ([apiKey, apiSecret]) =>
        isApiKey(apiKey) && isApiSecret(apiSecret) ? { apiKey, apiSecret } : null,
    );
  }
}

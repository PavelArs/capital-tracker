import { ConfigService } from '@nestjs/config';
import { SealedBox } from '../auth/mfa-crypto';
import { isTBankToken } from './tbank-client';

// BROKER-CONNECT: the owner's T-Bank API token is stored encrypted and never shown again, bound
// to the owner and the broker account.
export class TBankTokenBox extends SealedBox<string> {
  constructor(config: ConfigService) {
    super(
      config,
      'capital-tracker/tbank-api-token/v1',
      'capital-tracker/tbank/v1',
      (token) => {
        if (!isTBankToken(token)) throw new Error('Invalid T-Bank token');
        return [token];
      },
      ([token]) => (isTBankToken(token) ? token : null),
    );
  }
}

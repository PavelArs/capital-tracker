import { NotFoundException } from '@nestjs/common';

// Asset-related exceptions
export class AssetNotFoundException extends NotFoundException {
  constructor(assetId: string) {
    super(`Asset with ID "${assetId}" not found`);
  }
}

// Liability-related exceptions
export class LiabilityNotFoundException extends NotFoundException {
  constructor(liabilityId: string) {
    super(`Liability with ID "${liabilityId}" not found`);
  }
}

// Currency-related exceptions
export class CurrencyNotFoundException extends NotFoundException {
  constructor(currencyId: string) {
    super(`Currency with ID "${currencyId}" not found`);
  }
}

// Crypto-related exceptions
export class CryptoWalletNotFoundException extends NotFoundException {
  constructor(walletId: string) {
    super(`Crypto wallet with ID "${walletId}" not found`);
  }
}

import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

// User-related exceptions
export class UserNotFoundException extends NotFoundException {
  constructor(identifier: string) {
    super(`User with identifier "${identifier}" not found`);
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    super('Invalid email or password');
  }
}

export class EmailNotVerifiedException extends UnauthorizedException {
  constructor() {
    super(
      'Please verify your email before logging in. Check your inbox for the verification link.',
    );
  }
}

export class DuplicateEmailException extends ConflictException {
  constructor(email: string) {
    super(`User with email "${email}" already exists`);
  }
}

// Token-related exceptions
export class InvalidTokenException extends BadRequestException {
  constructor(tokenType: 'verification' | 'reset') {
    super(`Invalid or expired ${tokenType} token`);
  }
}

// Invitation code exceptions
export class InvalidInvitationCodeException extends BadRequestException {
  constructor() {
    super('Invalid invitation code');
  }
}

export class InvitationCodeAlreadyUsedException extends BadRequestException {
  constructor() {
    super('Invitation code has already been used');
  }
}

export class InvitationCodeNotAllowedException extends ForbiddenException {
  constructor() {
    super(
      'Invitation codes are only available for Pro and Enterprise subscribers. Upgrade your subscription to share invitations.',
    );
  }
}

export class ActiveInvitationCodeExistsException extends BadRequestException {
  constructor() {
    super('You already have an active invitation code');
  }
}

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

// Capital-related exceptions
export class CapitalNotFoundException extends NotFoundException {
  constructor(capitalId: string) {
    super(`Capital with ID "${capitalId}" not found`);
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

export class SubscriptionRequiredException extends ForbiddenException {
  constructor(requiredType: string) {
    super(`This feature requires ${requiredType} subscription`);
  }
}

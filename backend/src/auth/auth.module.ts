import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthClientSourceModule } from './client-source.module';
import { SessionGuard } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetMailer, resetMailSettings } from './password-reset-mailer';
import { AuthRequestLimitsService } from './request-limits.service';
import { SecurityController } from './security.controller';
import { SessionService } from './session.service';

@Module({
  imports: [TypeOrmModule.forFeature([OwnerAuth]), AuthClientSourceModule],
  controllers: [AuthController, PasswordResetController, SecurityController],
  providers: [
    AuthService,
    AuthRequestLimitsService,
    SessionService,
    MfaService,
    PasswordResetService,
    // Yandex SMTP credentials (Q5) come from the server's environment, never from the code.
    {
      provide: PasswordResetMailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PasswordResetMailer(resetMailSettings((key) => config.get<string>(key))),
    },
    // Order matters: global guards run in registration order.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}

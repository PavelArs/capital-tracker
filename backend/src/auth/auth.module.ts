import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthClientSourceModule } from './client-source.module';
import { SessionGuard } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { AuthRequestLimitsService } from './request-limits.service';
import { SessionService } from './session.service';

@Module({
  imports: [TypeOrmModule.forFeature([OwnerAuth]), AuthClientSourceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRequestLimitsService,
    SessionService,
    MfaService,
    // Order matters: global guards run in registration order.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}

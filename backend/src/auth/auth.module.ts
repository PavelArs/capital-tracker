import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';

@Module({
  imports: [TypeOrmModule.forFeature([OwnerAuth])],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    MfaService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}

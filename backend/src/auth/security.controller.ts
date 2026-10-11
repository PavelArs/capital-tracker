import { Body, Controller, Delete, Get, HttpCode, Param, Post, Request, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { FactorDto } from './dto/factor.dto';
import { AuthenticatorConfirmDto, ChangePasswordDto, RecoveryCodesDto } from './dto/security.dto';
import { SessionRequest } from './guards/session.guard';
import { MfaService, RecoveryStatus, ReplacementOutput } from './mfa.service';
import { AuthRequestLimit } from './request-limit.decorator';
import { COOKIE_OPTIONS, ListedSession, SESSION_COOKIE, SessionService } from './session.service';

// PR-AUTH-4, Settings → Security. Private like every route: a full session, and for writes
// the exact Origin and CSRF token.
@ApiTags('auth')
@Controller('auth/security')
export class SecurityController {
  constructor(
    private readonly sessions: SessionService,
    private readonly factors: MfaService,
  ) {}

  @Get()
  async overview(
    @CurrentUser() user: OwnerIdentity,
    @Request() req: SessionRequest,
  ): Promise<{ recoveryCodes: RecoveryStatus; sessions: ListedSession[] }> {
    return {
      recoveryCodes: await this.factors.recoveryStatus(user.userId),
      sessions: await this.sessions.list(user.userId, req.authSession.hash),
    };
  }

  // Shares the sign-in factor budget per client, on top of the owner's factor limits.
  @AuthRequestLimit('mfa-ip')
  @Post('recovery-codes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Replace every recovery code after a fresh TOTP; codes shown once' })
  async regenerate(
    @CurrentUser() user: OwnerIdentity,
    @Body() body: RecoveryCodesDto,
  ): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.factors.regenerateRecoveryCodes(user.userId, body.code) };
  }

  // SEC-TOTP: a fresh TOTP or recovery code starts a new authenticator; its key is shown once.
  @AuthRequestLimit('mfa-ip')
  @Post('authenticator')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start replacing the authenticator after a fresh factor' })
  async prepareAuthenticator(
    @CurrentUser() user: OwnerIdentity,
    @Body() body: FactorDto,
  ): Promise<ReplacementOutput> {
    return this.factors.prepareReplacement(user.userId, body);
  }

  @AuthRequestLimit('mfa-ip')
  @Post('authenticator/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activate the new authenticator with its first code; new recovery codes shown once',
  })
  async confirmAuthenticator(
    @CurrentUser() user: OwnerIdentity,
    @Request() req: SessionRequest,
    @Body() body: AuthenticatorConfirmDto,
  ): Promise<{ recoveryCodes: string[] }> {
    return {
      recoveryCodes: await this.factors.confirmReplacement(
        user.userId,
        req.authSession.hash,
        body.candidateId,
        body.code,
      ),
    };
  }

  // SEC-PASSWORD: the current password and a fresh TOTP; every other browser is signed out.
  @AuthRequestLimit('mfa-ip')
  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change the password after the current one and a fresh TOTP' })
  async changePassword(
    @CurrentUser() user: OwnerIdentity,
    @Request() req: SessionRequest,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    await this.factors.changePassword(user.userId, req.authSession.hash, body);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async endSession(
    @CurrentUser() user: OwnerIdentity,
    @Request() req: SessionRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.sessions.revokeOther(user.userId, req.authSession.hash, id);
  }

  @Post('logout-everywhere')
  @HttpCode(204)
  @ApiOperation({ summary: 'End every session of the owner, this browser included' })
  async logoutEverywhere(
    @CurrentUser() user: OwnerIdentity,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revokeAll(user.userId);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Request,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { AuthService } from './auth.service';
import { FactorDto } from './dto/factor.dto';
import { LoginDto } from './dto/login.dto';
import { SessionRequest } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { AllowPending, Public } from './public.decorator';
import {
  COOKIE_OPTIONS,
  SESSION_COOKIE,
  SessionService,
  readSessionCookie,
} from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly factors: MfaService,
  ) {}

  @Public()
  @Get('csrf')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async csrf(@Request() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    if (req.headers.origin !== undefined) this.sessions.checkOrigin(req.headers.origin);
    const state = await this.sessions.csrf(readSessionCookie(req.headers.cookie));
    if (state.token)
      res.cookie(SESSION_COOKIE, state.token, { ...COOKIE_OPTIONS, maxAge: 5 * 60 * 1000 });
    return { csrfToken: state.csrfToken };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBody({ type: LoginDto })
  @ApiOperation({ summary: 'Verify the owner password and begin second-factor verification' })
  async login(
    @Body() credentials: LoginDto,
    @Request() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const verified = await this.auth.validateUser(credentials.email, credentials.password);
    if (!verified) throw new UnauthorizedException();
    const state = await this.sessions.rotate(req.authSession.hash, verified);
    res.cookie(SESSION_COOKIE, state.token, { ...COOKIE_OPTIONS, maxAge: 5 * 60 * 1000 });
    return { mfaRequired: true, csrfToken: state.csrfToken };
  }

  @AllowPending()
  @Post('mfa')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async mfa(
    @Body() factor: FactorDto,
    @Request() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const state = await this.factors.complete(req.authSession.hash, factor);
    res.cookie(SESSION_COOKIE, state.token, { ...COOKIE_OPTIONS, maxAge: 12 * 60 * 60 * 1000 });
    return { user: state.user, csrfToken: state.csrfToken };
  }

  @AllowPending()
  @Post('logout')
  @HttpCode(204)
  async logout(@Request() req: SessionRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(req.authSession.hash);
    res.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
  }

  @Get('me')
  getProfile(@CurrentUser() user: OwnerIdentity) {
    return this.auth.getProfile(user.userId);
  }
}

import 'reflect-metadata';
import { Controller, Get, INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { ApplicationThrottlerModule } from './application-throttler.module';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordResetService } from './password-reset.service';
import { AuthRequestLimitsService } from './request-limits.service';
import { readSessionCookie, SESSION_COOKIE, SessionService } from './session.service';

// Guard order through the real AuthModule/throttler wiring. Sessions are a stub that only
// recognizes one opaque cookie; this is not PostgreSQL or browser evidence.
const ownerToken = 'O'.repeat(43);

@Controller('probe')
class ProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

const sessions = {
  authorize: async (token: string | undefined) => {
    if (token !== ownerToken) throw new UnauthorizedException();
    return {
      hash: 'owner-session-hash',
      csrfToken: 'C'.repeat(43),
      state: 'authenticated',
      user: { userId: 'owner', email: 'owner@example.invalid' },
    };
  },
};

describe('THROTTLE-ORDER private-route throttling after session authorization', () => {
  let app: INestApplication;
  let base: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ TRUSTED_PROXY_IPS: '[]' })],
        }),
        ApplicationThrottlerModule,
        AuthModule,
      ],
      controllers: [ProbeController],
    })
      .overrideProvider(SessionService)
      .useValue(sessions)
      .overrideProvider(AuthService)
      .useValue({})
      .overrideProvider(MfaService)
      .useValue({})
      .overrideProvider(PasswordResetService)
      .useValue({})
      .overrideProvider(AuthRequestLimitsService)
      .useValue({})
      .overrideProvider(getRepositoryToken(OwnerAuth))
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/probe`.replace('[::1]', '127.0.0.1');
  });

  afterEach(() => app.close());

  const owner = () => fetch(base, { headers: { cookie: `${SESSION_COOKIE}=${ownerToken}` } });

  it('keeps refusing anonymous floods as 401 and leaves the owner budget untouched', async () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=${ownerToken}`)).toBe(ownerToken);
    const anonymous: number[] = [];
    for (let i = 0; i < 105; i += 1) anonymous.push((await fetch(base)).status);
    expect(new Set(anonymous)).toEqual(new Set([401]));
    expect((await owner()).status).toBe(200);
  });

  it('still limits one authenticated session after its own 100 requests', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 101; i += 1) statuses.push((await owner()).status);
    expect(statuses.slice(0, 100)).toEqual(Array(100).fill(200));
    expect(statuses[100]).toBe(429);
  });
});

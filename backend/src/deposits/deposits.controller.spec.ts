import 'reflect-metadata';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApplicationThrottlerModule } from '../auth/application-throttler.module';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { MfaService } from '../auth/mfa.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { AuthRequestLimitsService } from '../auth/request-limits.service';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import { OwnerAuth } from '../entities/owner-auth.entity';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';

// DEP-PREVIEW through the real AuthModule guard wiring and the real controller and service. The
// session is a stub that knows one opaque cookie, and the database is a stub that fails the test
// if it is touched at all: a preview reads and writes nothing. This is not PostgreSQL evidence.
const ownerToken = 'O'.repeat(43);
const ownerId = '8b0f2f3e-5a53-4f63-9a2a-0d6f5b9a1c01';

const sessions = {
  authorize: async (token: string | undefined) => {
    if (token !== ownerToken) throw new UnauthorizedException();
    return {
      hash: 'owner-session-hash',
      csrfToken: 'C'.repeat(43),
      state: 'authenticated',
      user: { userId: ownerId, email: 'owner@example.invalid' },
    };
  },
};

const touched: string[] = [];
const use = (name: string) => () => {
  touched.push(name);
  throw new Error(`The preview used the database (${name})`);
};
const database = {
  transaction: use('transaction'),
  query: use('query'),
  createQueryRunner: use('createQueryRunner'),
  getRepository: use('getRepository'),
  get manager() {
    return use('manager')();
  },
};

// Synthetic terms: 100,000.00 RUB at 12% from Jan 1 to Apr 1, 2026, interest monthly.
const terms = {
  name: 'Synthetic deposit',
  bank: 'Synthetic Bank',
  currency: 'RUB',
  startDate: '2026-01-01',
  endDate: '2026-04-01',
  payout: 'monthly',
  capitalized: false,
  dayBasis: 'actual-365',
  earlyClose: 'forfeits-interest',
  ratePercent: '12',
  amount: '100000',
};

describe('DEP-PREVIEW: what a deposit would earn, before it is added', () => {
  let app: INestApplication;
  let base: string;

  beforeEach(async () => {
    touched.length = 0;
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
      controllers: [DepositsController],
      providers: [DepositsService, { provide: DataSource, useValue: database }],
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
    base = `${await app.getUrl()}/deposits/preview`.replace('[::1]', '127.0.0.1');
  });

  afterEach(() => app.close());

  const preview = (body: unknown, cookie = `${SESSION_COOKIE}=${ownerToken}`) =>
    fetch(base, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('DEP-PREVIEW-MATURITY gives the end balance, its interest and the first interest date as exact decimals', async () => {
    const answer = await preview(terms);
    expect(answer.status).toBe(200);
    // Jan 31 days, Feb 28, Mar 31 on 100,000.00 at 12% / 365, each month rounded to the cent.
    expect(await answer.json()).toEqual({
      atMaturity: { date: '2026-04-01', balance: '102958.91', interest: '2958.91' },
      firstPayout: { date: '2026-02-01', interest: '1019.18', treatment: 'payable' },
    });
    expect(touched).toEqual([]);
  });

  it('DEP-PREVIEW-CAPITALIZED counts interest on the interest added each month', async () => {
    const answer = await preview({ ...terms, capitalized: true });
    expect(answer.status).toBe(200);
    // Jan 1,019.18; Feb 929.93 on 101,019.18; Mar 1,039.04 on 101,949.11.
    expect(await answer.json()).toEqual({
      atMaturity: { date: '2026-04-01', balance: '102988.15', interest: '2988.15' },
      firstPayout: { date: '2026-02-01', interest: '1019.18', treatment: 'capitalized' },
    });
  });

  it('DEP-PREVIEW-NO-TERM states no end balance for a deposit without an end date', async () => {
    const answer = await preview({ ...terms, endDate: null });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      atMaturity: null,
      firstPayout: { date: '2026-02-01', interest: '1019.18', treatment: 'payable' },
    });
  });

  it('DEP-PREVIEW-INPUT refuses what adding the deposit refuses, and a request id', async () => {
    expect((await preview({ ...terms, amount: '0' })).status).toBe(400);
    expect((await preview({ ...terms, payout: 'at-end', endDate: null })).status).toBe(400);
    expect((await preview({ ...terms, payout: 'quarterly' })).status).toBe(400);
    expect(
      (await preview({ ...terms, requestId: '5b1d9a6e-6d0b-4b6e-9b66-0f1d3c7a1a01' })).status,
    ).toBe(400);
    expect((await preview({ ...terms, startDate: '2999-01-01', endDate: null })).status).toBe(422);
    expect(touched).toEqual([]);
  });

  it('DEP-PREVIEW-SESSION needs a signed-in owner like every other route', async () => {
    expect((await preview(terms, '')).status).toBe(401);
    expect(touched).toEqual([]);
  });
});

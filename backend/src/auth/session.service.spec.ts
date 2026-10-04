import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AuthController } from './auth.controller';
import { AuthService, ValidatedOwner } from './auth.service';
import { SessionRequest } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { AuthRequestLimitsService } from './request-limits.service';
import { SESSION_COOKIE, SessionRow, SessionService } from './session.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('SES-001-C a full owner session lasts one day after sign-in', () => {
  const config = { get: () => 'https://capital.example.test' } as unknown as ConfigService;
  const service = new SessionService({} as DataSource, config);
  const now = new Date('2026-10-04T12:00:00Z');
  const owner: ValidatedOwner = {
    user: { id: 'owner-id', email: 'owner@example.invalid' },
    credentialVersion: 'revision',
  } as unknown as ValidatedOwner;
  const fullRow = (signedInAgo: number, lastSeenAgo: number): SessionRow => ({
    tokenHash: 'hash',
    csrfToken: 'csrf',
    state: 'authenticated',
    userId: 'owner-id',
    credentialVersion: 'revision',
    boundUserId: 'owner-id',
    boundVersion: 'revision',
    ownerEmail: 'owner@example.invalid',
    createdAt: new Date(now.getTime() - signedInAgo),
    lastSeenAt: new Date(now.getTime() - lastSeenAgo),
    expiresAt: new Date(now.getTime() - signedInAgo + DAY),
    databaseNow: now,
    failedAttempts: 0,
    mfaVerifiedAt: new Date(now.getTime() - signedInAgo),
  });

  it('stays valid after hours without activity within the day', () => {
    expect(service.valid(fullRow(23 * HOUR, 23 * HOUR))).toBe(true);
    expect(service.valid(fullRow(5 * HOUR, 3 * HOUR))).toBe(true);
  });

  it('expires at the absolute deadline one day after sign-in', () => {
    expect(service.valid(fullRow(DAY, 0))).toBe(false);
  });

  it('stores a full session with a one-day deadline', async () => {
    const query = jest.fn().mockResolvedValue([{ now }]);
    const manager = { query } as unknown as EntityManager;
    await service.issueAuthenticated(manager, fullRow(0, 0), owner);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
    expect(insert?.[1][5]).toBe(DAY);
  });

  it('gives the browser cookie the same one-day lifetime', async () => {
    const factors = {
      complete: jest.fn().mockResolvedValue({ token: 't', csrfToken: 'c', user: owner.user }),
    } as unknown as MfaService;
    const controller = new AuthController(
      {} as AuthService,
      service,
      factors,
      {} as AuthRequestLimitsService,
    );
    const cookie = jest.fn();
    await controller.mfa(
      { kind: 'totp', code: '000000' },
      { authSession: { hash: 'hash' } } as unknown as SessionRequest,
      { cookie } as unknown as Response,
    );
    expect(cookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      't',
      expect.objectContaining({ maxAge: DAY }),
    );
  });
});

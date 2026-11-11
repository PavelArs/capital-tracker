import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionRequest } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { AuthRequestLimitsService } from './request-limits.service';
import { SessionService } from './session.service';

// SES-BOOTSTRAP: a page of another site must not start a session in the owner's browser. Synthetic
// origin and tokens only.
describe('SES-BOOTSTRAP GET /auth/csrf and where the request comes from', () => {
  const config = { get: () => 'https://capital.example.test' } as unknown as ConfigService;
  const setup = () => {
    const sessions = new SessionService({} as DataSource, config);
    const csrf = jest
      .spyOn(sessions, 'csrf')
      .mockResolvedValue({ token: 'new-token', csrfToken: 'csrf-token' });
    const controller = new AuthController(
      {} as AuthService,
      sessions,
      {} as MfaService,
      {} as AuthRequestLimitsService,
    );
    const cookie = jest.fn();
    const call = (headers: Record<string, string | string[]>) =>
      controller.csrf({ headers } as unknown as SessionRequest, { cookie } as unknown as Response);
    return { csrf, cookie, call };
  };

  it.each([
    ['cross-site', 'a page of another site'],
    ['same-site', 'a sibling subdomain, a navigation without Origin'],
    ['unknown', 'a value no browser sends'],
  ])('refuses %s (%s) before any session or cookie exists', async (site) => {
    const { csrf, cookie, call } = setup();
    await expect(call({ 'sec-fetch-site': site })).rejects.toMatchObject({ status: 403 });
    expect(csrf).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it('refuses a repeated header', async () => {
    const { csrf, call } = setup();
    // Node joins a repeated header into one string.
    await expect(call({ 'sec-fetch-site': 'same-origin, cross-site' })).rejects.toMatchObject({
      status: 403,
    });
    expect(csrf).not.toHaveBeenCalled();
  });

  it.each<[Record<string, string>, string]>([
    [{ 'sec-fetch-site': 'same-origin', origin: 'https://capital.example.test' }, 'the app'],
    [{ 'sec-fetch-site': 'same-origin' }, 'the app without Origin on a GET'],
    [{ 'sec-fetch-site': 'none' }, 'the visitor typing the address'],
    [
      { 'sec-fetch-site': 'same-site', origin: 'https://capital.example.test' },
      'the frontend calling an API on a sibling subdomain, named by Origin',
    ],
    [{}, 'a client that sends no fetch metadata'],
  ])('bootstraps for %j (%s)', async (headers, _who) => {
    const { csrf, cookie, call } = setup();
    await expect(call(headers)).resolves.toEqual({ csrfToken: 'csrf-token' });
    expect(csrf).toHaveBeenCalledTimes(1);
    expect(cookie).toHaveBeenCalledTimes(1);
  });

  it('refuses cross-site even when it names the configured Origin', async () => {
    const { csrf, call } = setup();
    await expect(
      call({ 'sec-fetch-site': 'cross-site', origin: 'https://capital.example.test' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(csrf).not.toHaveBeenCalled();
  });

  it('still refuses another Origin whatever the fetch metadata says', async () => {
    const { csrf, call } = setup();
    await expect(
      call({ 'sec-fetch-site': 'same-origin', origin: 'https://other.example.test' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(csrf).not.toHaveBeenCalled();
  });
});

import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionRequest } from './guards/session.guard';
import { MfaService } from './mfa.service';
import { AuthRequestLimitsService } from './request-limits.service';
import { SecurityController } from './security.controller';
import { COOKIE_OPTIONS, SESSION_COOKIE, SessionService } from './session.service';
import { deviceLabel } from './session-device';

describe('SEC-SESSIONS the session list names each browser by its User-Agent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome on iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
      'Firefox on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/25.8.0.0 Safari/537.36',
      'Yandex Browser on Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/124.0.0.0',
      'Opera on Windows',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'Chrome on Linux',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPad',
    ],
    ['curl/8.11.0', null],
    ['', null],
    [undefined, null],
    [['Chrome/1', 'Firefox/2'], null],
  ])('%s → %s', (agent, label) => {
    expect(deviceLabel(agent)).toBe(label);
  });

  it('names only a known browser or system, never echoing the header', () => {
    const label = deviceLabel(`<script>alert(1)</script> Firefox/1 ${'x'.repeat(5000)}`);
    expect(label).toBe('Firefox');
  });

  it('stores the label of the browser that completes the factor', async () => {
    const complete = jest.fn().mockResolvedValue({ token: 't', csrfToken: 'c', user: {} });
    const controller = new AuthController(
      {} as AuthService,
      {} as SessionService,
      { complete } as unknown as MfaService,
      {} as AuthRequestLimitsService,
    );
    await controller.mfa(
      { kind: 'totp', code: '000000' },
      {
        authSession: { hash: 'hash' },
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0' },
      } as unknown as SessionRequest,
      { cookie: jest.fn() } as unknown as Response,
    );
    expect(complete).toHaveBeenCalledWith('hash', expect.anything(), 'Firefox on Linux');
  });
});

describe('SEC-SESSIONS log out everywhere', () => {
  it('ends every owner session and clears this browser cookie', async () => {
    const revokeAll = jest.fn().mockResolvedValue(undefined);
    const controller = new SecurityController(
      { revokeAll } as unknown as SessionService,
      {} as MfaService,
    );
    const clearCookie = jest.fn();
    await controller.logoutEverywhere({ userId: 'owner-id', email: 'owner@example.invalid' }, {
      clearCookie,
    } as unknown as Response);
    expect(revokeAll).toHaveBeenCalledWith('owner-id');
    expect(clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, COOKIE_OPTIONS);
  });
});

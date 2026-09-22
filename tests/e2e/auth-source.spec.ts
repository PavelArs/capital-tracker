import { expect } from '@playwright/test';
import {
  type Enrollment,
  type Factor,
  databaseCounter,
  fingerprint,
  hashToken,
  cookieName,
  owner,
  query,
  recoveryFactor,
  test,
  totpAt,
} from './mfa-fixtures';
import {
  type SourceJar,
  type SourceResponse,
  sendDirect,
  sendFrom,
} from './source-client';

type Client = 'client-a' | 'client-b';
const clientA = '172.30.90.10';
const clientB = '172.30.90.11';
const wrongCredentials = { email: owner.email, password: 'Synthetic-wrong-password-42!' };

function noStore(response: SourceResponse) {
  expect(response.headers['cache-control']).toContain('no-store');
}

function csrfValue(response: SourceResponse): string {
  expect(response.status).toBe(200);
  expect(response.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return response.body.csrfToken as string;
}

async function anonymous(client: Client) {
  const result = await sendFrom(client, { requests: [{ method: 'GET', path: '/api/auth/csrf' }] });
  expect(result.jar[cookieName]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { jar: result.jar, csrfToken: csrfValue(result.responses[0]) };
}

async function pending(client: Client) {
  const session = await anonymous(client);
  const result = await sendFrom(client, {
    jar: session.jar,
    requests: [{
      method: 'POST', path: '/api/auth/login',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: { email: owner.email, password: owner.password },
    }],
  });
  expect(result.responses[0].status).toBe(200);
  expect(result.responses[0].body).toEqual({
    mfaRequired: true, csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  });
  expect(result.jar[cookieName]).not.toBe(session.jar[cookieName]);
  return { jar: result.jar, csrfToken: result.responses[0].body.csrfToken as string };
}

async function factor(client: Client, session: { jar: SourceJar; csrfToken: string }, value: Factor) {
  return sendFrom(client, {
    jar: session.jar,
    requests: [{ method: 'POST', path: '/api/auth/mfa',
      headers: { 'X-CSRF-Token': session.csrfToken }, body: value }],
  });
}

function wrongFactor(enrollment: Enrollment): Factor {
  const counter = databaseCounter();
  const valid = new Set([-1, 0, 1, 2].map((offset) => totpAt(enrollment, counter + offset)));
  for (let value = 0; value < 100; value++) {
    const code = value.toString().padStart(6, '0');
    if (!valid.has(code)) return { kind: 'totp', code };
  }
  throw new Error('Cannot select a synthetic invalid factor');
}

function wrongLogins(csrfToken: string, count: number) {
  return Array.from({ length: count }, () => ({
    method: 'POST', path: '/api/auth/login',
    headers: { 'X-CSRF-Token': csrfToken }, body: wrongCredentials,
  }));
}

test('PROXY-001-A: one real client cannot exhaust another client password quota', async ({ mfa }) => {
  const before = fingerprint();
  const a = await anonymous('client-a');
  const exhausted = await sendFrom('client-a', { jar: a.jar, requests: wrongLogins(a.csrfToken, 6) });
  expect(exhausted.responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 429]);
  expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe('0');

  const b = await pending('client-b');
  const authenticated = await factor('client-b', b, recoveryFactor(mfa));
  expect(authenticated.responses[0].status).toBe(200);
  expect(authenticated.responses[0].body.user).toMatchObject({ id: owner.id, email: owner.email });
  const profile = await sendFrom('client-b', {
    jar: authenticated.jar, requests: [{ method: 'GET', path: '/api/auth/me' }],
  });
  expect(profile.responses[0].status).toBe(200);
  expect(profile.responses[0].body).toMatchObject({ id: owner.id, email: owner.email });
  expect(fingerprint()).toBe(before);
});

test('PROXY-001-C: thirty CSRF admissions are isolated by the actual HTTPS client source', async () => {
  const before = fingerprint();
  const a = await sendFrom('client-a', {
    requests: Array.from({ length: 30 }, (_, index) => ({
      method: index % 2 ? 'HEAD' : 'GET', path: '/api/auth/csrf',
    })),
  });
  expect(a.responses.map((response) => response.status)).toEqual(Array(30).fill(200));
  const unchanged = fingerprint([]);
  const exhausted = await sendFrom('client-a', {
    jar: a.jar, requests: [{ method: 'GET', path: '/api/auth/csrf' }],
  });
  expect(exhausted.responses[0].status).toBe(429);
  expect(fingerprint([])).toBe(unchanged);
  await anonymous('client-b');
  expect(fingerprint()).toBe(before);
});

test('PROXY-001-C: factor source limits preserve independent owner failure accounting', async ({ mfa }) => {
  const before = fingerprint();
  const a = await pending('client-a');
  const wrong = wrongFactor(mfa);
  const attempted = await sendFrom('client-a', {
    jar: a.jar,
    requests: Array.from({ length: 5 }, () => ({
      method: 'POST', path: '/api/auth/mfa',
      headers: { 'X-CSRF-Token': a.csrfToken }, body: wrong,
    })),
  });
  expect(attempted.responses.map((response) => response.status)).toEqual(Array(5).fill(401));
  expect(query('SELECT "failedAttempts" FROM owner_mfa WHERE id = 1')).toBe('5');
  expect(query(`SELECT count(*) FROM auth_sessions WHERE "tokenHash" = '${hashToken(a.jar[cookieName])}'`)).toBe('0');
  expect(query("SELECT count(*) FROM auth_sessions WHERE state = 'authenticated'")).toBe('0');
  const renewed = await pending('client-a');
  const exhausted = await factor('client-a', renewed, wrong);
  expect(exhausted.responses[0].status).toBe(429);
  expect(query('SELECT "failedAttempts" FROM owner_mfa WHERE id = 1')).toBe('5');

  const b = await pending('client-b');
  const authenticated = await factor('client-b', b, recoveryFactor(mfa));
  expect(authenticated.responses[0].status).toBe(200);
  expect(authenticated.responses[0].body.user).toMatchObject({ id: owner.id });
  expect(query('SELECT "failedAttempts" FROM owner_mfa WHERE id = 1')).toBe('0');
  expect(fingerprint()).toBe(before);
});

test('PROXY-002-A: edge-sanitized forwarding forgeries cannot reset or target a quota', async () => {
  const a = await anonymous('client-a');
  const b = await anonymous('client-b');
  const exhausted = await sendFrom('client-a', { jar: a.jar, requests: wrongLogins(a.csrfToken, 5) });
  expect(exhausted.responses.map((response) => response.status)).toEqual(Array(5).fill(401));
  const examples: Record<string, string | string[]>[] = [
    { 'X-Forwarded-For': clientB },
    { 'X-Forwarded-For': `${clientB}, 192.0.2.123` },
    { 'X-Forwarded-For': [clientB, clientB] },
    { 'X-Real-IP': clientB },
    { Forwarded: `for=${clientB};proto=https` },
    { Host: 'forged.example.invalid' },
    { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'forged.example.invalid' },
  ];
  const probes = await sendFrom('client-a', {
    jar: a.jar,
    requests: examples.map((headers) => ({
      method: 'POST', path: '/api/auth/login',
      headers: { ...headers, 'X-CSRF-Token': a.csrfToken }, body: wrongCredentials,
    })),
  });
  expect(probes.responses.map((response) => response.status)).toEqual(Array(examples.length).fill(429));
  const victim = await sendFrom('client-b', { jar: b.jar, requests: wrongLogins(b.csrfToken, 6) });
  expect(victim.responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 429]);
});

test('PROXY-002-A: source attribution never replaces exact Origin and CSRF', async () => {
  const a = await anonymous('client-a');
  const before = fingerprint([]);
  const result = await sendFrom('client-a', {
    jar: a.jar,
    requests: [{ method: 'POST', path: '/api/auth/login',
      headers: { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': a.csrfToken,
        'X-Forwarded-For': clientB, 'X-Forwarded-Proto': 'http' },
      body: { email: owner.email, password: owner.password } }],
  });
  expect(result.responses[0].status).toBe(403);
  noStore(result.responses[0]);
  expect(fingerprint([])).toBe(before);
});

test('PROXY-002-B: malformed trusted metadata cannot touch real pending or full sessions', async ({ mfa }) => {
  const pendingA = await pending('client-a');
  const authenticated = await factor('client-a', pendingA, recoveryFactor(mfa));
  expect(authenticated.responses[0].status).toBe(200);
  const full = { jar: authenticated.jar, csrfToken: authenticated.responses[0].body.csrfToken as string };
  const pendingB = await pending('client-b');
  const before = fingerprint([]);
  const examples: Record<string, string | string[]>[] = [
    {}, { 'X-Forwarded-For': [clientA, clientA] },
    { 'X-Forwarded-For': `${clientA}, ${clientB}` },
    { 'X-Forwarded-For': 'invalid.example.invalid' },
  ];
  for (const session of [full, pendingB]) {
    for (const [method, path, body] of [
      ['GET', '/auth/csrf', undefined],
      ['POST', '/auth/login', { email: owner.email, password: owner.password }],
      ['POST', '/auth/mfa', { kind: 'totp', code: totpAt(mfa) }],
    ] as const) {
      const result = await sendDirect('trusted', {
        jar: session.jar,
        requests: examples.map((headers) => ({ method, path, body,
          headers: { ...headers, 'X-CSRF-Token': session.csrfToken } })),
      });
      for (const response of result.responses) {
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Invalid client address');
        noStore(response);
      }
      expect(fingerprint([])).toBe(before);
    }
  }
});

test('PROXY-002-B: invalid trusted metadata consumes no slots and still wins after exhaustion', async () => {
  const a = await anonymous('client-a');
  const malformed = { method: 'POST', path: '/auth/login',
    headers: { 'X-Forwarded-For': [clientA, clientA], 'X-CSRF-Token': a.csrfToken },
    body: wrongCredentials };
  const before = fingerprint([]);
  const invalid = await sendDirect('trusted', {
    jar: a.jar, requests: Array.from({ length: 7 }, () => malformed),
  });
  expect(invalid.responses.map((response) => response.status)).toEqual(Array(7).fill(400));
  expect(fingerprint([])).toBe(before);
  const valid = await sendFrom('client-a', { jar: a.jar, requests: wrongLogins(a.csrfToken, 6) });
  expect(valid.responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 429]);
  const fullBucket = fingerprint([]);
  const after = await sendDirect('trusted', { jar: a.jar, requests: [malformed] });
  expect(after.responses[0].status).toBe(400);
  noStore(after.responses[0]);
  expect(fingerprint([])).toBe(fullBucket);
});

test('PROXY-002-B: a direct untrusted peer cannot nominate a victim source', async () => {
  const requests = Array.from({ length: 31 }, () => ({
    method: 'GET', path: '/auth/csrf',
    headers: { 'X-Forwarded-For': clientA, 'X-Real-IP': clientB, Forwarded: `for=${clientA}` },
  }));
  const untrusted = await sendDirect('untrusted', { requests });
  expect(untrusted.responses.map((response) => response.status)).toEqual([...Array(30).fill(200), 429]);
  const a = await sendFrom('client-a', {
    requests: Array.from({ length: 31 }, () => ({ method: 'GET', path: '/api/auth/csrf' })),
  });
  expect(a.responses.map((response) => response.status)).toEqual([...Array(30).fill(200), 429]);
  await anonymous('client-b');
});

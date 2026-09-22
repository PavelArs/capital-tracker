import { expect } from '@playwright/test';
import { cookieName, fingerprint, owner, test } from './mfa-fixtures';
import { selectBackend, restartBackends, upstreamMark, upstreamsSince } from './replicas';
import { type SourceJar, type SourceResponse, sendFrom } from './source-client';

const clientA = '172.30.90.10';
const clientB = '172.30.90.11';
const upstreams = { primary: '172.30.91.10:3000', replica: '172.30.91.11:3000' };
const wrongCredentials = { email: owner.email, password: 'Synthetic-wrong-password-42!' };

// These first behavior tests also run on the previous image: they never read a
// future ledger table. Authentication sessions may be touched on that image;
// all other retained owner, MFA, and financial state must remain unchanged.
const retainedState = () => fingerprint(['auth_sessions', 'auth_request_limits']);

async function anonymous(client: 'client-a' | 'client-b') {
  const result = await sendFrom(client, {
    requests: [{ method: 'GET', path: '/api/auth/csrf' }],
  });
  expect(result.responses[0].status).toBe(200);
  expect(result.responses[0].body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.jar[cookieName]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { jar: result.jar, csrfToken: result.responses[0].body.csrfToken as string };
}

function wrongLogins(csrfToken: string, count: number) {
  return Array.from({ length: count }, () => ({
    method: 'POST', path: '/api/auth/login',
    headers: { 'X-CSRF-Token': csrfToken }, body: wrongCredentials,
  }));
}

async function exhaustPrimary(session: { jar: SourceJar; csrfToken: string }) {
  const mark = await upstreamMark();
  const started = Date.now();
  const result = await sendFrom('client-a', {
    jar: session.jar, requests: wrongLogins(session.csrfToken, 6),
  });
  expect(result.responses.map((response) => response.status)).toEqual([
    401, 401, 401, 401, 401, 429,
  ]);
  expect(result.jar[cookieName]).toBe(session.jar[cookieName]);
  const evidence = (await upstreamsSince(mark)).filter((entry) => entry.source === clientA);
  expect(evidence).toHaveLength(6);
  for (const entry of evidence) {
    expect(entry.backend).toBe('primary');
    expect(entry.upstream).toBe(upstreams.primary);
  }
  return started;
}

async function assertUpstream(mark: number, source: string, backend: 'primary' | 'replica', count = 1) {
  const evidence = (await upstreamsSince(mark)).filter((entry) => entry.source === source);
  expect(evidence).toHaveLength(count);
  for (const entry of evidence) {
    expect(entry.backend).toBe(backend);
    expect(entry.upstream).toBe(upstreams[backend]);
  }
}

function assertStillExhausted(response: SourceResponse, started: number) {
  expect(Date.now() - started, 'The fixed 60-second window cannot have expired').toBeLessThan(55_000);
  expect(response.status, 'A second process must retain the exhausted source admission budget').toBe(429);
}

test('LIMIT-001-A: a second real replica cannot grant an exhausted source another password guess', async () => {
  await selectBackend('primary');
  await restartBackends();
  try {
    const before = retainedState();
    const a = await anonymous('client-a');
    const started = await exhaustPrimary(a);

    await selectBackend('replica');
    const mark = await upstreamMark();
    const probe = await sendFrom('client-a', {
      jar: a.jar, requests: wrongLogins(a.csrfToken, 1),
    });
    // Prove actual routing before the behavior assertion, including on RED.
    await assertUpstream(mark, clientA, 'replica');
    expect(probe.jar[cookieName]).toBe(a.jar[cookieName]);

    const b = await anonymous('client-b');
    const bMark = await upstreamMark();
    const independent = await sendFrom('client-b', {
      jar: b.jar, requests: wrongLogins(b.csrfToken, 1),
    });
    await assertUpstream(bMark, clientB, 'replica');
    expect(independent.responses[0].status, 'Client B retains its independent source allowance').toBe(401);
    expect(retainedState()).toBe(before);
    assertStillExhausted(probe.responses[0], started);
  } finally {
    await selectBackend('both');
  }
});

test('LIMIT-001-B: restarting both real processes cannot reset an exhausted password budget', async () => {
  await selectBackend('primary');
  await restartBackends();
  try {
    const before = retainedState();
    const a = await anonymous('client-a');
    const started = await exhaustPrimary(a);

    // The helper independently verifies both restarts and both health checks.
    await restartBackends();
    await selectBackend('primary');
    const mark = await upstreamMark();
    const probe = await sendFrom('client-a', {
      jar: a.jar, requests: wrongLogins(a.csrfToken, 1),
    });
    await assertUpstream(mark, clientA, 'primary');
    expect(probe.jar[cookieName]).toBe(a.jar[cookieName]);
    expect(retainedState()).toBe(before);
    assertStillExhausted(probe.responses[0], started);
  } finally {
    await selectBackend('both');
  }
});

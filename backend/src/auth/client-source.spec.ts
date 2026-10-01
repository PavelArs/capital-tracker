import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  AUTH_CLIENT_SOURCE,
  AuthClientSourceService,
  canonicalIp,
  parseTrustedProxyIps,
  rateSubject,
} from './client-source';

const proxyIp = '172.30.91.2';
const clientIp = '172.30.90.10';

type SourceRequest = {
  socket: { remoteAddress?: string };
  headers: Record<string, unknown>;
  rawHeaders: string[];
  ip?: string;
};

function request(peer: string | undefined = proxyIp, client: unknown = clientIp): SourceRequest {
  return {
    socket: { remoteAddress: peer },
    headers: client === undefined ? {} : { 'x-forwarded-for': client },
    rawHeaders: client === undefined ? [] : ['X-Forwarded-For', String(client)],
    ip: peer,
  };
}

function service(peers = JSON.stringify([proxyIp])) {
  return new AuthClientSourceService(
    new ConfigService({ TRUSTED_PROXY_IPS: peers }),
    new Reflector(),
  );
}

function context(req: SourceRequest, marked = true) {
  const handler = () => {};
  if (marked) Reflect.defineMetadata(AUTH_CLIENT_SOURCE, true, handler);
  const response = { setHeader: jest.fn() };
  return {
    response,
    ctx: new ExecutionContextHost([req, response], class TestController {}, handler),
  };
}

function rejected(action: () => unknown) {
  try {
    action();
    throw new Error('Expected generic invalid-source rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getStatus()).toBe(400);
    expect((error as Error).message).toBe('Invalid client address');
  }
}

describe('PROXY-001-B explicit HTTP peer configuration', () => {
  it('accepts explicit direct mode and the bounded exact canonical peer set', () => {
    expect([...parseTrustedProxyIps('[]')]).toEqual([]);
    const ips = Array.from({ length: 8 }, (_, index) => `192.0.2.${index + 1}`);
    expect([...parseTrustedProxyIps(JSON.stringify(ips))]).toEqual(ips);
    expect([...parseTrustedProxyIps('["::ffff:192.0.2.1","2001:0db8:0000::1"]')]).toEqual([
      '192.0.2.1',
      '2001:db8::1',
    ]);
    // Trust is exact: different full peers in the same /64 remain distinct entries.
    expect(parseTrustedProxyIps('["2001:db8:1:2::1","2001:db8:1:2::2"]').size).toBe(2);
  });

  it.each([
    undefined,
    null,
    '',
    '[',
    'null',
    '{}',
    '"127.0.0.1"',
    'false',
    '42',
    [],
    '[null]',
    '[1]',
    '[true]',
    '[{}]',
    '[[]]',
    '[""]',
    '[" "]',
    '["localhost"]',
    '["loopback"]',
    '["uniquelocal"]',
    '["127.0.0.0/8"]',
    '["2001:db8::/32"]',
    '["127.0.0.1:3000"]',
    '["[::1]"]',
    '["fe80::1%eth0"]',
    '["127.1"]',
    '["127.000.0.1"]',
    '[" 127.0.0.1"]',
    '["127.0.0.1 "]',
    '["127.0.0.1","127.0.0.1"]',
    '["127.0.0.1","::ffff:127.0.0.1"]',
    '["2001:db8::1","2001:0db8:0:0:0:0:0:1"]',
    JSON.stringify(Array.from({ length: 9 }, (_, index) => `192.0.2.${index + 1}`)),
  ])('rejects missing or ambiguous configuration (%j) without echoing it', (value) => {
    let error: unknown;
    try {
      parseTrustedProxyIps(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    if (typeof value === 'string' && value.length > 2) {
      expect((error as Error).message).not.toContain(value);
    }
  });

  it('does not admit missing configuration through the service constructor', () => {
    expect(() => new AuthClientSourceService(new ConfigService({}), new Reflector())).toThrow();
  });
});

describe('PROXY-003-A canonical source and exact trust are separate', () => {
  it.each([
    ['192.0.2.1', '192.0.2.1', 'v4:192.0.2.1/32'],
    ['::ffff:192.0.2.1', '192.0.2.1', 'v4:192.0.2.1/32'],
    ['::ffff:c000:201', '192.0.2.1', 'v4:192.0.2.1/32'],
    [
      '2001:0DB8:1234:5678:0000:0000:0000:0001',
      '2001:db8:1234:5678::1',
      'v6:2001:db8:1234:5678::/64',
    ],
    ['2001:db8:1234:5678:ffff::2', '2001:db8:1234:5678:ffff::2', 'v6:2001:db8:1234:5678::/64'],
    ['2001:db8:1234:5679::1', '2001:db8:1234:5679::1', 'v6:2001:db8:1234:5679::/64'],
    ['::1', '::1', 'v6:::/64'],
  ])('normalizes %s independently of proxy trust', (input, canonical, subject) => {
    expect(canonicalIp(input)).toBe(canonical);
    expect(rateSubject(canonical)).toBe(subject);
  });

  it.each([
    undefined,
    null,
    0,
    {},
    [],
    ['192.0.2.1'],
    '',
    'localhost',
    '127.1',
    '2130706433',
    '0x7f000001',
    '192.0.2.01',
    '256.0.0.1',
    '[::1]',
    'fe80::1%eth0',
    '192.0.2.1:443',
    '2001:db8::/64',
    ' 192.0.2.1',
    '192.0.2.1 ',
    '192.0.2.1,192.0.2.2',
    '192.0.2.1\r\nX-Other: value',
  ])('rejects nonstandard or nonliteral input %j', (value) => {
    rejected(() => canonicalIp(value));
  });

  it('never coerces an object while parsing its source', () => {
    const value = { toString: jest.fn(() => '192.0.2.1') };
    rejected(() => canonicalIp(value));
    expect(value.toString).not.toHaveBeenCalled();
  });

  it('allows a mapped exact peer but never expands trust to its IPv6 /64 neighbors', () => {
    expect(service().resolve(request(`::ffff:${proxyIp}`))).toEqual({
      peer: proxyIp,
      client: clientIp,
      subject: `v4:${clientIp}/32`,
    });
    const sources = service('["2001:db8:1:2::1"]');
    const trusted = sources.resolve(request('2001:0db8:1:2::1', '192.0.2.55'));
    expect(trusted.client).toBe('192.0.2.55');
    const neighbor = sources.resolve(request('2001:db8:1:2::2', '192.0.2.55'));
    expect(neighbor.client).toBe('2001:db8:1:2::2');
    expect(neighbor.subject).toBe('v6:2001:db8:1:2::/64');
  });
});

describe('PROXY-002 strict provenance and request-local identity', () => {
  it('uses only the socket address for an untrusted peer despite every forged header', () => {
    const req = request('192.0.2.20', ['198.51.100.1', '198.51.100.2']);
    req.headers['x-real-ip'] = '198.51.100.3';
    req.headers.forwarded = 'for=198.51.100.4';
    req.headers['x-forwarded-proto'] = 'https';
    req.headers['x-forwarded-host'] = 'trusted.example.invalid';
    req.headers.host = 'trusted.example.invalid';
    req.rawHeaders.push('x-forwarded-for', 'invalid');
    expect(service().resolve(req)).toEqual({
      peer: '192.0.2.20',
      client: '192.0.2.20',
      subject: 'v4:192.0.2.20/32',
    });
    expect(service('[]').resolve(request())).toEqual({
      peer: proxyIp,
      client: proxyIp,
      subject: `v4:${proxyIp}/32`,
    });
  });

  it('accepts a single case-insensitive raw field and canonicalizes the forwarded address', () => {
    const req = request(proxyIp, '::ffff:192.0.2.33');
    req.rawHeaders[0] = 'X-fOrWaRdEd-FoR';
    expect(service().resolve(req)).toEqual({
      peer: proxyIp,
      client: '192.0.2.33',
      subject: 'v4:192.0.2.33/32',
    });
  });

  it.each([
    { headers: {}, rawHeaders: [] },
    { headers: { 'x-forwarded-for': clientIp }, rawHeaders: [] },
    { headers: { 'x-forwarded-for': '' }, rawHeaders: ['X-Forwarded-For', ''] },
    { headers: { 'x-forwarded-for': [clientIp] }, rawHeaders: ['X-Forwarded-For', clientIp] },
    {
      headers: { 'x-forwarded-for': `${clientIp}, 192.0.2.3` },
      rawHeaders: ['X-Forwarded-For', `${clientIp}, 192.0.2.3`],
    },
    {
      headers: { 'x-forwarded-for': clientIp },
      rawHeaders: ['X-Forwarded-For', clientIp, 'x-forwarded-for', clientIp],
    },
    {
      headers: { 'x-forwarded-for': 'not-an-address' },
      rawHeaders: ['X-Forwarded-For', 'not-an-address'],
    },
    {
      headers: { 'x-forwarded-for': '192.0.2.3:443' },
      rawHeaders: ['X-Forwarded-For', '192.0.2.3:443'],
    },
    {
      headers: { 'x-forwarded-for': 'fe80::1%eth0' },
      rawHeaders: ['X-Forwarded-For', 'fe80::1%eth0'],
    },
  ])(
    'rejects trusted missing/ambiguous metadata before any identity is returned (%j)',
    (fields) => {
      rejected(() => service().resolve({ ...request(), ...fields }));
    },
  );

  it('rejects an absent or malformed actual socket peer even if forwarding looks valid', () => {
    const missing = request();
    missing.socket = {};
    rejected(() => service().resolve(missing));
    rejected(() => service().resolve(request('peer.example.invalid')));
  });

  it('caches an immutable result on one request without contaminating later requests', () => {
    const sources = service();
    const firstRequest = request();
    const first = sources.resolve(firstRequest);
    expect(Object.isFrozen(first)).toBe(true);
    firstRequest.headers['x-forwarded-for'] = '192.0.2.99';
    firstRequest.rawHeaders = ['X-Forwarded-For', '192.0.2.99'];
    expect(sources.resolve(firstRequest)).toBe(first);
    expect(sources.resolve(request(proxyIp, '192.0.2.99')).client).toBe('192.0.2.99');
  });
});

describe('PROXY-002 explicit auth metadata controls integration', () => {
  it('validates marked handlers with no-store before returning to a caller', async () => {
    const req = request();
    const { ctx, response } = context(req);
    const sources = service();
    expect(sources.validate(ctx)).toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    await expect(sources.tracker(req, ctx)).resolves.toBe(`v4:${clientIp}/32`);
  });

  it('both entry points reject malformed trusted metadata, independent of caller order', async () => {
    const sources = service();
    for (const order of ['validate-first', 'tracker-first']) {
      const req = request();
      req.rawHeaders = [];
      const { ctx, response } = context(req);
      if (order === 'validate-first') {
        rejected(() => sources.validate(ctx));
        await expect(sources.tracker(req, ctx)).rejects.toThrow('Invalid client address');
      } else {
        await expect(sources.tracker(req, ctx)).rejects.toThrow('Invalid client address');
        rejected(() => sources.validate(ctx));
      }
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    }
  });

  it('leaves unmarked routes on their existing tracker and does not resolve their headers', async () => {
    const req = request();
    req.rawHeaders = [];
    req.ip = 'unchanged-existing-tracker';
    const { ctx } = context(req, false);
    const sources = service();
    expect(sources.validate(ctx)).toBeUndefined();
    await expect(sources.tracker(req, ctx)).resolves.toBe('unchanged-existing-tracker');
  });
});

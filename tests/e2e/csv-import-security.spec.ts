import { createHash, randomUUID } from 'node:crypto';
import { type APIResponse, type Page, expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import {
  foreignOwner,
  literal,
  noStore,
  providerRequests,
  seedForeign,
  uuid,
} from './manual-opening-fixtures';
import { compose, fingerprint, origin, passwordStep, query, test } from './mfa-fixtures';
import { type TradeApi, tradeApi } from './usd-trades-fixtures';

// Independent HTTPS oracles. No product imports or fabricated auth/backend responses.
const csvTables = ['account_csv_imports', 'account_csv_import_commands', 'account_csv_import_rows'];
const basic = Buffer.from(
  'instrument,side,time,order,quantity,gross,fee\nTOKEN,buy,2025-01-01T00:00:00Z,0,1,100,0\n',
);
interface Part {
  name: string;
  value: Buffer | string;
  file?: boolean;
}
function multipart(parts: Part[], closed = true) {
  const boundary = `csv-security-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.file ? '; filename="upload.csv"' : ''}\r\n${part.file ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n`,
      ),
    );
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from('\r\n'));
  }
  if (closed) chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { data: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
function parts(bytes = basic, name = 'Сделки 📒.csv'): Part[] {
  return [
    { name: 'file', value: bytes, file: true },
    { name: 'displayNameBase64url', value: Buffer.from(name).toString('base64url') },
  ];
}
function basePath(account: string) {
  return `/api/accounting/accounts/${account}/csv-imports`;
}
function count(api: TradeApi) {
  api.calls++;
  expect(api.calls, 'Security group retains actual general request quota').toBeLessThanOrEqual(80);
}
async function rawPost(
  api: TradeApi,
  path: string,
  body: ReturnType<typeof multipart>,
  headers: Record<string, string> = {},
) {
  count(api);
  return api.request.post(path, {
    data: body.data,
    headers: {
      Origin: origin,
      'X-CSRF-Token': api.csrfToken,
      'Content-Type': body.contentType,
      ...headers,
    },
  });
}
async function identity(response: APIResponse, bytes: Buffer, status = 201) {
  expect(response.status()).toBe(status);
  noStore(response);
  const row = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(row).sort()).toEqual(['batchId', 'byteLength', 'createdAt', 'sha256']);
  uuid(row.batchId);
  expect(row.byteLength).toBe(bytes.length);
  expect(row.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  return row as { batchId: string; byteLength: number; createdAt: string; sha256: string };
}
async function fixture(page: Page) {
  const api = await tradeApi(page);
  const account = await api.account();
  await api.initialize(account.id);
  for (const table of csvTables)
    expect(query(`SELECT to_regclass('public.${table}') IS NOT NULL`)).toBe('t');
  return { api, account };
}
function stored(batchId: string) {
  uuid(batchId);
  return JSON.parse(
    query(
      `SELECT jsonb_build_object('bytes',encode("originalBytes",'hex'),'sha256',sha256,'length',"byteLength",'filename',filename,'state',state) FROM account_csv_imports WHERE id=${literal(batchId)}`,
    ),
  );
}
function noLeaks(canaries: string[]) {
  const logs = compose([
    'logs',
    '--no-color',
    '--tail',
    '4000',
    'backend',
    'backend-replica',
    'proxy',
  ]);
  for (const canary of canaries)
    expect(
      logs.includes(canary),
      'Private synthetic upload data stays out of backend/proxy logs',
    ).toBe(false);
}
function settings(instrumentId: string) {
  return {
    format: { delimiter: ',', decimalSeparator: '.', timestampMode: 'offset' },
    mapping: {
      columns: {
        instrument: 0,
        side: 1,
        occurredAt: 2,
        order: 3,
        quantity: 4,
        grossUsd: 5,
        feeUsd: 6,
      },
      instruments: [{ source: 'TOKEN', instrumentId }],
      sides: [{ source: 'buy', side: 'buy' }],
    },
    assertUsd: true,
  };
}

// The boundary bytes are constructed independently; no production CSV parser builds the fixture.
function maximumSource() {
  const headers = Array.from({ length: 32 }, (_, index) => `h${index}`);
  const first = Array.from({ length: 32 }, () => 'a'.repeat(4096));
  const prefix = `${headers.join(',')}\n${first.join(',')}\n`;
  let remaining = 262144 - Buffer.byteLength(prefix) - 31;
  const second = Array.from({ length: 32 }, () => {
    const length = Math.min(4096, remaining);
    remaining -= length;
    return 'b'.repeat(length);
  });
  const bytes = Buffer.from(prefix + second.join(','));
  expect(bytes.length).toBe(262144);
  expect(remaining).toBe(0);
  expect(
    first.every((cell) => Buffer.byteLength(cell) <= 4096) &&
      second.every((cell) => Buffer.byteLength(cell) <= 4096),
  ).toBe(true);
  return { bytes, headers, first, second };
}

test('CSV-001-B: real multipart accepts both part orders and inclusive byte/name limits without leaking originals', async ({
  page,
}) => {
  const { api, account } = await fixture(page);
  const baseline = fingerprint(['auth_sessions', ...csvTables]);
  const admissions = ledgerState();
  const providers = providerRequests();
  const displayName = '📒'.repeat(120);
  const nameEncoded = Buffer.from(displayName).toString('base64url');
  expect(nameEncoded.length).toBe(640);
  const saved = await identity(
    await rawPost(api, basePath(account.id), multipart(parts(basic, displayName))),
    basic,
  );
  expect(stored(saved.batchId)).toEqual({
    bytes: basic.toString('hex'),
    sha256: saved.sha256,
    length: basic.length,
    filename: displayName,
    state: 'draft',
  });
  const afterUpload = fingerprint(['auth_sessions']);
  expect(
    await identity(
      await rawPost(
        api,
        basePath(account.id),
        multipart(parts(basic, 'Переименовано.csv').reverse()),
      ),
      basic,
      200,
    ),
  ).toEqual(saved);
  expect(fingerprint(['auth_sessions']), 'Exact replay preserves all three CSV tables too').toBe(
    afterUpload,
  );
  const maximum = maximumSource();
  const large = await identity(
    await rawPost(
      api,
      basePath(account.id),
      multipart(parts(maximum.bytes, 'Максимум.csv').reverse()),
    ),
    maximum.bytes,
  );
  const afterLarge = fingerprint(['auth_sessions']);
  const result = await api.result(
    'POST',
    `/accounts/${account.id}/csv-imports/${large.batchId}/inspect`,
    200,
    { delimiter: ',' },
  );
  expect(result).toEqual({
    batchId: large.batchId,
    valid: true,
    headers: maximum.headers,
    rows: [
      { ordinal: 1, startLine: 2, cells: maximum.first },
      { ordinal: 2, startLine: 3, cells: maximum.second },
    ],
    error: null,
  });
  for (const path of ['', `/${saved.batchId}`, `/${large.batchId}/rows`]) {
    const metadata = await api.result('GET', `/accounts/${account.id}/csv-imports${path}`, 200);
    expect(JSON.stringify(metadata)).not.toContain('originalBytes');
    expect(JSON.stringify(metadata)).not.toContain(basic.toString('hex'));
  }
  expect(fingerprint(['auth_sessions'])).toBe(afterLarge);
  expect(fingerprint(['auth_sessions', ...csvTables])).toBe(baseline);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
  noLeaks([displayName, nameEncoded]);
});

test('CSV-001-B: actual malformed multipart and source/name failures preserve every CSV and accounting row', async ({
  page,
}) => {
  const { api, account } = await fixture(page);
  const path = basePath(account.id);
  const canary = `csv-private-${randomUUID()}`;
  const cases: {
    name: string;
    body: ReturnType<typeof multipart>;
    status: number;
    headers?: Record<string, string>;
  }[] = [
    { name: 'empty file', body: multipart(parts(Buffer.alloc(0))), status: 400 },
    { name: 'file one byte over', body: multipart(parts(Buffer.alloc(262145, 97))), status: 413 },
    { name: 'invalid UTF8', body: multipart(parts(Buffer.from([0xc0, 0xaf]))), status: 400 },
    { name: 'UTF16', body: multipart(parts(Buffer.from([0xff, 0xfe, 0x41, 0]))), status: 400 },
    { name: 'NUL', body: multipart(parts(Buffer.from(`a\n${canary}\0`))), status: 400 },
    { name: 'bare CR', body: multipart(parts(Buffer.from(`a\n"${canary}\rb"`))), status: 400 },
    { name: 'missing file', body: multipart([parts()[1]]), status: 400 },
    { name: 'missing metadata', body: multipart([parts()[0]]), status: 400 },
    { name: 'extra file', body: multipart([...parts(), parts()[0]]), status: 400 },
    { name: 'duplicate metadata', body: multipart([...parts(), parts()[1]]), status: 400 },
    {
      name: 'extra field',
      body: multipart([...parts(), { name: canary, value: 'private' }]),
      status: 400,
    },
    {
      name: 'nested field',
      body: multipart([parts()[0], { name: 'displayNameBase64url[nested]', value: canary }]),
      status: 400,
    },
    {
      name: 'indexed field',
      body: multipart([parts()[0], { name: 'displayNameBase64url[0]', value: canary }]),
      status: 400,
    },
    {
      name: 'truncated form',
      body: multipart(parts(Buffer.from(`a\n${canary}`)), false),
      status: 400,
    },
    {
      name: 'missing boundary',
      body: { data: Buffer.from(canary), contentType: 'multipart/form-data' },
      status: 400,
    },
    {
      name: 'nonmultipart',
      body: {
        data: Buffer.from(JSON.stringify({ file: canary })),
        contentType: 'application/json',
      },
      status: 415,
    },
    {
      name: 'unsupported encoding',
      body: multipart(parts()),
      headers: { 'Content-Encoding': 'gzip' },
      status: 415,
    },
    {
      name: 'overlong decoded name',
      body: multipart(parts(basic, `${'a'.repeat(121)}`)),
      status: 400,
    },
    {
      name: 'overlong metadata field',
      body: multipart([parts()[0], { name: 'displayNameBase64url', value: 'A'.repeat(641) }]),
      status: 400,
    },
    { name: 'control in name', body: multipart(parts(basic, `${canary}\u0085.csv`)), status: 400 },
    { name: 'path in name', body: multipart(parts(basic, `${canary}/file.csv`)), status: 400 },
    {
      name: 'padded base64url',
      body: multipart([
        parts()[0],
        { name: 'displayNameBase64url', value: `${Buffer.from(canary).toString('base64url')}=` },
      ]),
      status: 400,
    },
  ];
  const before = fingerprint(['auth_sessions']);
  const admissions = ledgerState();
  const providers = providerRequests();
  for (const item of cases) {
    const response = await rawPost(api, path, item.body, item.headers);
    expect(response.status(), item.name).toBe(item.status);
    noStore(response);
    expect(
      (await response.text()).includes(canary),
      `${item.name} error omits private source`,
    ).toBe(false);
    expect(
      fingerprint(['auth_sessions']),
      `${item.name} leaves complete business/CSV/ledger state`,
    ).toBe(before);
  }
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
  noLeaks([canary]);
});

function foreignBatch() {
  const foreign = seedForeign();
  const batchId = randomUUID();
  const sha = createHash('sha256').update(basic).digest('hex');
  query(`INSERT INTO account_trade_journals ("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","currentRevision") VALUES (${literal(foreignOwner)},${literal(foreign.accountId)},${literal(randomUUID())},'{"coverageFrom":"2025-01-01T00:00:00.000Z","assertEmpty":true}','declared-empty','2025-01-01T00:00:00.000Z',0);
  INSERT INTO account_csv_imports (id,"ownerId","accountId",sha256,"originalBytes","byteLength",filename,state) VALUES (${literal(batchId)},${literal(foreignOwner)},${literal(foreign.accountId)},${literal(sha)},decode(${literal(basic.toString('hex'))},'hex'),${basic.length},'Private foreign CSV','draft')`);
  return { ...foreign, batchId };
}

test('CSV-007-A: every import route denies anonymous/pending access and invalid CSRF/Origin before touching sessions or private data', async ({
  page,
  browser,
  request,
}) => {
  const { api, account } = await fixture(page);
  const instrument = await api.instrument();
  const saved = await identity(await rawPost(api, basePath(account.id), multipart(parts())), basic);
  const pendingContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const pending = await passwordStep(await pendingContext.newPage());
    const base = basePath(account.id);
    const batch = `${base}/${saved.batchId}`;
    const mapped = settings(instrument.id);
    const deniedUpload = multipart(parts());
    const endpoints = [
      { method: 'GET', path: base },
      { method: 'POST', path: base, data: deniedUpload.data },
      { method: 'GET', path: batch },
      { method: 'GET', path: `${batch}/rows` },
      { method: 'POST', path: `${batch}/inspect`, data: { delimiter: ',' } },
      { method: 'POST', path: `${batch}/preview`, data: mapped },
      {
        method: 'POST',
        path: `${batch}/confirm`,
        data: {
          ...mapped,
          requestId: randomUUID(),
          expectedJournalRevision: 0,
          parserVersion: 'usd-csv-v1',
          previewHash: '0'.repeat(64),
        },
      },
      {
        method: 'POST',
        path: `${batch}/rollback`,
        data: { requestId: randomUUID(), expectedJournalRevision: 0 },
      },
    ];
    const before = fingerprint([]);
    const admissions = ledgerState();
    const providers = providerRequests();
    for (const client of [
      { request, csrf: '' },
      { request: pendingContext.request, csrf: pending.csrfToken },
    ]) {
      for (const endpoint of endpoints) {
        count(api);
        const response = await client.request.fetch(endpoint.path, {
          method: endpoint.method,
          data: endpoint.data,
          headers: {
            Origin: origin,
            'X-CSRF-Token': client.csrf,
            ...(endpoint.method === 'POST' && endpoint.path === base
              ? { 'Content-Type': deniedUpload.contentType }
              : {}),
          },
        });
        expect(response.status(), `${endpoint.method} private route denies non-full session`).toBe(
          401,
        );
        noStore(response);
        expect(await response.text()).not.toContain('Private foreign CSV');
      }
    }
    const deniedHeaders: Record<string, string>[] = [
      { Origin: origin },
      { Origin: origin, 'X-CSRF-Token': 'incorrect-synthetic-csrf' },
      { Origin: 'https://foreign.example.invalid', 'X-CSRF-Token': api.csrfToken },
    ];
    for (const endpoint of endpoints.filter((e) => e.method === 'POST')) {
      for (const headers of deniedHeaders) {
        count(api);
        const response = await api.request.post(endpoint.path, {
          data: endpoint.data,
          headers: {
            ...headers,
            ...(endpoint.path === base ? { 'Content-Type': deniedUpload.contentType } : {}),
          },
        });
        expect(response.status()).toBe(403);
        noStore(response);
      }
    }
    expect(fingerprint([]), 'Rejected authorization does not even touch auth session rows').toBe(
      before,
    );
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
  } finally {
    await pendingContext.close();
  }
});

test('CSV-002-C/CSV-007-A: real raw mapping and foreign identities fail without coercion, source disclosure or accounting mutations', async ({
  page,
}) => {
  const { api, account } = await fixture(page);
  const instrument = await api.instrument();
  const foreign = foreignBatch();
  const canary = `csv-source-${randomUUID()}`;
  const bytes = Buffer.concat([basic.subarray(0, basic.length - 1), Buffer.from(`,${canary}\n`)]);
  // Retain a structurally invalid source deliberately; raw envelope/ownership validation
  // must still be safe. Economic parser failure is covered separately by pure/API cases.
  const saved = await identity(
    await rawPost(api, basePath(account.id), multipart(parts(bytes))),
    bytes,
  );
  const mapped = settings(instrument.id);
  const batch = `/accounts/${account.id}/csv-imports/${saved.batchId}`;
  const validCommand = {
    ...mapped,
    requestId: randomUUID(),
    expectedJournalRevision: 0,
    parserVersion: 'usd-csv-v1',
    previewHash: '0'.repeat(64),
  };
  const before = fingerprint(['auth_sessions']);
  const admissions = ledgerState();
  const providers = providerRequests();
  const invalids: [string, unknown][] = [
    ['/inspect', { delimiter: [','] }],
    ['/inspect', { delimiter: ',', ownerId: foreignOwner }],
    ['/preview', { ...mapped, assertUsd: 'true' }],
    ['/preview', { ...mapped, format: { ...mapped.format, delimiter: { toString: canary } } }],
    [
      '/preview',
      {
        ...mapped,
        mapping: { ...mapped.mapping, columns: { ...mapped.mapping.columns, instrument: '0' } },
      },
    ],
    [
      '/preview',
      {
        ...mapped,
        mapping: { ...mapped.mapping, columns: { ...mapped.mapping.columns, currency: null } },
      },
    ],
    [
      '/preview',
      {
        ...mapped,
        mapping: {
          ...mapped.mapping,
          instruments: [{ source: { toString: canary }, instrumentId: instrument.id }],
        },
      },
    ],
    [
      '/preview',
      { ...mapped, mapping: { ...mapped.mapping, sides: [{ source: 'buy', side: ['buy'] }] } },
    ],
    ['/confirm', { ...validCommand, expectedJournalRevision: '0' }],
    ['/confirm', { ...validCommand, requestId: { toString: canary } }],
    ['/confirm', { ...validCommand, acceptedSettings: {} }],
    ['/rollback', { requestId: randomUUID(), expectedJournalRevision: true }],
  ];
  for (const [suffix, input] of invalids) {
    const response = await api.send('POST', `${batch}${suffix}`, input);
    expect(response.status()).toBe(400);
    expect((await response.text()).includes(canary)).toBe(false);
  }
  for (const suffix of ['', '/rows']) {
    await api.result('GET', `/accounts/${account.id}/csv-imports/${foreign.batchId}${suffix}`, 404);
    await api.result(
      'GET',
      `/accounts/${foreign.accountId}/csv-imports/${foreign.batchId}${suffix}`,
      404,
    );
  }
  await api.result('GET', `/accounts/${foreign.accountId}/csv-imports`, 404);
  const foreignUpload = await rawPost(api, basePath(foreign.accountId), multipart(parts()));
  expect(foreignUpload.status()).toBe(404);
  noStore(foreignUpload);
  for (const [suffix, input] of [
    ['/inspect', { delimiter: ',' }],
    ['/preview', mapped],
    ['/confirm', validCommand],
    ['/rollback', { requestId: randomUUID(), expectedJournalRevision: 0 }],
  ] as const) {
    const response = await api.send(
      'POST',
      `/accounts/${account.id}/csv-imports/${foreign.batchId}${suffix}`,
      input,
    );
    expect(response.status()).toBe(404);
    expect((await response.json()).message).toBe('Not Found');
  }
  await api.result('POST', `${batch}/preview`, 404, {
    ...mapped,
    mapping: {
      ...mapped.mapping,
      instruments: [{ source: 'TOKEN', instrumentId: foreign.instrumentId }],
    },
  });
  await api.result('POST', `${batch}/confirm`, 404, {
    ...validCommand,
    mapping: {
      ...mapped.mapping,
      instruments: [{ source: 'TOKEN', instrumentId: foreign.instrumentId }],
    },
  });
  const malformed = (await api.result('POST', `${batch}/inspect`, 200, { delimiter: ',' })) as {
    valid: boolean;
    headers: unknown[];
    rows: unknown[];
    error: { code: string };
  };
  expect(malformed).toMatchObject({
    valid: false,
    headers: [],
    rows: [],
    error: { code: 'row-width' },
  });
  expect(JSON.stringify(malformed)).not.toContain(canary);
  expect(
    fingerprint(['auth_sessions']),
    'Includes all CSV sources, commands, rows and foreign fixtures',
  ).toBe(before);
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
  noLeaks([canary]);
});

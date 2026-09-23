import { createHash } from 'node:crypto';
import https from 'node:https';
import { expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import { providerRequests } from './manual-opening-fixtures';
import { cookieName, fingerprint, origin, test } from './mfa-fixtures';
import { tradeApi } from './usd-trades-fixtures';

const boundary = 'capital-csv-wire-boundary';
const filename = 'Приватный размер.csv';
const source = Buffer.from('header\nCSV_WIRE_PRIVATE_CANARY\n');
const limit = 1048576;

function body(size: number): Buffer {
  const parts = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.csv"\r\nContent-Type: application/octet-stream\r\n\r\n${source.toString('utf8')}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="displayNameBase64url"\r\n\r\n${Buffer.from(filename).toString('base64url')}\r\n--${boundary}--\r\n`,
  );
  // Valid MIME preamble demonstrates why file/field limits do not bound wire bytes.
  const result = Buffer.concat([
    Buffer.alloc(size - parts.length - 2, 0x70),
    Buffer.from('\r\n'),
    parts,
  ]);
  expect(result.length).toBe(size);
  return result;
}

function upload(path: string, cookie: string, csrf: string, bytes: Buffer, chunked: boolean) {
  return new Promise<{ status: number; text: string; cache: string | undefined }>(
    (resolve, reject) => {
      const request = https.request(
        `${origin}${path}`,
        {
          method: 'POST',
          rejectUnauthorized: false,
          headers: {
            Cookie: cookie,
            Origin: origin,
            'X-CSRF-Token': csrf,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            ...(chunked
              ? { 'Transfer-Encoding': 'chunked' }
              : { 'Content-Length': String(bytes.length) }),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              text: Buffer.concat(chunks).toString('utf8'),
              cache: response.headers['cache-control'],
            }),
          );
        },
      );
      request.setTimeout(30000, () =>
        request.destroy(new Error('Synthetic wire request timed out')),
      );
      request.on('error', reject);
      if (chunked) {
        for (let offset = 0; offset < bytes.length; offset += 8192)
          request.write(bytes.subarray(offset, offset + 8192));
        request.end();
      } else request.end(bytes);
    },
  );
}

test('CSV-007-B: actual HTTPS edge accepts the exact one-MiB multipart envelope and rejects one byte over for length and chunked bodies', async ({
  page,
}) => {
  const api = await tradeApi(page);
  const account = await api.account();
  await api.initialize(account.id);
  const state = await api.request.storageState();
  const cookie = state.cookies.find((entry) => entry.name === cookieName);
  expect(cookie).toBeDefined();
  const cookieHeader = `${cookieName}=${cookie!.value}`;
  const path = `/api/accounting/accounts/${account.id}/csv-imports`;
  const admissions = ledgerState();
  const providers = providerRequests();
  const journalBefore = await api.state(account.id);
  let identity: unknown;
  try {
    for (const chunked of [false, true]) {
      api.calls++;
      const accepted = await upload(path, cookieHeader, api.csrfToken, body(limit), chunked);
      expect(accepted.status).toBe(chunked ? 200 : 201);
      expect(accepted.cache).toMatch(/no-store/);
      const current: unknown = JSON.parse(accepted.text);
      expect(current).toMatchObject({
        sha256: createHash('sha256').update(source).digest('hex'),
        byteLength: source.length,
      });
      expect(accepted.text).not.toContain('CSV_WIRE_PRIVATE_CANARY');
      if (chunked) expect(current).toEqual(identity);
      else identity = current;
      const before = fingerprint([]);
      api.calls++;
      const refused = await upload(path, cookieHeader, api.csrfToken, body(limit + 1), chunked);
      expect(refused.status).toBe(413);
      expect(refused.text).not.toContain('CSV_WIRE_PRIVATE_CANARY');
      expect(refused.text).not.toContain(filename);
      expect(
        fingerprint([]),
        'Edge refusal preserves ALL persisted import/accounting/authentication rows',
      ).toBe(before);
    }
    expect(await api.state(account.id)).toEqual(journalBefore);
    const listing = await api.result('GET', `/accounts/${account.id}/csv-imports`, 200);
    expect(listing).toMatchObject({
      items: [{ ...(identity as object), filename, state: 'draft' }],
      nextCursor: null,
    });
  } finally {
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
    expect(api.calls).toBeLessThanOrEqual(80);
  }
});

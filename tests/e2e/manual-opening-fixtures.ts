import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIRequestContext, type APIResponse, type Page, expect } from '@playwright/test';
import { hostSubject } from './admission-fixtures';
import { compose, fingerprint, loginWithMfa, origin, owner, query } from './mfa-fixtures';
import { selectBackend, upstreamMark, upstreamsSince } from './replicas';

export const accountingTables = [
  'manual_accounts',
  'accounting_instruments',
  'account_opening_snapshots',
  'account_opening_positions',
] as const;
export const foreignOwner = '22222222-2222-4222-8222-222222222222';
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

export type Account = { id: string; name: string; currentRevision: number; createdAt: string };
export type Instrument = {
  id: string;
  name: string;
  symbol: string | null;
  namespace: 'manual';
  createdAt: string;
};
export type PositionInput = {
  instrumentId: string;
  quantity: string;
  costStatus: 'known' | 'unknown';
  totalCostUsd: string | null;
};
export type Position = PositionInput & {
  instrumentName: string;
  instrumentSymbol: string | null;
};
export type OpeningInput = {
  requestId: string;
  expectedRevision: number;
  asOf: string;
  positions: PositionInput[];
};
export type Opening = {
  accountId: string;
  revision: number;
  requestId: string;
  asOf: string;
  createdAt: string;
  positions: Position[];
};
export type AccountDetail = Account & { currentOpening: Opening | null };
export type PageResult<T, C extends string | number> = { items: T[]; nextCursor: C | null };

function record(value: unknown): Record<string, unknown> {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, expected: string[]): void {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
}

export function uuid(value: unknown): string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(uuidPattern);
  return value as string;
}

function timestamp(value: unknown): string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(value as string).toISOString()).toBe(value);
  return value as string;
}

function text(value: unknown): string {
  expect(typeof value).toBe('string');
  return value as string;
}

function integer(value: unknown, minimum = 0): number {
  expect(Number.isInteger(value) && (value as number) >= minimum).toBe(true);
  return value as number;
}

function decimal(value: unknown): string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(decimalPattern);
  return value as string;
}

export function readAccount(value: unknown): Account {
  const row = record(value);
  keys(row, ['id', 'name', 'currentRevision', 'createdAt']);
  return {
    id: uuid(row.id),
    name: text(row.name),
    currentRevision: integer(row.currentRevision),
    createdAt: timestamp(row.createdAt),
  };
}

export function readInstrument(value: unknown): Instrument {
  const row = record(value);
  keys(row, ['id', 'name', 'symbol', 'namespace', 'createdAt']);
  expect(row.namespace).toBe('manual');
  return {
    id: uuid(row.id),
    name: text(row.name),
    symbol: row.symbol === null ? null : text(row.symbol),
    namespace: 'manual',
    createdAt: timestamp(row.createdAt),
  };
}

export function readOpening(value: unknown): Opening {
  const row = record(value);
  keys(row, ['accountId', 'revision', 'requestId', 'asOf', 'createdAt', 'positions']);
  expect(Array.isArray(row.positions)).toBe(true);
  const positions = (row.positions as unknown[]).map((value): Position => {
    const position = record(value);
    keys(position, [
      'instrumentId',
      'instrumentName',
      'instrumentSymbol',
      'quantity',
      'costStatus',
      'totalCostUsd',
    ]);
    expect(['known', 'unknown']).toContain(position.costStatus);
    if (position.costStatus === 'unknown') expect(position.totalCostUsd).toBeNull();
    return {
      instrumentId: uuid(position.instrumentId),
      instrumentName: text(position.instrumentName),
      instrumentSymbol: position.instrumentSymbol === null ? null : text(position.instrumentSymbol),
      quantity: decimal(position.quantity),
      costStatus: position.costStatus as 'known' | 'unknown',
      totalCostUsd: position.costStatus === 'unknown' ? null : decimal(position.totalCostUsd),
    };
  });
  expect(positions.length).toBeGreaterThanOrEqual(1);
  expect(positions.length).toBeLessThanOrEqual(100);
  const ids = positions.map((position) => position.instrumentId);
  expect(ids).toEqual([...new Set(ids)].sort());
  return {
    accountId: uuid(row.accountId),
    revision: integer(row.revision, 1),
    requestId: uuid(row.requestId),
    asOf: timestamp(row.asOf),
    createdAt: timestamp(row.createdAt),
    positions,
  };
}

export function readDetail(value: unknown): AccountDetail {
  const row = record(value);
  keys(row, ['id', 'name', 'currentRevision', 'createdAt', 'currentOpening']);
  const { currentOpening, ...summary } = row;
  return {
    ...readAccount(summary),
    currentOpening: currentOpening === null ? null : readOpening(currentOpening),
  };
}

export function readPage<T, C extends string | number>(
  value: unknown,
  readItem: (value: unknown) => T,
  readCursor: (value: unknown) => C,
): PageResult<T, C> {
  const row = record(value);
  keys(row, ['items', 'nextCursor']);
  expect(Array.isArray(row.items)).toBe(true);
  return {
    items: (row.items as unknown[]).map(readItem),
    nextCursor: row.nextCursor === null ? null : readCursor(row.nextCursor),
  };
}

export function noStore(response: APIResponse): void {
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
}

export class ManualApi {
  calls = 0;

  constructor(
    readonly request: APIRequestContext,
    readonly csrfToken: string,
  ) {}

  async send(method: string, path: string, data?: unknown, headers?: Record<string, string>) {
    this.calls++;
    // Leave room for actual browser startup traffic below the existing 100/min limit.
    expect(
      this.calls,
      'A grouped accounting case must remain below its real request quota',
    ).toBeLessThanOrEqual(80);
    const response = await this.request.fetch(`/api/accounting${path}`, {
      method,
      data,
      headers: { Origin: origin, 'X-CSRF-Token': this.csrfToken, ...headers },
    });
    noStore(response);
    return response;
  }

  async result(method: string, path: string, status: number, data?: unknown): Promise<unknown> {
    const response = await this.send(method, path, data);
    expect(response.status(), `${method} /accounting${path}`).toBe(status);
    return response.json() as Promise<unknown>;
  }

  async account(name = `Синтетический счет ${randomUUID()}`): Promise<Account> {
    return readAccount(
      await this.result('POST', '/accounts', 201, { requestId: randomUUID(), name }),
    );
  }

  async instrument(
    name = `Синтетический инструмент ${randomUUID()}`,
    symbol?: string,
  ): Promise<Instrument> {
    return readInstrument(
      await this.result('POST', '/instruments', 201, {
        requestId: randomUUID(),
        name,
        ...(symbol === undefined ? {} : { symbol }),
      }),
    );
  }

  async detail(accountId: string): Promise<AccountDetail> {
    return readDetail(await this.result('GET', `/accounts/${accountId}`, 200));
  }

  async save(accountId: string, input: OpeningInput, status = 201): Promise<Opening> {
    return readOpening(await this.result('POST', `/accounts/${accountId}/openings`, status, input));
  }

  async history(accountId: string, suffix = ''): Promise<PageResult<Opening, number>> {
    return readPage(
      await this.result('GET', `/accounts/${accountId}/openings${suffix}`, 200),
      readOpening,
      (value) => integer(value, 1),
    );
  }
}

export async function manualApi(page: Page): Promise<ManualApi> {
  const { csrfToken } = await loginWithMfa(page);
  return new ManualApi(page.context().request, csrfToken);
}

export function openingInput(
  instrumentId: string,
  overrides: Partial<OpeningInput> = {},
): OpeningInput {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    asOf: '2024-02-29T01:02:03.004Z',
    positions: [{ instrumentId, quantity: '1', costStatus: 'unknown', totalCostUsd: null }],
    ...overrides,
  };
}

export function businessState(): string {
  return fingerprint(['auth_sessions']);
}

export function legacyState(): string {
  return fingerprint(['auth_sessions', ...accountingTables]);
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function rows<T>(sql: string): T[] {
  return JSON.parse(
    query(`SELECT COALESCE(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb) FROM (${sql}) row_data`),
  ) as T[];
}

export function accountRows(accountId: string): unknown {
  uuid(accountId);
  return {
    account: rows(`SELECT * FROM manual_accounts WHERE id = '${accountId}' ORDER BY id`),
    snapshots: rows(
      `SELECT * FROM account_opening_snapshots WHERE "accountId" = '${accountId}' ORDER BY revision`,
    ),
    positions: rows(
      `SELECT "ownerId", "accountId", revision, "instrumentId", quantity::text,
        "costStatus", "totalCostUsd"::text FROM account_opening_positions
        WHERE "accountId" = '${accountId}' ORDER BY revision, "instrumentId"`,
    ),
  };
}

export function providerRequests(): { method: string; url: string }[] {
  const result: unknown = JSON.parse(
    compose([
      'exec',
      '-T',
      'providers',
      'node',
      '-e',
      `
    fetch('http://127.0.0.1:8080/__control/requests').then(async response => {
      if (!response.ok) throw new Error('Synthetic provider log unavailable');
      process.stdout.write(await response.text());
    }).catch(() => { process.exitCode = 1; });
  `,
    ]),
  );
  expect(Array.isArray(result)).toBe(true);
  return (result as unknown[]).map((value) => {
    const row = record(value);
    keys(row, ['method', 'url']);
    return { method: text(row.method), url: text(row.url) };
  });
}

export function backendLogs(): string {
  return compose(['logs', '--no-color', '--tail', '3000', 'backend', 'backend-replica']);
}

export function seedForeign(): { accountId: string; instrumentId: string } {
  const accountId = randomUUID();
  const instrumentId = randomUUID();
  query(`INSERT INTO manual_accounts (id, "ownerId", "requestId", "canonicalPayload", name)
    VALUES ('${accountId}', '${foreignOwner}', '${randomUUID()}', '{"name":"Synthetic foreign account"}', 'Synthetic foreign account');
    INSERT INTO accounting_instruments (id, "ownerId", "requestId", "canonicalPayload", name, symbol)
    VALUES ('${instrumentId}', '${foreignOwner}', '${randomUUID()}', '{"name":"Synthetic foreign instrument","symbol":"USD"}', 'Synthetic foreign instrument', 'USD')`);
  return { accountId, instrumentId };
}

export function seedDiscovery(count: number): void {
  expect(Number.isInteger(count) && count >= 1 && count <= 60).toBe(true);
  const instrumentValues = Array.from({ length: count }, (_, index) => {
    const name = `Синтетический список ${randomUUID()} ${index}`;
    return `('${randomUUID()}', '${owner.id}', '${randomUUID()}', ${literal(JSON.stringify({ name, symbol: null }))}, ${literal(name)}, NULL)`;
  });
  const accountValues = Array.from({ length: count }, (_, index) => {
    const name = `Синтетический счет списка ${randomUUID()} ${index}`;
    return `('${randomUUID()}', '${owner.id}', '${randomUUID()}', ${literal(JSON.stringify({ name }))}, ${literal(name)})`;
  });
  // Direct synthetic discovery data does not create authentication or hide API writes.
  query(`INSERT INTO accounting_instruments (id, "ownerId", "requestId", "canonicalPayload", name, symbol) VALUES ${instrumentValues.join(',')};
    INSERT INTO manual_accounts (id, "ownerId", "requestId", "canonicalPayload", name) VALUES ${accountValues.join(',')}`);
}

export function installCommitFailure(accountId: string, marker: string): () => void {
  uuid(accountId);
  const name = `acceptance_opening_${randomUUID().replace(/-/g, '')}`;
  query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW."accountId" = '${accountId}'::uuid THEN RAISE EXCEPTION '%', ${literal(marker)}; END IF; RETURN NEW; END $body$;
    CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON account_opening_positions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  return () =>
    query(
      `DROP TRIGGER IF EXISTS ${name} ON account_opening_positions; DROP FUNCTION IF EXISTS ${name}()`,
    );
}

let manualWriteBlockerPid: number | undefined;

export async function withManualWritesBlocked<T>(
  action: (release: () => Promise<void>) => Promise<T>,
): Promise<T> {
  expect(manualWriteBlockerPid, 'The synthetic manual write blocker is not nested').toBeUndefined();
  const root = resolve(__dirname, '../..');
  const child = spawn(
    'docker',
    [
      'compose',
      '-p',
      'capital-tracker-e2e',
      '-f',
      resolve(__dirname, 'compose.yml'),
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'capital_e2e',
      '-d',
      'capital_tracker_e2e',
      '-At',
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
  );
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<number>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (value) => {
      output += value.toString();
      const marker = output.match(/SYNTHETIC_ACCOUNT_WRITE_LOCK:([0-9]+)\r?\n/);
      if (marker) resolve(Number(marker[1]));
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Synthetic account lock exited before readiness')));
    timer = setTimeout(
      () => reject(new Error('Synthetic account lock readiness timed out')),
      5_000,
    );
  });
  // SHARE permits account reads, then holds the actual pointer UPDATE at the database.
  child.stdin.write(
    "BEGIN; LOCK TABLE manual_accounts IN SHARE MODE; SELECT 'SYNTHETIC_ACCOUNT_WRITE_LOCK:' || pg_backend_pid();\n",
  );
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      child.stdin.end('ROLLBACK;\n');
    }
    expect(await closed, 'The external lock holder exits without changing application rows').toBe(
      0,
    );
  };
  try {
    manualWriteBlockerPid = await ready;
    expect(Number.isInteger(manualWriteBlockerPid) && manualWriteBlockerPid > 0).toBe(true);
    clearTimeout(timer);
    return await action(release);
  } finally {
    clearTimeout(timer);
    try {
      await release();
    } finally {
      manualWriteBlockerPid = undefined;
    }
  }
}

export async function expectBlockedManualWrites(count: number): Promise<void> {
  expect([1, 2]).toContain(count);
  const blocker = manualWriteBlockerPid;
  expect(typeof blocker === 'number' && Number.isInteger(blocker) && blocker > 0).toBe(true);
  const update = 'UPDATE manual_accounts SET "currentRevision"=$3 WHERE "ownerId"=$1 AND id=$2';
  const ownerLock =
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0))";
  await expect
    .poll(
      () => {
        const waiters: {
          pid: number;
          blockers: number[];
          accountWrite: boolean;
          ownerLock: boolean;
        }[] = JSON.parse(
          query(`SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'pid', pid, 'blockers', pg_blocking_pids(pid),
            'accountWrite', query = ${literal(update)}, 'ownerLock', query = ${literal(ownerLock)})), '[]')
          FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND cardinality(pg_blocking_pids(pid)) > 0`),
        );
        if (waiters.length !== count || new Set(waiters.map(({ pid }) => pid)).size !== count)
          return false;
        const writer = waiters.find(({ accountWrite }) => accountWrite);
        if (!writer || writer.blockers.length !== 1 || writer.blockers[0] !== blocker) return false;
        if (count === 1) return true;
        const follower = waiters.find(({ ownerLock }) => ownerLock);
        return (
          !!follower &&
          follower.pid !== writer.pid &&
          follower.blockers.length === 1 &&
          follower.blockers[0] === writer.pid
        );
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

export async function raceAcrossReplicas(
  first: () => Promise<APIResponse>,
  second: () => Promise<APIResponse>,
): Promise<APIResponse[]> {
  const source = (await hostSubject()).replace(/^v4:/, '').replace(/\/32$/, '');
  await selectBackend('primary');
  const mark = await upstreamMark();
  const pending: Promise<APIResponse>[] = [];
  const launch = (action: () => Promise<APIResponse>) => {
    const request = action();
    // Preserve the original promise/result while observing rejection immediately.
    void request.catch(() => undefined);
    pending.push(request);
  };
  try {
    const responses = await withManualWritesBlocked(async (release) => {
      launch(first);
      await expectBlockedManualWrites(1);
      await selectBackend('replica');
      launch(second);
      await expectBlockedManualWrites(2);
      await release();
      return Promise.all(pending);
    });
    const evidence = (await upstreamsSince(mark)).filter((row) => row.source === source);
    expect(evidence).toHaveLength(2);
    expect(evidence.map((row) => row.backend).sort()).toEqual(['primary', 'replica']);
    return responses;
  } finally {
    try {
      await Promise.allSettled(pending);
    } finally {
      await selectBackend('both');
    }
  }
}

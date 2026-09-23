import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { type APIResponse, type Page, expect } from '@playwright/test';
import { hostSubject } from './admission-fixtures';
import {
  ManualApi,
  literal,
  noStore,
  providerRequests,
  rows,
  uuid,
} from './manual-opening-fixtures';
import { fingerprint, loginWithMfa, query } from './mfa-fixtures';
import { restartBackends, selectBackend, upstreamMark, upstreamsSince } from './replicas';

export const tradeTables = ['account_trade_journals', 'account_trades', 'account_trade_versions'];
export const coverageFrom = '2025-01-01T00:00:00.000Z';
export type Execution = {
  instrumentId: string;
  side: 'buy' | 'sell';
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
};
export type TradeInput = Execution & { requestId: string; expectedJournalRevision: number };
export type OriginReceipt = {
  accountId: string;
  requestId: string;
  originKind: 'declared-empty';
  coverageFrom: string;
  createdAt: string;
};
export type TradeVersion = Execution & {
  tradeId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  createdAt: string;
  instrumentName: string;
  instrumentSymbol: string | null;
};
export type TradeReceipt = { accountId: string; journalRevision: number; trade: TradeVersion };
export type Summary = {
  grossBuysUsd: string;
  buyFeesUsd: string;
  grossSalesUsd: string;
  sellFeesUsd: string;
  netSalesUsd: string;
  consumedCostUsd: string;
  realizedUsd: string;
  remainingCostUsd: string;
};
export type Journal = OriginReceipt & {
  journalRevision: number;
  activeTradeCount: number;
  versionCount: number;
  limits: { activeTrades: number; versions: number };
  summary: Summary;
};
export type JournalState = {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: null | 'opening-history' | 'already-initialized';
  journal: Journal | null;
};
export type Lot = {
  buyTradeId: string;
  buyVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  originalQuantity: string;
  originalCostUsd: string;
  remainingQuantity: string;
  remainingCostUsd: string;
};
export type Realization = {
  sellTradeId: string;
  sellVersion: number;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
  netUsd: string;
  consumedCostUsd: string;
  realizedUsd: string;
};
export type Match = {
  sellTradeId: string;
  sellVersion: number;
  buyTradeId: string;
  buyVersion: number;
  quantity: string;
  costUsd: string;
};
export type CurrentPage<T> = { journalRevision: number; items: T[]; nextOffset: number | null };
export type VersionPage = {
  tradeId: string;
  items: TradeVersion[];
  nextBeforeVersion: number | null;
};

function record(value: unknown, fields: string[]): Record<string, unknown> {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value)).toBe(true);
  const result = value as Record<string, unknown>;
  expect(Object.keys(result).sort()).toEqual([...fields].sort());
  return result;
}
function text(value: unknown): string {
  expect(typeof value).toBe('string');
  return value as string;
}
function integer(value: unknown, minimum = 0): number {
  expect(Number.isSafeInteger(value) && (value as number) >= minimum).toBe(true);
  return value as number;
}
function instant(value: unknown): string {
  const result = text(value);
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(new Date(result).toISOString()).toBe(result);
  return result;
}
function decimal(value: unknown, signed = false): string {
  const result = text(value);
  expect(result).toMatch(
    signed ? /^-?(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/ : /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/,
  );
  expect(result).not.toBe('-0');
  return result;
}
const originFields = ['accountId', 'requestId', 'originKind', 'coverageFrom', 'createdAt'];
const executionFields = [
  'instrumentId',
  'side',
  'occurredAt',
  'orderWithinTimestamp',
  'quantity',
  'grossUsd',
  'feeUsd',
];
const labelFields = [
  'instrumentId',
  'instrumentName',
  'instrumentSymbol',
  'occurredAt',
  'orderWithinTimestamp',
];
const summaryFields = [
  'grossBuysUsd',
  'buyFeesUsd',
  'grossSalesUsd',
  'sellFeesUsd',
  'netSalesUsd',
  'consumedCostUsd',
  'realizedUsd',
  'remainingCostUsd',
] as const;

export function readOrigin(value: unknown): OriginReceipt {
  const row = record(value, originFields);
  expect(row.originKind).toBe('declared-empty');
  return {
    accountId: uuid(row.accountId),
    requestId: uuid(row.requestId),
    originKind: 'declared-empty',
    coverageFrom: instant(row.coverageFrom),
    createdAt: instant(row.createdAt),
  };
}
function labels(row: Record<string, unknown>) {
  return {
    instrumentId: uuid(row.instrumentId),
    instrumentName: text(row.instrumentName),
    instrumentSymbol: row.instrumentSymbol === null ? null : text(row.instrumentSymbol),
    occurredAt: instant(row.occurredAt),
    orderWithinTimestamp: integer(row.orderWithinTimestamp),
  };
}
export function readTradeVersion(value: unknown): TradeVersion {
  const row = record(value, [
    ...executionFields,
    'instrumentName',
    'instrumentSymbol',
    'tradeId',
    'version',
    'journalRevision',
    'requestId',
    'kind',
    'createdAt',
  ]);
  expect(['create', 'correct', 'void']).toContain(row.kind);
  expect(['buy', 'sell']).toContain(row.side);
  return {
    ...labels(row),
    tradeId: uuid(row.tradeId),
    version: integer(row.version, 1),
    journalRevision: integer(row.journalRevision, 1),
    requestId: uuid(row.requestId),
    kind: row.kind as TradeVersion['kind'],
    createdAt: instant(row.createdAt),
    side: row.side as Execution['side'],
    quantity: decimal(row.quantity),
    grossUsd: decimal(row.grossUsd),
    feeUsd: decimal(row.feeUsd),
  };
}
export function readReceipt(value: unknown): TradeReceipt {
  const row = record(value, ['accountId', 'journalRevision', 'trade']);
  const trade = readTradeVersion(row.trade);
  const journalRevision = integer(row.journalRevision, 1);
  expect(trade.journalRevision).toBe(journalRevision);
  return { accountId: uuid(row.accountId), journalRevision, trade };
}
export function readState(value: unknown): JournalState {
  const row = record(value, ['accountId', 'eligible', 'ineligibilityReason', 'journal']);
  expect(typeof row.eligible).toBe('boolean');
  expect([null, 'opening-history', 'already-initialized']).toContain(row.ineligibilityReason);
  let journal: Journal | null = null;
  if (row.journal !== null) {
    const detail = record(row.journal, [
      ...originFields,
      'journalRevision',
      'activeTradeCount',
      'versionCount',
      'limits',
      'summary',
    ]);
    const summary = record(detail.summary, [...summaryFields]);
    const limits = record(detail.limits, ['activeTrades', 'versions']);
    expect(limits).toEqual({ activeTrades: 1000, versions: 10000 });
    const receipt = Object.fromEntries(originFields.map((field) => [field, detail[field]]));
    journal = {
      ...readOrigin(receipt),
      journalRevision: integer(detail.journalRevision),
      activeTradeCount: integer(detail.activeTradeCount),
      versionCount: integer(detail.versionCount),
      limits: { activeTrades: 1000, versions: 10000 },
      summary: Object.fromEntries(
        summaryFields.map((field) => [
          field,
          decimal(summary[field], ['netSalesUsd', 'realizedUsd'].includes(field)),
        ]),
      ) as Summary,
    };
  }
  return {
    accountId: uuid(row.accountId),
    eligible: row.eligible as boolean,
    ineligibilityReason: row.ineligibilityReason as JournalState['ineligibilityReason'],
    journal,
  };
}
export function readLot(value: unknown): Lot {
  const row = record(value, [
    ...labelFields,
    'buyTradeId',
    'buyVersion',
    'originalQuantity',
    'originalCostUsd',
    'remainingQuantity',
    'remainingCostUsd',
  ]);
  return {
    ...labels(row),
    buyTradeId: uuid(row.buyTradeId),
    buyVersion: integer(row.buyVersion, 1),
    originalQuantity: decimal(row.originalQuantity),
    originalCostUsd: decimal(row.originalCostUsd),
    remainingQuantity: decimal(row.remainingQuantity),
    remainingCostUsd: decimal(row.remainingCostUsd),
  };
}
export function readRealization(value: unknown): Realization {
  const row = record(value, [
    ...labelFields,
    'sellTradeId',
    'sellVersion',
    'quantity',
    'grossUsd',
    'feeUsd',
    'netUsd',
    'consumedCostUsd',
    'realizedUsd',
  ]);
  return {
    ...labels(row),
    sellTradeId: uuid(row.sellTradeId),
    sellVersion: integer(row.sellVersion, 1),
    quantity: decimal(row.quantity),
    grossUsd: decimal(row.grossUsd),
    feeUsd: decimal(row.feeUsd),
    netUsd: decimal(row.netUsd, true),
    consumedCostUsd: decimal(row.consumedCostUsd),
    realizedUsd: decimal(row.realizedUsd, true),
  };
}
export function readMatch(value: unknown): Match {
  const row = record(value, [
    'sellTradeId',
    'sellVersion',
    'buyTradeId',
    'buyVersion',
    'quantity',
    'costUsd',
  ]);
  return {
    sellTradeId: uuid(row.sellTradeId),
    sellVersion: integer(row.sellVersion, 1),
    buyTradeId: uuid(row.buyTradeId),
    buyVersion: integer(row.buyVersion, 1),
    quantity: decimal(row.quantity),
    costUsd: decimal(row.costUsd),
  };
}
export function readCurrentPage<T>(value: unknown, readItem: (item: unknown) => T): CurrentPage<T> {
  const row = record(value, ['journalRevision', 'items', 'nextOffset']);
  expect(Array.isArray(row.items)).toBe(true);
  return {
    journalRevision: integer(row.journalRevision),
    items: (row.items as unknown[]).map(readItem),
    nextOffset: row.nextOffset === null ? null : integer(row.nextOffset, 1),
  };
}
export function readVersions(value: unknown): VersionPage {
  const row = record(value, ['tradeId', 'items', 'nextBeforeVersion']);
  expect(Array.isArray(row.items)).toBe(true);
  return {
    tradeId: uuid(row.tradeId),
    items: (row.items as unknown[]).map(readTradeVersion),
    nextBeforeVersion: row.nextBeforeVersion === null ? null : integer(row.nextBeforeVersion, 1),
  };
}

export class TradeApi extends ManualApi {
  async initialize(account: string): Promise<OriginReceipt> {
    return readOrigin(
      await this.result('POST', `/accounts/${account}/trade-journal`, 201, {
        requestId: randomUUID(),
        coverageFrom,
        assertEmpty: true,
      }),
    );
  }
  async state(account: string): Promise<JournalState> {
    return readState(await this.result('GET', `/accounts/${account}/trade-journal`, 200));
  }
  async create(account: string, input: TradeInput, status = 201): Promise<TradeReceipt> {
    return readReceipt(await this.result('POST', `/accounts/${account}/trades`, status, input));
  }
  async correct(
    account: string,
    target: string,
    input: TradeInput,
    status = 201,
  ): Promise<TradeReceipt> {
    return readReceipt(
      await this.result('POST', `/accounts/${account}/trades/${target}/corrections`, status, input),
    );
  }
  async void(
    account: string,
    target: string,
    input: { requestId: string; expectedJournalRevision: number },
    status = 201,
  ): Promise<TradeReceipt> {
    return readReceipt(
      await this.result('POST', `/accounts/${account}/trades/${target}/voids`, status, input),
    );
  }
  async trades(account: string, query = ''): Promise<CurrentPage<TradeVersion>> {
    return readCurrentPage(
      await this.result('GET', `/accounts/${account}/trades${query}`, 200),
      readTradeVersion,
    );
  }
  async lots(account: string, query = ''): Promise<CurrentPage<Lot>> {
    return readCurrentPage(
      await this.result('GET', `/accounts/${account}/trade-lots${query}`, 200),
      readLot,
    );
  }
  async realizations(account: string, query = ''): Promise<CurrentPage<Realization>> {
    return readCurrentPage(
      await this.result('GET', `/accounts/${account}/trade-realizations${query}`, 200),
      readRealization,
    );
  }
  async matches(account: string, trade: string, query = ''): Promise<CurrentPage<Match>> {
    return readCurrentPage(
      await this.result('GET', `/accounts/${account}/trades/${trade}/matches${query}`, 200),
      readMatch,
    );
  }
  async versions(account: string, trade: string, query = ''): Promise<VersionPage> {
    return readVersions(
      await this.result('GET', `/accounts/${account}/trades/${trade}/versions${query}`, 200),
    );
  }
}
export async function tradeApi(page: Page): Promise<TradeApi> {
  const { csrfToken } = await loginWithMfa(page);
  return new TradeApi(page.context().request, csrfToken);
}
export function tradeInput(
  instrumentId: string,
  revision: number,
  changes: Partial<TradeInput> = {},
): TradeInput {
  return {
    requestId: randomUUID(),
    expectedJournalRevision: revision,
    instrumentId,
    side: 'buy',
    occurredAt: '2025-01-02T00:00:00.000Z',
    orderWithinTimestamp: revision,
    quantity: '1',
    grossUsd: '100',
    feeUsd: '0',
    ...changes,
  };
}
export function priorState(): string {
  return fingerprint(['auth_sessions', 'auth_request_limits', ...tradeTables]);
}
export function tradeRows(accountId: string): unknown {
  uuid(accountId);
  return Object.fromEntries(
    tradeTables.map((table) => [
      table,
      rows(
        `SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE "accountId"='${accountId}' ORDER BY row`,
      ),
    ]),
  );
}
export async function restartWithExactProviderWarmup(): Promise<{ method: string; url: string }[]> {
  const before = providerRequests();
  await restartBackends();
  const warmup = {
    method: 'GET',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
  };
  const expected = [...before, warmup, warmup];
  await expect.poll(providerRequests, { timeout: 10_000 }).toEqual(expected);
  return expected;
}

export async function withAccountLocked<T>(
  account: string,
  action: (release: () => Promise<void>) => Promise<T>,
): Promise<T> {
  uuid(account);
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
    { cwd: resolve(__dirname, '../..'), stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
  );
  const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
  let timer: ReturnType<typeof setTimeout>;
  const ready = new Promise<void>((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('SYNTHETIC_TRADE_LOCK')) resolve();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Synthetic account lock exited before readiness')));
    timer = setTimeout(
      () => reject(new Error('Synthetic account lock readiness timed out')),
      5_000,
    );
  });
  child.stdin.on('error', () => {}); // Independently check child exit; cleanup must not emit EPIPE.
  child.stdin.write(
    `BEGIN; SELECT id FROM manual_accounts WHERE id='${account}' FOR UPDATE; SELECT 'SYNTHETIC_TRADE_LOCK';\n`,
  );
  let released = false;
  const release = async () => {
    if (!released) {
      released = true;
      child.stdin.end('ROLLBACK;\n');
    }
    expect(await closed, 'Synthetic lock exits without changing any application row').toBe(0);
  };
  try {
    await ready;
    clearTimeout(timer!);
    return await action(release);
  } finally {
    clearTimeout(timer!);
    await release();
  }
}
export async function expectBlockedTradeWrites(count: number): Promise<void> {
  await expect
    .poll(
      () =>
        query(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
    AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%manual_accounts%'`),
      { timeout: 5_000 },
    )
    .toBe(String(count));
}
export async function raceTradeReplicas(
  account: string,
  first: () => Promise<APIResponse>,
  second: () => Promise<APIResponse>,
): Promise<APIResponse[]> {
  const source = (await hostSubject()).replace(/^v4:/, '').replace(/\/32$/, '');
  await selectBackend('primary');
  const mark = await upstreamMark();
  const pending: Promise<APIResponse>[] = [];
  const launch = (action: () => Promise<APIResponse>) => {
    const result = action();
    void result.catch(() => undefined);
    pending.push(result);
  };
  try {
    const responses = await withAccountLocked(account, async (release) => {
      launch(first);
      await expectBlockedTradeWrites(1);
      await selectBackend('replica');
      launch(second);
      await expectBlockedTradeWrites(2);
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
export function installTradeCommitFailure(account: string, requestId: string, marker: string) {
  uuid(account);
  uuid(requestId);
  const name = `acceptance_trade_${randomUUID().replace(/-/g, '')}`;
  query(`CREATE SEQUENCE ${name} START 1;
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN IF NEW."accountId"='${account}'::uuid AND NEW."requestId"='${requestId}'::uuid THEN
      IF NOT EXISTS(SELECT 1 FROM account_trades WHERE id=NEW."tradeId" AND "currentVersion"=NEW.version)
        OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "accountId"=NEW."accountId" AND "currentRevision"=NEW."journalRevision")
      THEN RAISE EXCEPTION 'Synthetic trade writes incomplete'; END IF;
      PERFORM nextval('${name}'); RAISE EXCEPTION '%', ${literal(marker)} USING DETAIL=NEW."canonicalPayload";
    END IF; RETURN NULL; END $body$;
    CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON account_trade_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  return {
    attempts: () =>
      rows<{ value: string; isCalled: boolean }>(
        `SELECT last_value::text AS value,is_called AS "isCalled" FROM ${name}`,
      ),
    remove: () =>
      query(
        `DROP TRIGGER IF EXISTS ${name} ON account_trade_versions; DROP FUNCTION IF EXISTS ${name}(); DROP SEQUENCE IF EXISTS ${name}`,
      ),
  };
}
export async function browserPost(page: Page, path: string, action: () => Promise<void>) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/accounting${path}` &&
      response.request().method() === 'POST',
  );
  await action();
  const response = await pending;
  expect(response.headers()['cache-control']).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  return response;
}
export function trackBrowserRequests(page: Page, api: TradeApi): () => void {
  let calls = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/accounting')) calls++;
  });
  return () =>
    expect(
      calls + api.calls,
      'Real browser plus API calls remain bounded below 100/min without resetting quotas',
    ).toBeLessThanOrEqual(85);
}
export { noStore };

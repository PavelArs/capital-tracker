import { createHash, randomUUID } from 'node:crypto';
import { type Page, expect } from '@playwright/test';
import { ledgerState } from './admission-fixtures';
import {
  backendLogs,
  literal,
  noStore,
  providerRequests,
  rows,
  uuid,
} from './manual-opening-fixtures';
import { fingerprint, origin, query, test } from './mfa-fixtures';
import { selectBackend, upstreamMark, upstreamsSince } from './replicas';
import { type TradeApi, readTradeVersion, tradeApi, tradeInput } from './usd-trades-fixtures';

type Kind = 'confirm' | 'rollback';
type Receipt = {
  accountId: string;
  batchId: string;
  requestId: string;
  kind: Kind;
  rowCount: number;
  firstJournalRevision: number;
  lastJournalRevision: number;
  createdAt: string;
};
type Preview = {
  batchId: string;
  parserVersion: string;
  journalRevision: number;
  canConfirm: boolean;
  previewHash: string | null;
  rows: { ordinal: number; startLine: number; execution: unknown }[];
  summaryBefore: unknown;
  candidateSummary: unknown;
  rowErrors: unknown[];
  batchErrors: unknown[];
};
const zero = {
  grossBuysUsd: '0',
  buyFeesUsd: '0',
  grossSalesUsd: '0',
  sellFeesUsd: '0',
  netSalesUsd: '0',
  consumedCostUsd: '0',
  realizedUsd: '0',
  remainingCostUsd: '0',
};
const mandatory = {
  grossBuysUsd: '300',
  buyFeesUsd: '0',
  grossSalesUsd: '450',
  sellFeesUsd: '0',
  netSalesUsd: '450',
  consumedCostUsd: '200',
  realizedUsd: '250',
  remainingCostUsd: '100',
};
function path(account: string, batch: string) {
  return `/accounts/${account}/csv-imports/${batch}`;
}
async function fixture(page: Page) {
  const api = await tradeApi(page);
  const account = await api.account();
  const instrument = await api.instrument();
  await api.initialize(account.id);
  const sourceKey = `TOKEN-private-${randomUUID()}`;
  const bytes = Buffer.from(
    `instrument,side,time,order,quantity,gross,fee\n${sourceKey},sell,2025-01-03T00:00:00Z,0,1.5,450,0\n${sourceKey},buy,2025-01-01T00:00:00Z,0,1,100,0\n${sourceKey},buy,2025-01-02T00:00:00Z,0,1,200,0\n`,
  );
  const settings = {
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
      instruments: [{ source: sourceKey, instrumentId: instrument.id }],
      sides: [
        { source: 'sell', side: 'sell' },
        { source: 'buy', side: 'buy' },
      ],
    },
    assertUsd: true,
  };
  api.calls++;
  const uploaded = await api.request.post(`/api/accounting/accounts/${account.id}/csv-imports`, {
    headers: { Origin: origin, 'X-CSRF-Token': api.csrfToken, Connection: 'close' },
    multipart: {
      file: { name: 'upload.csv', mimeType: 'application/octet-stream', buffer: bytes },
      displayNameBase64url: Buffer.from(`${sourceKey}.csv`).toString('base64url'),
    },
  });
  expect(uploaded.status()).toBe(201);
  noStore(uploaded);
  const identity = (await uploaded.json()) as Record<string, unknown>;
  expect(Object.keys(identity).sort()).toEqual(['batchId', 'byteLength', 'createdAt', 'sha256']);
  const batchId = uuid(identity.batchId);
  expect(identity.byteLength).toBe(bytes.length);
  expect(identity.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  return { api, account, instrument, batchId, settings, sourceKey };
}
async function result(
  api: TradeApi,
  method: string,
  endpoint: string,
  status: number,
  data?: unknown,
) {
  const response = await api.send(method, endpoint, data, { Connection: 'close' });
  expect(response.status(), `${method} ${endpoint}`).toBe(status);
  return response.json() as Promise<unknown>;
}
function preview(value: unknown, batchId: string, revision: number, instrumentId: string): Preview {
  expect(value).not.toBeNull();
  const row = value as Preview;
  expect(Object.keys(row).sort()).toEqual(
    [
      'batchId',
      'parserVersion',
      'journalRevision',
      'canConfirm',
      'rows',
      'ignoredColumns',
      'rowErrors',
      'batchErrors',
      'summaryBefore',
      'candidateSummary',
      'previewHash',
    ].sort(),
  );
  expect(row).toMatchObject({
    batchId,
    parserVersion: 'usd-csv-v1',
    journalRevision: revision,
    canConfirm: true,
    summaryBefore: zero,
    candidateSummary: mandatory,
    rowErrors: [],
    batchErrors: [],
    ignoredColumns: [],
  });
  expect(row.previewHash).toMatch(/^[0-9a-f]{64}$/);
  expect(row.rows.map((v) => [v.ordinal, v.startLine])).toEqual([
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
  expect(row.rows.map((v) => v.execution)).toEqual([
    expect.objectContaining({
      instrumentId,
      side: 'sell',
      occurredAt: '2025-01-03T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1.5',
      grossUsd: '450',
      feeUsd: '0',
    }),
    expect.objectContaining({
      instrumentId,
      side: 'buy',
      occurredAt: '2025-01-01T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '100',
      feeUsd: '0',
    }),
    expect.objectContaining({
      instrumentId,
      side: 'buy',
      occurredAt: '2025-01-02T00:00:00.000Z',
      orderWithinTimestamp: 0,
      quantity: '1',
      grossUsd: '200',
      feeUsd: '0',
    }),
  ]);
  return row;
}
function receipt(
  value: unknown,
  accountId: string,
  batchId: string,
  requestId: string,
  kind: Kind,
  first: number,
): Receipt {
  const row = value as Receipt;
  expect(Object.keys(row).sort()).toEqual(
    [
      'accountId',
      'batchId',
      'requestId',
      'kind',
      'rowCount',
      'firstJournalRevision',
      'lastJournalRevision',
      'createdAt',
    ].sort(),
  );
  expect(row).toEqual({
    accountId,
    batchId,
    requestId,
    kind,
    rowCount: 3,
    firstJournalRevision: first,
    lastJournalRevision: first + 2,
    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  });
  return row;
}
async function routed<T>(backend: 'primary' | 'replica', run: () => Promise<T>): Promise<T> {
  await selectBackend(backend);
  const mark = await upstreamMark();
  const value = await run();
  const evidence = await upstreamsSince(mark);
  expect(evidence.length).toBeGreaterThan(0);
  expect(new Set(evidence.map((item) => item.backend))).toEqual(new Set([backend]));
  return value;
}

async function exactImportedHistory(
  api: TradeApi,
  accountId: string,
  batchId: string,
  revision: number,
) {
  expect((await api.state(accountId)).journal).toMatchObject({
    journalRevision: revision,
    activeTradeCount: 3,
    versionCount: revision,
    summary: mandatory,
  });
  const lots = await api.lots(accountId, `?journalRevision=${revision}`);
  expect(lots.items).toHaveLength(1);
  expect(lots.items[0]).toMatchObject({ remainingQuantity: '0.5', remainingCostUsd: '100' });
  const sales = await api.realizations(accountId, `?journalRevision=${revision}`);
  expect(sales.items).toHaveLength(1);
  expect(sales.items[0]).toMatchObject({
    quantity: '1.5',
    consumedCostUsd: '200',
    realizedUsd: '250',
  });
  const provenance = (await result(api, 'GET', `${path(accountId, batchId)}/rows`, 200)) as {
    batchId: string;
    batchState: string;
    items: {
      ordinal: number;
      startLine: number;
      tradeId: string;
      createVersion: unknown;
      rollbackVersion: unknown;
    }[];
    nextAfterOrdinal: null;
  };
  expect(Object.keys(provenance).sort()).toEqual([
    'batchId',
    'batchState',
    'items',
    'nextAfterOrdinal',
  ]);
  expect(provenance).toMatchObject({ batchId, batchState: 'committed', nextAfterOrdinal: null });
  expect(provenance.items).toHaveLength(3);
  for (const [index, row] of provenance.items.entries()) {
    expect(Object.keys(row).sort()).toEqual([
      'createVersion',
      'ordinal',
      'rollbackVersion',
      'startLine',
      'tradeId',
    ]);
    expect([row.ordinal, row.startLine, row.rollbackVersion]).toEqual([index + 1, index + 2, null]);
    const created = readTradeVersion(row.createVersion);
    expect(created.tradeId).toBe(row.tradeId);
    expect(created.kind).toBe('create');
    expect(created.version).toBe(1);
    expect(created.journalRevision).toBe(revision - 2 + index);
    expect(created.side).toBe(index === 0 ? 'sell' : 'buy');
    expect(created.grossUsd).toBe(['450', '100', '200'][index]);
  }
}

test('CSV-003-B/CSV-005-A: real two-replica preview hashes, rejected stale commands and accepted receipt replay preserve exact whole-batch FIFO', async ({
  page,
}) => {
  const { api, account, instrument, batchId, settings } = await fixture(page);
  const providers = providerRequests();
  const admissions = ledgerState();
  try {
    const before = fingerprint(['auth_sessions']);
    const first = preview(
      await routed('primary', () =>
        result(api, 'POST', `${path(account.id, batchId)}/preview`, 200, settings),
      ),
      batchId,
      0,
      instrument.id,
    );
    const equivalent = {
      ...settings,
      mapping: {
        ...settings.mapping,
        instruments: settings.mapping.instruments.map((v) => ({
          ...v,
          instrumentId: v.instrumentId.toUpperCase(),
        })),
        sides: [...settings.mapping.sides].reverse(),
      },
    };
    const second = preview(
      await routed('replica', () =>
        result(api, 'POST', `${path(account.id, batchId)}/preview`, 200, equivalent),
      ),
      batchId,
      0,
      instrument.id,
    );
    expect(second).toEqual(first);
    expect(
      fingerprint(['auth_sessions']),
      'Preview performs zero source/command/trade/ledger writes',
    ).toBe(before);
    // A genuine manual create then void advances CAS while leaving the same active history.
    const manual = await api.create(
      account.id,
      tradeInput(instrument.id, 0, {
        occurredAt: '2025-01-04T00:00:00.000Z',
        quantity: '1',
        grossUsd: '1',
      }),
    );
    await api.void(account.id, manual.trade.tradeId, {
      requestId: randomUUID(),
      expectedJournalRevision: 1,
    });
    const afterManual = fingerprint(['auth_sessions']);
    const key = randomUUID();
    const stale = {
      ...settings,
      requestId: key,
      expectedJournalRevision: 0,
      parserVersion: first.parserVersion,
      previewHash: first.previewHash,
    };
    await result(api, 'POST', `${path(account.id, batchId)}/confirm`, 409, stale);
    expect(fingerprint(['auth_sessions'])).toBe(afterManual);
    await result(api, 'POST', `${path(account.id, batchId)}/confirm`, 409, {
      ...stale,
      expectedJournalRevision: 2,
    });
    expect(fingerprint(['auth_sessions'])).toBe(afterManual);
    const current = preview(
      await result(api, 'POST', `${path(account.id, batchId)}/preview`, 200, settings),
      batchId,
      2,
      instrument.id,
    );
    expect(current.previewHash).not.toBe(first.previewHash);
    const valid = { ...stale, expectedJournalRevision: 2, previewHash: current.previewHash };
    const changedHash = `${current.previewHash![0] === '0' ? '1' : '0'}${current.previewHash!.slice(1)}`;
    await result(api, 'POST', `${path(account.id, batchId)}/confirm`, 409, {
      ...valid,
      previewHash: changedHash,
    });
    expect(fingerprint(['auth_sessions'])).toBe(afterManual);
    const accepted = receipt(
      await routed('primary', () =>
        result(api, 'POST', `${path(account.id, batchId)}/confirm`, 201, valid),
      ),
      account.id,
      batchId,
      key,
      'confirm',
      3,
    );
    const committed = fingerprint(['auth_sessions']);
    expect(
      await routed('replica', () =>
        result(api, 'POST', `${path(account.id, batchId)}/confirm`, 200, {
          ...valid,
          ...equivalent,
        }),
      ),
    ).toEqual(accepted);
    expect(
      fingerprint(['auth_sessions']),
      'Replay does not reserve another key/range or rewind source state',
    ).toBe(committed);
    await exactImportedHistory(api, account.id, batchId, 5);
    expect(fingerprint(['auth_sessions'])).toBe(committed);
    expect(ledgerState()).toBe(admissions);
    expect(providerRequests()).toEqual(providers);
  } finally {
    await selectBackend('both');
  }
});

function commitFault(
  accountId: string,
  batchId: string,
  requestId: string,
  kind: Kind,
  marker: string,
) {
  uuid(accountId);
  uuid(batchId);
  uuid(requestId);
  const name = `csv_http_${randomUUID().replace(/-/g, '')}`;
  return {
    install() {
      query(`CREATE SEQUENCE ${name} START 1;
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $body$
      DECLARE rows_seen integer; versions_seen integer; expected_version integer;
      BEGIN IF NEW."accountId"=${literal(accountId)}::uuid AND NEW."batchId"=${literal(batchId)}::uuid AND NEW."requestId"=${literal(requestId)}::uuid THEN
        expected_version := CASE WHEN NEW.kind='confirm' THEN 1 ELSE 2 END;
        SELECT count(*) INTO rows_seen FROM account_csv_import_rows r JOIN account_trades t
          ON t."ownerId"=r."ownerId" AND t."accountId"=r."accountId" AND t.id=r."tradeId"
          WHERE r."ownerId"=NEW."ownerId" AND r."accountId"=NEW."accountId" AND r."batchId"=NEW."batchId"
          AND r."createVersion"=1 AND t."currentVersion"=expected_version
          AND ((NEW.kind='confirm' AND r."rollbackVersion" IS NULL) OR (NEW.kind='rollback' AND r."rollbackVersion"=2));
        SELECT count(*) INTO versions_seen FROM account_trade_versions v JOIN account_csv_import_rows r
          ON v."ownerId"=r."ownerId" AND v."accountId"=r."accountId" AND v."tradeId"=r."tradeId"
          WHERE r."ownerId"=NEW."ownerId" AND r."accountId"=NEW."accountId" AND r."batchId"=NEW."batchId"
          AND v.version=expected_version AND v.kind=CASE WHEN NEW.kind='confirm' THEN 'create' ELSE 'void' END
          AND v."journalRevision"=NEW."firstJournalRevision"+r.ordinal-1;
        IF NEW.kind<>${literal(kind)} OR NEW."rowCount"<>3 OR NEW."firstJournalRevision"<>${kind === 'confirm' ? 1 : 4} OR NEW."lastJournalRevision"<>${kind === 'confirm' ? 3 : 6}
          OR rows_seen<>3 OR versions_seen<>3
          OR NOT EXISTS(SELECT 1 FROM account_trade_journals WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND "currentRevision"=NEW."lastJournalRevision")
          OR NOT EXISTS(SELECT 1 FROM account_csv_imports WHERE "ownerId"=NEW."ownerId" AND "accountId"=NEW."accountId" AND id=NEW."batchId" AND "acceptedSettings" IS NOT NULL AND state=CASE WHEN NEW.kind='confirm' THEN 'committed' ELSE 'rolled-back' END)
        THEN RAISE EXCEPTION 'Synthetic CSV write stage incomplete'; END IF;
        PERFORM nextval('${name}'); RAISE EXCEPTION '%', ${literal(marker)} USING DETAIL=NEW."canonicalPayload";
      END IF; RETURN NULL; END $body$;
      CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON account_csv_import_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    },
    attempts: () =>
      rows<{ value: string; isCalled: boolean }>(
        `SELECT last_value::text AS value,is_called AS "isCalled" FROM ${name}`,
      ),
    remove() {
      try {
        query(`DROP TRIGGER IF EXISTS ${name} ON account_csv_import_commands`);
      } finally {
        try {
          query(`DROP FUNCTION IF EXISTS ${name}()`);
        } finally {
          query(`DROP SEQUENCE IF EXISTS ${name}`);
        }
      }
    },
    assertRemoved() {
      expect(
        query(
          `SELECT to_regclass('${name}') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proname='${name}') AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${name}')`,
        ),
      ).toBe('t');
    },
  };
}

test('CSV-003-C/CSV-004-B: real deferred HTTP COMMIT failures roll back complete confirm and rollback, hide private SQL data, and permit explicit original-key retry', async ({
  page,
}) => {
  const { api, account, instrument, batchId, settings, sourceKey } = await fixture(page);
  const providers = providerRequests();
  const admissions = ledgerState();
  const view = preview(
    await result(api, 'POST', `${path(account.id, batchId)}/preview`, 200, settings),
    batchId,
    0,
    instrument.id,
  );
  for (const kind of ['confirm', 'rollback'] as const) {
    const requestId = randomUUID();
    const input =
      kind === 'confirm'
        ? {
            ...settings,
            requestId,
            expectedJournalRevision: 0,
            parserVersion: view.parserVersion,
            previewHash: view.previewHash,
          }
        : { requestId, expectedJournalRevision: 3 };
    const endpoint = `${path(account.id, batchId)}/${kind}`;
    const before = fingerprint(['auth_sessions']);
    const marker = `csv-http-private-${randomUUID()}`;
    const fault = commitFault(account.id, batchId, requestId, kind, marker);
    try {
      fault.install();
      const failed = await api.send('POST', endpoint, input);
      expect(failed.status()).toBe(500);
      noStore(failed);
      const error = (await failed.json()) as Record<string, unknown>;
      expect(Object.keys(error).sort()).toEqual([
        'error',
        'message',
        'path',
        'statusCode',
        'timestamp',
      ]);
      expect(error).toMatchObject({
        statusCode: 500,
        message: 'Internal server error',
        error: 'InternalServerError',
        path: `/accounting${endpoint}`,
      });
      expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(
        fault.attempts(),
        'Nontransactional sequence proves all three versions/heads/links plus batch/receipt/pointer reached deferred COMMIT exactly once',
      ).toEqual([{ value: '1', isCalled: true }]);
      expect(
        fingerprint(['auth_sessions']),
        'Every business/CSV/ledger table survives failure unchanged',
      ).toBe(before);
      const output = `${JSON.stringify(error)}\n${backendLogs()}`;
      for (const privateValue of [
        sourceKey,
        marker,
        'canonicalPayload',
        'account_csv_import_commands',
        JSON.stringify(input),
      ])
        expect(
          output.includes(privateValue),
          'Generic500/logs contain no source or SQL payload',
        ).toBe(false);
    } finally {
      fault.remove();
    }
    fault.assertRemoved();
    expect(fingerprint(['auth_sessions'])).toBe(before);
    const accepted = receipt(
      await result(api, 'POST', endpoint, 201, input),
      account.id,
      batchId,
      requestId,
      kind,
      kind === 'confirm' ? 1 : 4,
    );
    const after = fingerprint(['auth_sessions']);
    expect(await result(api, 'POST', endpoint, 200, input)).toEqual(accepted);
    expect(
      fingerprint(['auth_sessions']),
      'Exact receipt replay appends no extra N-version range',
    ).toBe(after);
    if (kind === 'confirm') await exactImportedHistory(api, account.id, batchId, 3);
    else {
      expect((await api.state(account.id)).journal).toMatchObject({
        journalRevision: 6,
        activeTradeCount: 0,
        versionCount: 6,
        summary: zero,
      });
      const provenance = (await result(api, 'GET', `${path(account.id, batchId)}/rows`, 200)) as {
        batchState: string;
        items: { createVersion: unknown; rollbackVersion: unknown }[];
      };
      expect(provenance.batchState).toBe('rolled-back');
      expect(provenance.items).toHaveLength(3);
      for (const [index, row] of provenance.items.entries()) {
        const created = readTradeVersion(row.createVersion);
        const voided = readTradeVersion(row.rollbackVersion);
        expect(created).toMatchObject({ version: 1, kind: 'create', journalRevision: index + 1 });
        expect(voided).toMatchObject({
          tradeId: created.tradeId,
          version: 2,
          kind: 'void',
          journalRevision: index + 4,
          instrumentId: created.instrumentId,
          side: created.side,
          occurredAt: created.occurredAt,
          orderWithinTimestamp: created.orderWithinTimestamp,
          quantity: created.quantity,
          grossUsd: created.grossUsd,
          feeUsd: created.feeUsd,
        });
      }
    }
    expect(fingerprint(['auth_sessions'])).toBe(after);
  }
  expect(ledgerState()).toBe(admissions);
  expect(providerRequests()).toEqual(providers);
});

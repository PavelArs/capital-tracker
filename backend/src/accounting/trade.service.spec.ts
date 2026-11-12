import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { rewardHeadJoin, rewardVersionSelect } from './asset-reward.store';
import { swapHeadJoin, swapVersionSelect } from './asset-swap.store';
import { capitalReturnHeadJoin, capitalReturnVersionSelect } from './capital-return.store';
import { transferVersionSelect } from './owned-transfer.store';
import { TradeService } from './trade.service';
import { parseTradeCreate, parseTradeVoid } from './trade-input';
import { type JournalRow, type VersionRow, versionSelect } from './trade-journal.store';

// Characterization of the trade writes and the journal read against a recording fake manager:
// every statement (a short label, a hash of its full text and its parameters) in order, and
// the result or the error. Synthetic identifiers only.
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-0000000000a1';
const btc = '00000000-0000-4000-8000-0000000000b1';
const usd = '00000000-0000-4000-8000-0000000000b2';
const tradeA = '00000000-0000-4000-8000-0000000000c1';
const tradeB = '00000000-0000-4000-8000-0000000000c2';
const request = '00000000-0000-4000-8000-0000000000d1';
const earlier = '00000000-0000-4000-8000-0000000000d0';
const transfer = '00000000-0000-4000-8000-0000000000f1';
const createdAt = new Date('2026-03-01T00:00:00.000Z');

interface Instrument {
  id: string;
  name: string;
  symbol: string;
  assetType: 'fiat' | 'crypto';
}
interface World {
  account?: { id: string; currentRevision: number | null };
  journal?: JournalRow;
  opening?: boolean;
  replay?: VersionRow;
  heads: VersionRow[];
  instruments: Instrument[];
  rates?: { currency: string; rateDate: string; rubPerUnit: string }[];
  participants?: { transfer?: boolean; reward?: boolean; swap?: boolean };
  versionCount?: number;
}

const bitcoin: Instrument = { id: btc, name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto' };
const dollar: Instrument = { id: usd, name: 'US dollar', symbol: 'USD', assetType: 'fiat' };

function journal(over: Partial<JournalRow> = {}): JournalRow {
  return {
    accountId: account,
    requestId: earlier,
    canonicalPayload: '{"coverageFrom":"2026-01-01T00:00:00.000Z","assertEmpty":true}',
    originKind: 'declared-empty',
    openingRevision: null,
    coverageFrom: new Date('2026-01-01T00:00:00.000Z'),
    createdAt,
    currentRevision: 1,
    ...over,
  } as JournalRow;
}

function head(over: Partial<VersionRow> = {}): VersionRow {
  return {
    tradeId: tradeA,
    version: 1,
    journalRevision: 1,
    requestId: earlier,
    canonicalPayload: '{}',
    kind: 'create',
    createdAt,
    instrumentId: btc,
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    side: 'buy',
    occurredAt: new Date('2026-02-01T10:00:00.000Z'),
    orderWithinTimestamp: 0,
    quantity: '2',
    grossUsd: '100',
    feeUsd: '1',
    paidCurrency: null,
    paidGross: null,
    paidFee: null,
    paidRateDate: null,
    paidPerUsd: null,
    paidRateSource: null,
    comment: null,
    settlementInstrumentId: null,
    settlementName: null,
    settlementSymbol: null,
    settlementQuantity: null,
    purpose: null,
    ...over,
  };
}

/** Dollars bought into the account before the bitcoin. */
const cash = (quantity: string) =>
  head({
    tradeId: tradeB,
    instrumentId: usd,
    instrumentName: 'US dollar',
    instrumentSymbol: 'USD',
    occurredAt: new Date('2026-01-15T10:00:00.000Z'),
    quantity,
    grossUsd: quantity,
    feeUsd: '0',
  });

function world(over: Partial<World> = {}): World {
  return {
    account: { id: account, currentRevision: null },
    journal: journal(),
    heads: [head()],
    instruments: [bitcoin, dollar],
    ...over,
  };
}

function answer(state: World, sql: string, params: unknown[]): unknown[] {
  const has = (part: string) => sql.includes(part);
  const active = state.heads.filter((row) => row.kind !== 'void');
  if (has('pg_advisory_xact_lock')) return [];
  if (has('SELECT id,"currentRevision" FROM manual_accounts'))
    return state.account ? [state.account] : [];
  if (has('SELECT id FROM manual_accounts')) return (params[1] as string[]).map((id) => ({ id }));
  if (has('FROM account_opening_snapshots')) return [{ present: state.opening ?? false }];
  if (has('INSERT INTO account_trade_journals')) {
    state.journal = journal({
      requestId: params[2] as string,
      canonicalPayload: params[3] as string,
      coverageFrom: new Date(params[4] as string),
      currentRevision: 0,
    });
    return [state.journal];
  }
  if (has('FROM account_trade_journals')) return state.journal ? [state.journal] : [];
  if (has('FROM owned_transfer_versions')) return [];
  if (has('FROM owned_transfers t')) return state.participants?.transfer ? [{ id: account }] : [];
  if (has('FROM instrument_splits')) return [];
  if (has('count(*)::int AS count FROM account_trades t'))
    return active.length ? [{ accountId: account, count: active.length }] : [];
  if (has('count(*)::int AS count FROM account_trade_versions WHERE'))
    return [{ count: state.versionCount ?? 0 }];
  if (has('FROM account_reward_versions'))
    return has('GROUP BY') && state.participants?.reward ? [{ accountId: account, active: 0 }] : [];
  if (has('FROM account_swap_versions'))
    return has('GROUP BY') && state.participants?.swap ? [{ accountId: account, active: 0 }] : [];
  if (has('FROM account_capital_return_versions')) return [];
  if (has('INSERT INTO account_trade_versions'))
    return [
      {
        ...head(),
        tradeId: params[2],
        version: params[3],
        journalRevision: params[4],
        requestId: params[5],
        canonicalPayload: params[6],
        kind: params[7],
        instrumentId: params[8],
        side: params[9],
        occurredAt: new Date(params[10] as string),
        orderWithinTimestamp: params[11],
        quantity: params[12],
        grossUsd: params[13],
        feeUsd: params[14],
      },
    ];
  if (has('FROM account_trade_versions v')) {
    if (has('v."requestId"=$3')) return state.replay ? [state.replay] : [];
    if (has('ANY($2::uuid[])')) return active.map((row) => ({ ...row, accountId: account }));
    return state.heads;
  }
  if (has('SELECT name,symbol FROM accounting_instruments'))
    return state.instruments.filter((item) => item.id === params[1]);
  if (has('SELECT id,name,symbol FROM accounting_instruments'))
    return state.instruments
      .filter((item) => item.assetType === params[1] && item.symbol.toUpperCase() === params[2])
      .map(({ id, name, symbol }) => ({ id, name, symbol }));
  if (has('INSERT INTO accounting_instruments'))
    return [{ id: params[0], name: params[4], symbol: params[5] }];
  if (has('FROM fx_rates')) return state.rates ?? [];
  return [];
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const fragments: [string, string][] = [
  [versionSelect, 'versionSelect'],
  [transferVersionSelect, 'transferVersionSelect'],
  [rewardVersionSelect, 'rewardVersionSelect'],
  [rewardHeadJoin, 'rewardHeadJoin'],
  [swapVersionSelect, 'swapVersionSelect'],
  [swapHeadJoin, 'swapHeadJoin'],
  [capitalReturnVersionSelect, 'capitalReturnVersionSelect'],
  [capitalReturnHeadJoin, 'capitalReturnHeadJoin'],
];
/** A readable start of the statement and a hash of its exact text. */
function label(sql: string): string {
  let text = collapse(sql);
  for (const [fragment, name] of fragments) text = text.replace(collapse(fragment), name);
  const hash = createHash('sha256').update(sql).digest('hex').slice(0, 8);
  return `${text.length > 90 ? `${text.slice(0, 90)}…` : text} #${hash}`;
}

function describeError(error: unknown) {
  if (error instanceof HttpException)
    return {
      class: error.constructor.name,
      status: error.getStatus(),
      response: error.getResponse(),
    };
  return { class: (error as Error).constructor.name, message: (error as Error).message };
}

const names = new Map(
  Object.entries({ owner, account, btc, usd, tradeA, tradeB, request, earlier, transfer }).map(
    ([name, id]) => [id, name],
  ),
);
/** Known identifiers by name; random ones become `new-1`, `new-2`… in order of appearance. */
function normalize<T>(value: T): T {
  const fresh = new Map<string, string>();
  const text = JSON.stringify(value).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (id) => {
      const known = names.get(id);
      if (known) return known;
      if (!fresh.has(id)) fresh.set(id, `new-${fresh.size + 1}`);
      return fresh.get(id)!;
    },
  );
  return JSON.parse(text);
}

function recorder(state: World) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return answer(state, sql, params);
    },
    queryRunner: { isTransactionActive: true },
  } as unknown as EntityManager;
  const source = {
    transaction: async (...args: unknown[]) =>
      (args[args.length - 1] as (manager: EntityManager) => unknown)(manager),
  } as unknown as DataSource;
  return { calls, manager, service: new TradeService(source) };
}

async function run(state: World, work: (service: TradeService, manager: EntityManager) => unknown) {
  const { calls, manager, service } = recorder(state);
  const trace = () => calls.map(({ sql, params }) => `${label(sql)} ${JSON.stringify(params)}`);
  try {
    const value = await work(service, manager);
    return normalize({ trace: trace(), value });
  } catch (error) {
    return normalize({ trace: trace(), error: describeError(error) });
  }
}

const buy = (over: Record<string, unknown> = {}) =>
  parseTradeCreate({
    requestId: request,
    expectedJournalRevision: 1,
    instrumentId: btc,
    side: 'buy',
    occurredAt: '2026-02-02T10:00:00.000Z',
    quantity: '1',
    grossUsd: '50',
    feeUsd: '0.5',
    ...over,
  });

const sell = (over: Record<string, unknown> = {}) => buy({ side: 'sell', ...over });
const voiding = (expectedJournalRevision = 1) =>
  parseTradeVoid({ requestId: request, expectedJournalRevision });
type Input = ReturnType<typeof buy> | ReturnType<typeof voiding>;

function mutate(
  state: World,
  kind: 'create' | 'correct' | 'void',
  target: string | undefined,
  input: Input,
  apart?: string,
) {
  return run(state, (service, manager) =>
    service.mutateWithin(manager, owner, account, kind, target, input, apart),
  );
}

describe('TradeService.mutateWithin characterization', () => {
  it('starts the journal of an account without one and saves its first trade', async () => {
    const state = world({ journal: undefined, heads: [] });
    const input = buy({ expectedJournalRevision: 0, comment: 'first' });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$… #4e41e910 ["owner","account"]",
    "INSERT INTO account_trade_journals ("ownerId","accountId","requestId","canonicalPayload","… #72eec9ba ["owner","account","request","{\\"coverageFrom\\":\\"1970-01-01T00:00:00.000Z\\",\\"assertEmpty\\":true}","1970-01-01T00:00:00.000Z"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,1,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":0,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"comment\\":\\"first\\"}","create","btc","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_comments ("ownerId","accountId","tradeId",version,commen… #ca1c37e3 ["owner","account","new-1",1,"first"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",1]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 1,
      "trade": {
        "comment": "first",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 1,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "side": "buy",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('refuses a first trade of an account opened with balances', async () => {
    const state = world({ journal: undefined, account: { id: account, currentRevision: 3 } });
    const input = buy({ expectedJournalRevision: 0 });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "coverage": {
        "accountId": "account",
        "coverageFrom": null,
      },
      "error": "Conflict",
      "message": "The records of an account have not started",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
  ],
}
`);
  });

  it('refuses a first trade of an account with an opening snapshot', async () => {
    const state = world({ journal: undefined, opening: true });
    const input = buy({ expectedJournalRevision: 0 });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "coverage": {
        "accountId": "account",
        "coverageFrom": null,
      },
      "error": "Conflict",
      "message": "The records of an account have not started",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$… #4e41e910 ["owner","account"]",
  ],
}
`);
  });

  it('refuses a create at a later revision on an account without a journal', async () => {
    const state = world({ journal: undefined });
    expect(await mutate(state, 'create', undefined, buy())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
  ],
}
`);
  });

  it('refuses a void on an account without a journal', async () => {
    const state = world({ journal: undefined });
    expect(await mutate(state, 'void', tradeA, voiding())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
  ],
}
`);
  });

  it('refuses an account the owner does not hold', async () => {
    const state = world({ account: undefined });
    expect(await mutate(state, 'create', undefined, buy())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "NotFoundException",
    "response": {
      "message": "Not Found",
      "statusCode": 404,
    },
    "status": 404,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
  ],
}
`);
  });

  it('replays a request with the same payload and refuses one with another', async () => {
    // The payload a create writes, read back as the replayed version.
    const probe = recorder(world());
    await probe.service.mutateWithin(probe.manager, owner, account, 'create', undefined, buy());
    const insert = probe.calls.find(({ sql }) =>
      sql.includes('INSERT INTO account_trade_versions'),
    )!;
    const replay = head({
      tradeId: tradeB,
      version: 1,
      journalRevision: 2,
      requestId: request,
      canonicalPayload: insert.params[6] as string,
      occurredAt: new Date('2026-02-02T10:00:00.000Z'),
      quantity: '1',
      grossUsd: '50',
      feeUsd: '0.5',
    });
    expect(await mutate(world({ replay }), 'create', undefined, buy())).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
  ],
  "value": {
    "created": false,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "side": "buy",
        "tradeId": "tradeB",
        "version": 1,
      },
    },
  },
}
`);
    expect(
      await mutate(
        world({ replay: { ...replay, canonicalPayload: '{}' } }),
        'create',
        undefined,
        buy(),
      ),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
  ],
}
`);
  });

  it('refuses a correction of a trade the account does not have', async () => {
    expect(await mutate(world(), 'correct', tradeB, buy())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "NotFoundException",
    "response": {
      "message": "Not Found",
      "statusCode": 404,
    },
    "status": 404,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
  ],
}
`);
  });

  it('refuses an instrument the owner does not have', async () => {
    const state = world({ instruments: [dollar] });
    expect(await mutate(state, 'create', undefined, buy())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "NotFoundException",
    "response": {
      "message": "Not Found",
      "statusCode": 404,
    },
    "status": 404,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('saves a buy paid in rubles at the stored rate', async () => {
    const state = world({ rates: [{ currency: 'USD', rateDate: '2026-02-02', rubPerUnit: '80' }] });
    const input = buy({
      grossUsd: undefined,
      feeUsd: undefined,
      paid: { currency: 'RUB', gross: '8000', fee: '80' },
    });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate", "rubPerUnit"::text AS "r… #1c79aed5 ["cbr",["USD","EUR"]]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"paid\\":{\\"currency\\":\\"RUB\\",\\"gross\\":\\"8000\\",\\"fee\\":\\"80\\"}}","create","btc","buy","2026-02-02T10:00:00.000Z",0,"1","100","1"]",
    "INSERT INTO account_trade_version_payments ("ownerId","accountId","tradeId",version,curren… #d3352eaf ["owner","account","new-1",1,"RUB","8000","80","2026-02-02","80","bank-of-russia"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "1",
        "grossUsd": "100",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "paid": {
          "currency": "RUB",
          "fee": "80",
          "gross": "8000",
          "perUsd": "80",
          "rateDate": "2026-02-02",
          "rateSource": "bank-of-russia",
        },
        "quantity": "1",
        "requestId": "request",
        "side": "buy",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('refuses a paid amount that rounds to nothing as a bad request', async () => {
    const input = buy({
      grossUsd: undefined,
      feeUsd: undefined,
      paid: {
        currency: 'RUB',
        gross: '0.000000000000000000000000000001',
        fee: '0',
        perUsd: '1000',
      },
    });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "HttpException",
    "response": "Invalid accounting input",
    "status": 400,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate", "rubPerUnit"::text AS "r… #1c79aed5 ["cbr",["USD","EUR"]]",
  ],
}
`);
  });

  it('refuses a paid amount without a stored rate', async () => {
    const input = buy({
      grossUsd: undefined,
      feeUsd: undefined,
      paid: { currency: 'EUR', gross: '10', fee: '0' },
    });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "No Bank of Russia rate is stored for the trade date",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT currency, to_char("rateDate", 'YYYY-MM-DD') AS "rateDate", "rubPerUnit"::text AS "r… #1c79aed5 ["cbr",["USD","EUR"]]",
  ],
}
`);
  });

  it('places a trade after every event at its instant', async () => {
    const input = sell({ occurredAt: '2026-02-01T10:00:00.000Z' });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"sell\\",\\"occurredAt\\":\\"2026-02-01T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\"}","create","btc","sell","2026-02-01T10:00:00.000Z",1,"1","50","0.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 1,
        "quantity": "1",
        "requestId": "request",
        "side": "sell",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('keeps a given order and refuses an automatic one past the integer bound', async () => {
    const given = sell({ occurredAt: '2026-02-01T10:00:00.000Z', orderWithinTimestamp: 7 });
    expect(await mutate(world(), 'create', undefined, given)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"sell\\",\\"occurredAt\\":\\"2026-02-01T10:00:00.000Z\\",\\"orderWithinTimestamp\\":7,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\"}","create","btc","sell","2026-02-01T10:00:00.000Z",7,"1","50","0.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 7,
        "quantity": "1",
        "requestId": "request",
        "side": "sell",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
    const state = world({ heads: [head({ orderWithinTimestamp: 2147483647 })] });
    const input = sell({ occurredAt: '2026-02-01T10:00:00.000Z' });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('corrects a trade in place', async () => {
    const input = buy({ quantity: '3', orderWithinTimestamp: 0 });
    expect(await mutate(world(), 'correct', tradeA, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","tradeA",2,2,"request","{\\"kind\\":\\"correct\\",\\"tradeId\\":\\"tradeA\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"quantity\\":\\"3\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\"}","correct","btc","buy","2026-02-02T10:00:00.000Z",0,"3","50","0.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","tradeA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "3",
        "requestId": "request",
        "side": "buy",
        "tradeId": "tradeA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('voids a trade', async () => {
    expect(await mutate(world(), 'void', tradeA, voiding())).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","tradeA",2,2,"request","{\\"kind\\":\\"void\\",\\"tradeId\\":\\"tradeA\\",\\"expectedJournalRevision\\":1}","void","btc","buy","2026-02-01T10:00:00.000Z",0,"2","100","1"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","tradeA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "1",
        "grossUsd": "100",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "void",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "2",
        "requestId": "request",
        "side": "buy",
        "tradeId": "tradeA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('refuses a void without a target', async () => {
    expect(await mutate(world(), 'void', undefined, voiding())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "NotFoundException",
    "response": {
      "message": "Not Found",
      "statusCode": 404,
    },
    "status": 404,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
  ],
}
`);
  });

  it('refuses a correction of a voided trade', async () => {
    const state = world({ heads: [head(), head({ tradeId: tradeB, kind: 'void', version: 2 })] });
    expect(await mutate(state, 'correct', tradeB, buy())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('refuses a stale journal revision and a full journal', async () => {
    expect(
      await mutate(world(), 'create', undefined, buy({ expectedJournalRevision: 2 })),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
    const full = world({ journal: journal({ currentRevision: 10000 }) });
    expect(
      await mutate(full, 'create', undefined, buy({ expectedJournalRevision: 10000 })),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Trade request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('refuses a trade dated before the journal starts', async () => {
    const input = buy({ occurredAt: '2025-12-31T10:00:00.000Z' });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "coverage": {
        "accountId": "account",
        "coverageFrom": "2026-01-01T00:00:00.000Z",
      },
      "error": "Conflict",
      "message": "The records of an account start after this entry",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('settles a sale in a cash asset it creates', async () => {
    const state = world({ instruments: [bitcoin] });
    const input = sell({ settlementCurrency: 'USD' });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND "assetType"=$2 AN… #e0b1fc79 ["owner","fiat","USD"]",
    "INSERT INTO accounting_instruments (id,"ownerId","requestId","canonicalPayload",name,symbo… #2c298868 ["new-1","owner","new-2","{\\"name\\":\\"US dollar\\",\\"symbol\\":\\"USD\\",\\"assetType\\":\\"fiat\\",\\"valuationCurrency\\":\\"USD\\"}","US dollar","USD","fiat","USD","fixed"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-3","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-3",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"sell\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"settlementCurrency\\":\\"USD\\"}","create","btc","sell","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_settlements ("ownerId","accountId","tradeId",version,"in… #3802c79e ["owner","account","new-3",1,"new-1","49.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-3",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "settlement": {
          "instrumentId": "new-1",
          "instrumentName": "US dollar",
          "instrumentSymbol": "USD",
          "quantity": "49.5",
        },
        "side": "sell",
        "tradeId": "new-3",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('settles a buy in the cash the account holds', async () => {
    const state = world({ heads: [cash('20'), head()] });
    const input = buy({ settlementCurrency: 'USD' });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND "assetType"=$2 AN… #e0b1fc79 ["owner","fiat","USD"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"settlementCurrency\\":\\"USD\\"}","create","btc","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_settlements ("ownerId","accountId","tradeId",version,"in… #3802c79e ["owner","account","new-1",1,"usd","20"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "settlement": {
          "instrumentId": "usd",
          "instrumentName": "US dollar",
          "instrumentSymbol": "USD",
          "quantity": "20",
        },
        "side": "buy",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('settles a buy in no cash when the owner has no cash asset', async () => {
    const state = world({ instruments: [bitcoin] });
    const input = buy({ settlementCurrency: 'USD' });
    expect(await mutate(state, 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND "assetType"=$2 AN… #e0b1fc79 ["owner","fiat","USD"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"settlementCurrency\\":\\"USD\\"}","create","btc","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "side": "buy",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('refuses a trade settled in the asset it trades', async () => {
    const input = buy({ instrumentId: usd, settlementCurrency: 'USD' });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "HttpException",
    "response": "A trade cannot be settled in the asset it trades",
    "status": 400,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","usd"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND "assetType"=$2 AN… #e0b1fc79 ["owner","fiat","USD"]",
  ],
}
`);
  });

  it('settles a corrected buy apart from a named transfer', async () => {
    const state = world({ heads: [cash('100'), head()] });
    const input = buy({ settlementCurrency: 'USD', orderWithinTimestamp: 0 });
    expect(await mutate(state, 'correct', tradeA, input, transfer)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND "assetType"=$2 AN… #e0b1fc79 ["owner","fiat","USD"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","tradeA",2,2,"request","{\\"kind\\":\\"correct\\",\\"tradeId\\":\\"tradeA\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"settlementCurrency\\":\\"USD\\"}","correct","btc","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_settlements ("ownerId","accountId","tradeId",version,"in… #3802c79e ["owner","account","tradeA",2,"usd","50.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","tradeA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "1",
        "requestId": "request",
        "settlement": {
          "instrumentId": "usd",
          "instrumentName": "US dollar",
          "instrumentSymbol": "USD",
          "quantity": "50.5",
        },
        "side": "buy",
        "tradeId": "tradeA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('refuses a sale larger than the account holds', async () => {
    const input = sell({ quantity: '5' });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "dependent": {
        "accountId": "account",
        "availableQuantity": "2",
        "instrumentId": "btc",
        "missingQuantity": "3",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "operationId": "trade:new-1",
        "requiredQuantity": "5",
      },
      "error": "Conflict",
      "message": "An account does not hold enough for this trade",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('refuses a void that a later sale depends on', async () => {
    const later = head({
      tradeId: tradeB,
      side: 'sell',
      occurredAt: new Date('2026-02-03T10:00:00.000Z'),
      quantity: '1',
    });
    const state = world({ heads: [head(), later] });
    expect(await mutate(state, 'void', tradeA, voiding())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "dependent": {
        "accountId": "account",
        "availableQuantity": "0",
        "instrumentId": "btc",
        "missingQuantity": "1",
        "occurredAt": "2026-02-03T10:00:00.000Z",
        "operationId": "trade:tradeB",
        "requiredQuantity": "1",
      },
      "error": "Conflict",
      "message": "A later operation depends on this trade",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
  ],
}
`);
  });

  it('saves the purpose of an income', async () => {
    const input = buy({ purpose: 'income' });
    expect(await mutate(world(), 'create', undefined, input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #c8de43cf ["owner","account","request"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES … #5f9af46e ["new-1","owner","account"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevisi… #bb283ff3 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"instrumentId\\":\\"btc\\",\\"side\\":\\"buy\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"1\\",\\"grossUsd\\":\\"50\\",\\"feeUsd\\":\\"0.5\\",\\"purpose\\":\\"income\\"}","create","btc","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_purposes ("ownerId","accountId","tradeId",version,purpos… #3fe28073 ["owner","account","new-1",1,"income"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id… #3b052609 ["owner","account","new-1",1]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "trade": {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeUsd": "0.5",
        "grossUsd": "50",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "purpose": "income",
        "quantity": "1",
        "requestId": "request",
        "side": "buy",
        "tradeId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });
});

describe('TradeService.getJournal characterization', () => {
  const read = (state: World) => run(state, (service) => service.getJournal(owner, account));

  it('reports an account without a journal as eligible or not', async () => {
    expect(await read(world({ journal: undefined }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$… #4e41e910 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": true,
    "ineligibilityReason": null,
    "journal": null,
  },
}
`);
    expect(
      await read(world({ journal: undefined, account: { id: account, currentRevision: 2 } })),
    ).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "opening-history",
    "journal": null,
  },
}
`);
    expect(await read(world({ journal: undefined, opening: true }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$… #4e41e910 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "opening-history",
    "journal": null,
  },
}
`);
  });

  it('reports a journal without transfers, rewards or swaps', async () => {
    expect(await read(world({ versionCount: 3 }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "SELECT count(*)::int AS count FROM account_trade_versions WHERE "ownerId"=$1 AND "accountI… #cc657235 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "already-initialized",
    "journal": {
      "accountId": "account",
      "activeTradeCount": 1,
      "coverageFrom": "2026-01-01T00:00:00.000Z",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "journalRevision": 1,
      "limits": {
        "activeTrades": 1000,
        "versions": 10000,
      },
      "originKind": "declared-empty",
      "requestId": "earlier",
      "summary": {
        "buyFeesUsd": "1",
        "consumedCostUsd": "0",
        "grossBuysUsd": "100",
        "grossSalesUsd": "0",
        "netSalesUsd": "0",
        "realizedUsd": "0",
        "remainingCostUsd": "101",
        "sellFeesUsd": "0",
      },
      "versionCount": 3,
    },
  },
}
`);
  });

  it('reports the summaries and the revision budget of each participation', async () => {
    expect(await read(world({ participants: { transfer: true } }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "SELECT count(*)::int AS count FROM account_trade_versions WHERE "ownerId"=$1 AND "accountI… #cc657235 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "already-initialized",
    "journal": {
      "accountId": "account",
      "activeTradeCount": 1,
      "coverageFrom": "2026-01-01T00:00:00.000Z",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "journalRevision": 1,
      "limits": {
        "activeTrades": 1000,
        "versions": 10000,
      },
      "originKind": "declared-empty",
      "requestId": "earlier",
      "revisionBudget": {
        "limit": 10000,
        "used": 1,
      },
      "summary": {
        "buyFeesUsd": "1",
        "consumedCostUsd": "0",
        "grossBuysUsd": "100",
        "grossSalesUsd": "0",
        "netSalesUsd": "0",
        "realizedUsd": "0",
        "remainingCostUsd": "101",
        "sellFeesUsd": "0",
      },
      "transferSummary": {
        "feeConsumedBasisUsd": "0",
        "fees": [],
        "receivedBasisUsd": "0",
        "sentBasisUsd": "0",
      },
      "versionCount": 0,
    },
  },
}
`);
    expect(await read(world({ participants: { reward: true } }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "SELECT count(*)::int AS count FROM account_trade_versions WHERE "ownerId"=$1 AND "accountI… #cc657235 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "already-initialized",
    "journal": {
      "accountId": "account",
      "activeTradeCount": 1,
      "coverageFrom": "2026-01-01T00:00:00.000Z",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "journalRevision": 1,
      "limits": {
        "activeTrades": 1000,
        "versions": 10000,
      },
      "originKind": "declared-empty",
      "requestId": "earlier",
      "revisionBudget": {
        "limit": 10000,
        "used": 1,
      },
      "rewardSummary": {
        "activeCount": 0,
        "declaredBasisUsd": "0",
        "declaredIncomeUsd": "0",
        "knownBasisSubtotalUsd": "0",
        "knownIncomeSubtotalUsd": "0",
        "unclassifiedCount": 0,
        "unknownBasisCount": 0,
        "unknownIncomeCount": 0,
      },
      "summary": {
        "buyFeesUsd": "1",
        "consumedCostUsd": "0",
        "grossBuysUsd": "100",
        "grossSalesUsd": "0",
        "netSalesUsd": "0",
        "realizedUsd": "0",
        "remainingCostUsd": "101",
        "sellFeesUsd": "0",
      },
      "versionCount": 0,
    },
  },
}
`);
    expect(await read(world({ participants: { swap: true } }))).toMatchInlineSnapshot(`
{
  "trace": [
    "SET TRANSACTION READ ONLY #6c20e534 []",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #6a82d302 ["owner","account"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN account_trade_versi… #e2ff6b80 ["owner",["account"]]",
    "versionSelect JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accoun… #554b7dea ["owner",["account"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_rew… #6253c38d ["owner",["account"]]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) … #017d693f ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_swa… #2e3ca39a ["owner",["account"]]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND … #3d3a610c ["owner",["account"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM account_cap… #28fc5887 ["owner",["account"]]",
    "capitalReturnVersionSelect capitalReturnHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=AN… #4ce3a23d ["owner",["account"],1001]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATERAL (VALUES(t."fromAc… #09752f90 ["owner",["account"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits WHERE "ownerId"=$1 … #c5952854 ["owner",1001]",
    "SELECT count(*)::int AS count FROM account_trade_versions WHERE "ownerId"=$1 AND "accountI… #cc657235 ["owner","account"]",
  ],
  "value": {
    "accountId": "account",
    "eligible": false,
    "ineligibilityReason": "already-initialized",
    "journal": {
      "accountId": "account",
      "activeTradeCount": 1,
      "coverageFrom": "2026-01-01T00:00:00.000Z",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "journalRevision": 1,
      "limits": {
        "activeTrades": 1000,
        "versions": 10000,
      },
      "originKind": "declared-empty",
      "requestId": "earlier",
      "revisionBudget": {
        "limit": 10000,
        "used": 1,
      },
      "summary": {
        "buyFeesUsd": "1",
        "consumedCostUsd": "0",
        "grossBuysUsd": "100",
        "grossSalesUsd": "0",
        "netSalesUsd": "0",
        "realizedUsd": "0",
        "remainingCostUsd": "101",
        "sellFeesUsd": "0",
      },
      "swapSummary": {
        "activeCount": 0,
        "considerationUsd": "0",
        "coverage": {
          "consideration": {
            "knownSubtotalUsd": "0",
            "unknownCount": 0,
          },
          "fee": {
            "knownSubtotalUsd": "0",
            "unknownCount": 0,
          },
          "principal": {
            "knownSubtotalUsd": "0",
            "unknownCount": 0,
          },
          "realized": {
            "knownSubtotalUsd": "0",
            "unknownCount": 0,
          },
        },
        "feeConsumedBasisUsd": "0",
        "principalBasisUsd": "0",
        "realizedUsd": "0",
      },
      "versionCount": 0,
    },
  },
}
`);
  });
});

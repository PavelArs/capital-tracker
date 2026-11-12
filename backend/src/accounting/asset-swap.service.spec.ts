import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { rewardHeadJoin, rewardVersionSelect } from './asset-reward.store';
import { AssetSwapService } from './asset-swap.service';
import { type SwapVersionRow, swapHeadJoin, swapVersionSelect } from './asset-swap.store';
import {
  parseSwapCorrection,
  parseSwapCreate,
  parseSwapVoid,
  swapPayload,
} from './asset-swap-input';
import { capitalReturnHeadJoin, capitalReturnVersionSelect } from './capital-return.store';
import { transferVersionSelect } from './owned-transfer.store';
import { type JournalRow, type VersionRow, versionSelect } from './trade-journal.store';

// Characterization of AssetSwapService.mutateWithin against a recording fake manager: every
// statement (a short label, a hash of its full text and its parameters) in order, and the
// result or the error. Synthetic identifiers only.
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-0000000000a1';
const btc = '00000000-0000-4000-8000-0000000000b1';
const eth = '00000000-0000-4000-8000-0000000000b3';
const trade = '00000000-0000-4000-8000-0000000000c1';
const swapA = '00000000-0000-4000-8000-0000000000e1';
const swapB = '00000000-0000-4000-8000-0000000000e2';
const request = '00000000-0000-4000-8000-0000000000d1';
const earlier = '00000000-0000-4000-8000-0000000000d0';
const createdAt = new Date('2026-03-01T00:00:00.000Z');

interface Counts {
  versions: number;
  active: number;
}
interface World {
  account?: { id: string; currentRevision: number | null };
  journal: JournalRow;
  trades: VersionRow[];
  swaps: SwapVersionRow[];
  instruments: { id: string; name: string; symbol: string }[];
  ownerCounts?: Counts;
  accountCounts?: Counts;
}

function journal(over: Partial<JournalRow> = {}): JournalRow {
  return {
    accountId: account,
    requestId: earlier,
    canonicalPayload: '{}',
    originKind: 'declared-empty',
    openingRevision: null,
    coverageFrom: new Date('2026-01-01T00:00:00.000Z'),
    createdAt,
    currentRevision: 1,
    ...over,
  } as JournalRow;
}

/** Two bitcoin bought before the swaps. */
function bought(over: Partial<VersionRow> = {}): VersionRow {
  return {
    tradeId: trade,
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

function stored(over: Partial<SwapVersionRow> = {}): SwapVersionRow {
  return {
    accountId: account,
    swapId: swapA,
    version: 1,
    journalRevision: 2,
    requestId: earlier,
    kind: 'create',
    createdAt,
    outgoingInstrumentId: btc,
    outgoingInstrumentName: 'Bitcoin',
    outgoingInstrumentSymbol: 'BTC',
    incomingInstrumentId: eth,
    incomingInstrumentName: 'Ether',
    incomingInstrumentSymbol: 'ETH',
    occurredAt: new Date('2026-02-02T10:00:00.000Z'),
    orderWithinTimestamp: 0,
    outgoingQuantity: '1',
    incomingQuantity: '30',
    considerationUsd: '50',
    feeSource: null,
    feeInstrumentId: null,
    feeInstrumentName: null,
    feeInstrumentSymbol: null,
    feeQuantity: '0',
    canonicalPayload: '{}',
    ...over,
  };
}

function world(over: Partial<World> = {}): World {
  return {
    account: { id: account, currentRevision: null },
    journal: journal(),
    trades: [bought()],
    swaps: [],
    instruments: [
      { id: btc, name: 'Bitcoin', symbol: 'BTC' },
      { id: eth, name: 'Ether', symbol: 'ETH' },
    ],
    ...over,
  };
}

function answer(state: World, sql: string, params: unknown[]): unknown[] {
  const has = (part: string) => sql.includes(part);
  const heads = state.swaps.filter(
    (row) =>
      !state.swaps.some((other) => other.swapId === row.swapId && other.version > row.version),
  );
  const active = heads.filter((row) => row.kind !== 'void');
  if (has('pg_advisory_xact_lock')) return [];
  if (has('SELECT id,"currentRevision" FROM manual_accounts'))
    return state.account ? [state.account] : [];
  if (has('SELECT id FROM manual_accounts')) return (params[1] as string[]).map((id) => ({ id }));
  if (has('FROM account_trade_journals')) return [state.journal];
  if (has('FROM owned_transfer_versions')) return [];
  if (has('FROM owned_transfers t')) return [];
  if (has('FROM instrument_splits')) return [];
  if (has('count(*)::int AS count FROM account_trades t'))
    return [{ accountId: account, count: state.trades.length }];
  if (has('FROM account_trade_versions v'))
    return state.trades.map((row) => ({ ...row, accountId: account }));
  if (has('FROM account_reward_versions')) return [];
  if (has('FROM account_capital_return_versions')) return [];
  if (has('count(*)::int AS count FROM account_swap_versions v WHERE')) {
    const counts = params.length === 1 ? state.ownerCounts : state.accountCounts;
    return [{ count: counts?.versions ?? state.swaps.length }];
  }
  if (has('count(*)::int AS count,count(*) FILTER')) {
    const counts = params.length === 1 ? state.ownerCounts : state.accountCounts;
    return [{ count: heads.length, active: counts?.active ?? active.length }];
  }
  if (has('SELECT v."accountId",count(*) FILTER'))
    return active.length ? [{ accountId: account, active: active.length }] : [];
  if (has('INSERT INTO account_swap_versions')) {
    const keys = ['ownerId', 'accountId', 'swapId', 'version', 'journalRevision', 'requestId'];
    const rest = ['canonicalPayload', 'kind', 'outgoingInstrumentId', 'incomingInstrumentId'];
    const tail = ['orderWithinTimestamp', 'outgoingQuantity', 'incomingQuantity'];
    const fee = ['considerationUsd', 'feeSource', 'feeInstrumentId', 'feeQuantity'];
    const row = Object.fromEntries(
      [...keys, ...rest, 'occurredAt', ...tail, ...fee].map((key, index) => [key, params[index]]),
    );
    return [{ ...row, occurredAt: new Date(row.occurredAt as string), createdAt }];
  }
  if (has('FROM account_swap_versions v')) {
    if (has('v."requestId"=$3')) return state.swaps.filter((row) => row.requestId === params[2]);
    if (has('v."swapId"=$3')) return heads.filter((row) => row.swapId === params[2]);
    return active;
  }
  if (has('SELECT id,name,symbol FROM accounting_instruments'))
    return state.instruments.filter((item) => (params[1] as string[]).includes(item.id));
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
  Object.entries({ owner, account, btc, eth, trade, swapA, swapB, request, earlier }).map(
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

type Input = Parameters<AssetSwapService['mutateWithin']>[4];

async function mutate(
  state: World,
  kind: 'create' | 'correct' | 'void',
  input: Input,
  target?: string,
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return answer(state, sql, params);
    },
    queryRunner: { isTransactionActive: true },
  } as unknown as EntityManager;
  const service = new AssetSwapService({} as DataSource);
  const trace = () => calls.map(({ sql, params }) => `${label(sql)} ${JSON.stringify(params)}`);
  try {
    const value = await service.mutateWithin(manager, owner, account, kind, input, target);
    return normalize({ trace: trace(), value });
  } catch (error) {
    return normalize({ trace: trace(), error: describeError(error) });
  }
}

const fields = {
  assertExecuted: true,
  outgoingInstrumentId: btc,
  incomingInstrumentId: eth,
  occurredAt: '2026-02-02T10:00:00.000Z',
  orderWithinTimestamp: 0,
  outgoingQuantity: '1',
  incomingQuantity: '30',
  considerationUsd: '50',
  feeSource: null,
  feeInstrumentId: null,
  feeQuantity: '0',
};
const create = (over: Record<string, unknown> = {}) =>
  parseSwapCreate({ requestId: request, expectedJournalRevision: 1, ...fields, ...over });
const correct = (over: Record<string, unknown> = {}) =>
  parseSwapCorrection({
    requestId: request,
    expectedJournalRevision: 2,
    expectedVersion: 1,
    ...fields,
    ...over,
  });
const voiding = (over: Record<string, unknown> = {}) =>
  parseSwapVoid({ requestId: request, expectedJournalRevision: 2, expectedVersion: 1, ...over });
/** A journal with one saved swap. */
const withSwap = (over: Partial<World> = {}) =>
  world({ journal: journal({ currentRevision: 2 }), swaps: [stored()], ...over });

describe('AssetSwapService.mutateWithin characterization', () => {
  it('creates a swap without a fee', async () => {
    expect(await mutate(world(), 'create', create())).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swaps(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #44600e43 ["new-1","owner","account"]",
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"assertExecuted\\":true,\\"outgoingInstrumentId\\":\\"btc\\",\\"incomingInstrumentId\\":\\"eth\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"outgoingQuantity\\":\\"1\\",\\"incomingQuantity\\":\\"30\\",\\"considerationUsd\\":\\"50\\",\\"feeSource\\":null,\\"feeInstrumentId\\":null,\\"feeQuantity\\":\\"0\\"}","create","btc","eth","2026-02-02T10:00:00.000Z",0,"1","30","50",null,null,"0"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "1",
        "requestId": "request",
        "swapId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('creates a swap with a fee paid from held coins', async () => {
    const input = create({ feeSource: 'held', feeInstrumentId: btc, feeQuantity: '0.01' });
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swaps(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #44600e43 ["new-1","owner","account"]",
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"assertExecuted\\":true,\\"outgoingInstrumentId\\":\\"btc\\",\\"incomingInstrumentId\\":\\"eth\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"outgoingQuantity\\":\\"1\\",\\"incomingQuantity\\":\\"30\\",\\"considerationUsd\\":\\"50\\",\\"feeSource\\":\\"held\\",\\"feeInstrumentId\\":\\"btc\\",\\"feeQuantity\\":\\"0.01\\"}","create","btc","eth","2026-02-02T10:00:00.000Z",0,"1","30","50","held","btc","0.01"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": "btc",
        "feeInstrumentName": "Bitcoin",
        "feeInstrumentSymbol": "BTC",
        "feeQuantity": "0.01",
        "feeSource": "held",
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "1",
        "requestId": "request",
        "swapId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('places a chain swap after every event at its instant', async () => {
    const input = {
      ...create({ occurredAt: '2026-02-01T10:00:00.000Z' }),
      orderWithinTimestamp: null,
    };
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swaps(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #44600e43 ["new-1","owner","account"]",
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"assertExecuted\\":true,\\"outgoingInstrumentId\\":\\"btc\\",\\"incomingInstrumentId\\":\\"eth\\",\\"occurredAt\\":\\"2026-02-01T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"outgoingQuantity\\":\\"1\\",\\"incomingQuantity\\":\\"30\\",\\"considerationUsd\\":\\"50\\",\\"feeSource\\":null,\\"feeInstrumentId\\":null,\\"feeQuantity\\":\\"0\\"}","create","btc","eth","2026-02-01T10:00:00.000Z",1,"1","30","50",null,null,"0"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 1,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "1",
        "requestId": "request",
        "swapId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('refuses an automatic order past the integer bound', async () => {
    const state = world({ trades: [bought({ orderWithinTimestamp: 2147483647 })] });
    const input = {
      ...create({ occurredAt: '2026-02-01T10:00:00.000Z' }),
      orderWithinTimestamp: null,
    };
    expect(await mutate(state, 'create', input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
  });

  it('replays a request with the same payload and refuses one with another', async () => {
    const payload = swapPayload('create', create());
    const replay = stored({ requestId: request, canonicalPayload: payload });
    expect(await mutate(withSwap({ swaps: [replay] }), 'create', create())).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
  ],
  "value": {
    "created": false,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "1",
        "requestId": "request",
        "swapId": "swapA",
        "version": 1,
      },
    },
  },
}
`);
    const other = stored({ requestId: request, canonicalPayload: '{}' });
    expect(await mutate(withSwap({ swaps: [other] }), 'create', create())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
  ],
}
`);
  });

  it('refuses a payload that does not fit the kind before taking the lock', async () => {
    expect(await mutate(world(), 'void', voiding())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "BadRequestException",
    "response": {
      "error": "Bad Request",
      "message": "Invalid accounting input",
      "statusCode": 400,
    },
    "status": 400,
  },
  "trace": [],
}
`);
  });

  it('refuses an account the owner does not hold', async () => {
    expect(await mutate(world({ account: undefined }), 'create', create())).toMatchInlineSnapshot(`
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
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
  ],
}
`);
  });

  it('refuses a correction of a swap the account does not have', async () => {
    expect(await mutate(withSwap(), 'correct', correct(), swapB)).toMatchInlineSnapshot(`
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
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapB"]",
  ],
}
`);
  });

  it('refuses a stale version and a voided swap', async () => {
    expect(
      await mutate(withSwap(), 'correct', correct({ expectedVersion: 2 }), swapA),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
  ],
}
`);
    const voided = withSwap({ swaps: [stored(), stored({ version: 2, kind: 'void' })] });
    expect(
      await mutate(voided, 'correct', correct({ expectedVersion: 2 }), swapA),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
  ],
}
`);
  });

  it('refuses an instrument the owner does not have', async () => {
    const state = world({ instruments: [{ id: btc, name: 'Bitcoin', symbol: 'BTC' }] });
    expect(await mutate(state, 'create', create())).toMatchInlineSnapshot(`
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
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
  ],
}
`);
  });

  it('refuses a swap past the owner or account limits', async () => {
    expect(
      await mutate(world({ ownerCounts: { versions: 10000, active: 0 } }), 'create', create()),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
  ],
}
`);
    expect(
      await mutate(world({ accountCounts: { versions: 0, active: 1000 } }), 'create', create()),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
  ],
}
`);
    expect(
      await mutate(
        withSwap({ accountCounts: { versions: 1, active: 1000 } }),
        'correct',
        correct({ outgoingQuantity: '0.5' }),
        swapA,
      ),
    ).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","swapA",2,3,"request","{\\"kind\\":\\"correct\\",\\"swapId\\":\\"swapA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2,\\"assertExecuted\\":true,\\"outgoingInstrumentId\\":\\"btc\\",\\"incomingInstrumentId\\":\\"eth\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"outgoingQuantity\\":\\"0.5\\",\\"incomingQuantity\\":\\"30\\",\\"considerationUsd\\":\\"50\\",\\"feeSource\\":null,\\"feeInstrumentId\\":null,\\"feeQuantity\\":\\"0\\"}","correct","btc","eth","2026-02-02T10:00:00.000Z",0,"0.5","30","50",null,null,"0"]",
    "UPDATE account_swaps SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=… #1a04fca7 ["owner","account","swapA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 3,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "0.5",
        "requestId": "request",
        "swapId": "swapA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('refuses a stale journal revision', async () => {
    expect(
      await mutate(world(), 'create', create({ expectedJournalRevision: 3 })),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Swap request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
  });

  it('refuses a swap dated before the journal starts but voids one', async () => {
    const late = journal({ coverageFrom: new Date('2026-02-02T12:00:00.000Z') });
    expect(await mutate(world({ journal: late }), 'create', create())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "coverage": {
        "accountId": "account",
        "coverageFrom": "2026-02-02T12:00:00.000Z",
      },
      "error": "Conflict",
      "message": "The records of an account start after this entry",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
    const state = withSwap({ journal: journal({ ...late, currentRevision: 2 }) });
    expect(await mutate(state, 'void', voiding(), swapA)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "FifoHistoryError",
    "message": "Invalid trade history",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
  });

  it('refuses a swap on a full journal', async () => {
    const state = world({ journal: journal({ currentRevision: 10000 }) });
    expect(
      await mutate(state, 'create', create({ expectedJournalRevision: 10000 })),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "OwnedTransferCapacityError",
    "message": "Invalid trade history",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
  });

  it('corrects a swap', async () => {
    const input = correct({ outgoingQuantity: '0.5' });
    expect(await mutate(withSwap(), 'correct', input, swapA)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","swapA",2,3,"request","{\\"kind\\":\\"correct\\",\\"swapId\\":\\"swapA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2,\\"assertExecuted\\":true,\\"outgoingInstrumentId\\":\\"btc\\",\\"incomingInstrumentId\\":\\"eth\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"outgoingQuantity\\":\\"0.5\\",\\"incomingQuantity\\":\\"30\\",\\"considerationUsd\\":\\"50\\",\\"feeSource\\":null,\\"feeInstrumentId\\":null,\\"feeQuantity\\":\\"0\\"}","correct","btc","eth","2026-02-02T10:00:00.000Z",0,"0.5","30","50",null,null,"0"]",
    "UPDATE account_swaps SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=… #1a04fca7 ["owner","account","swapA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 3,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "0.5",
        "requestId": "request",
        "swapId": "swapA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('voids a swap', async () => {
    expect(await mutate(withSwap(), 'void', voiding(), swapA)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "swapVersionSelect swapHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."swapId"=$3 #f3582893 ["owner","account","swapA"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
    "INSERT INTO account_swap_versions ("ownerId","accountId","swapId",version,"journalRevision… #5994b221 ["owner","account","swapA",2,3,"request","{\\"kind\\":\\"void\\",\\"swapId\\":\\"swapA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2}","void","btc","eth","2026-02-02T10:00:00.000Z",0,"1","30","50",null,null,"0"]",
    "UPDATE account_swaps SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=… #1a04fca7 ["owner","account","swapA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "swap": {
        "accountId": "account",
        "considerationUsd": "50",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "feeSource": null,
        "incomingInstrumentId": "eth",
        "incomingInstrumentName": "Ether",
        "incomingInstrumentSymbol": "ETH",
        "incomingQuantity": "30",
        "journalRevision": 3,
        "kind": "void",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "outgoingInstrumentId": "btc",
        "outgoingInstrumentName": "Bitcoin",
        "outgoingInstrumentSymbol": "BTC",
        "outgoingQuantity": "1",
        "requestId": "request",
        "swapId": "swapA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('refuses a swap of more than the account holds', async () => {
    const input = create({ outgoingQuantity: '5' });
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "FifoHistoryError",
    "message": "Invalid trade history",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "swapVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #f1773218 ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT id,name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=ANY($2::uuid[]… #f7661306 ["owner",["btc","eth"]]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 #9cfe7719 ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #ee5919f5 ["owner"]",
    "SELECT count(*)::int AS count FROM account_swap_versions v WHERE v."ownerId"=$1 AND v."acc… #5c3bc994 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #c920cc36 ["owner","account"]",
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
  ],
}
`);
  });
});

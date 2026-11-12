import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AssetRewardService } from './asset-reward.service';
import { type RewardVersionRow, rewardHeadJoin, rewardVersionSelect } from './asset-reward.store';
import {
  parseRewardCorrection,
  parseRewardCreate,
  parseRewardVoid,
  type RewardCreateInput,
  rewardPayload,
} from './asset-reward-input';
import { swapHeadJoin, swapVersionSelect } from './asset-swap.store';
import { capitalReturnHeadJoin, capitalReturnVersionSelect } from './capital-return.store';
import { transferVersionSelect } from './owned-transfer.store';
import { type JournalRow, type VersionRow, versionSelect } from './trade-journal.store';

// Characterization of AssetRewardService.mutateWithin against a recording fake manager: every
// statement (a short label, a hash of its full text and its parameters) in order, and the
// result or the error. Synthetic identifiers only.
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-0000000000a1';
const btc = '00000000-0000-4000-8000-0000000000b1';
const trade = '00000000-0000-4000-8000-0000000000c1';
const rewardA = '00000000-0000-4000-8000-0000000000e1';
const rewardB = '00000000-0000-4000-8000-0000000000e2';
const request = '00000000-0000-4000-8000-0000000000d1';
const earlier = '00000000-0000-4000-8000-0000000000d0';
const createdAt = new Date('2026-03-01T00:00:00.000Z');

interface Counts {
  versions: number;
  active: number;
}
interface World {
  account?: { id: string; currentRevision: number | null };
  journal?: JournalRow;
  opening?: boolean;
  trades: VersionRow[];
  rewards: RewardVersionRow[];
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

/** Two bitcoin bought before the rewards. */
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

function stored(over: Partial<RewardVersionRow> = {}): RewardVersionRow {
  return {
    accountId: account,
    rewardId: rewardA,
    version: 1,
    journalRevision: 2,
    requestId: earlier,
    kind: 'create',
    createdAt,
    instrumentId: btc,
    instrumentName: 'Bitcoin',
    instrumentSymbol: 'BTC',
    category: 'staking',
    occurredAt: new Date('2026-02-02T10:00:00.000Z'),
    orderWithinTimestamp: 0,
    quantity: '0.1',
    acquisitionBasisUsd: '5',
    incomeValueUsd: '5',
    canonicalPayload: '{}',
    ...over,
  };
}

function world(over: Partial<World> = {}): World {
  return {
    account: { id: account, currentRevision: null },
    journal: journal(),
    trades: [bought()],
    rewards: [],
    instruments: [{ id: btc, name: 'Bitcoin', symbol: 'BTC' }],
    ...over,
  };
}

function answer(state: World, sql: string, params: unknown[]): unknown[] {
  const has = (part: string) => sql.includes(part);
  const heads = state.rewards.filter(
    (row) =>
      !state.rewards.some(
        (other) => other.rewardId === row.rewardId && other.version > row.version,
      ),
  );
  const active = heads.filter((row) => row.kind !== 'void');
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
  if (has('FROM owned_transfers t')) return [];
  if (has('FROM instrument_splits')) return [];
  if (has('count(*)::int AS count FROM account_trades t'))
    return state.trades.length ? [{ accountId: account, count: state.trades.length }] : [];
  if (has('FROM account_trade_versions v'))
    return state.trades.map((row) => ({ ...row, accountId: account }));
  if (has('account_swap_versions')) return [];
  if (has('FROM account_capital_return_versions')) return [];
  if (has('count(*)::int AS count FROM account_reward_versions v WHERE')) {
    const counts = params.length === 1 ? state.ownerCounts : state.accountCounts;
    return [{ count: counts?.versions ?? state.rewards.length }];
  }
  if (has('count(*)::int AS count,count(*) FILTER')) {
    const counts = params.length === 1 ? state.ownerCounts : state.accountCounts;
    return [{ count: heads.length, active: counts?.active ?? active.length }];
  }
  if (has('SELECT v."accountId",count(*) FILTER'))
    return active.length ? [{ accountId: account, active: active.length }] : [];
  if (has('INSERT INTO account_reward_versions')) {
    const keys = ['ownerId', 'accountId', 'rewardId', 'version', 'journalRevision', 'requestId'];
    const rest = ['canonicalPayload', 'kind', 'instrumentId', 'category', 'occurredAt'];
    const tail = ['orderWithinTimestamp', 'quantity', 'acquisitionBasisUsd', 'incomeValueUsd'];
    const row = Object.fromEntries(
      [...keys, ...rest, ...tail].map((key, index) => [key, params[index]]),
    );
    return [{ ...row, occurredAt: new Date(row.occurredAt as string), createdAt }];
  }
  if (has('FROM account_reward_versions v')) {
    if (has('v."requestId"=$3')) return state.rewards.filter((row) => row.requestId === params[2]);
    if (has('v."rewardId"=$3')) return heads.filter((row) => row.rewardId === params[2]);
    return active;
  }
  if (has('SELECT name,symbol FROM accounting_instruments'))
    return state.instruments.filter((item) => item.id === params[1]);
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
  Object.entries({ owner, account, btc, trade, rewardA, rewardB, request, earlier }).map(
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

type Input = Parameters<AssetRewardService['mutateWithin']>[4];

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
  const service = new AssetRewardService({} as DataSource);
  const trace = () => calls.map(({ sql, params }) => `${label(sql)} ${JSON.stringify(params)}`);
  try {
    const value = await service.mutateWithin(manager, owner, account, kind, input, target);
    return normalize({ trace: trace(), value });
  } catch (error) {
    return normalize({ trace: trace(), error: describeError(error) });
  }
}

const fields = {
  assertReward: true,
  instrumentId: btc,
  category: 'staking',
  occurredAt: '2026-02-02T10:00:00.000Z',
  quantity: '0.1',
  acquisitionBasisUsd: '5',
  incomeValueUsd: '5',
};
const create = (over: Record<string, unknown> = {}) =>
  parseRewardCreate({ requestId: request, expectedJournalRevision: 1, ...fields, ...over });
const correct = (over: Record<string, unknown> = {}) =>
  parseRewardCorrection({
    requestId: request,
    expectedJournalRevision: 2,
    expectedVersion: 1,
    ...fields,
    orderWithinTimestamp: 0,
    ...over,
  });
const voiding = (over: Record<string, unknown> = {}) =>
  parseRewardVoid({ requestId: request, expectedJournalRevision: 2, expectedVersion: 1, ...over });
/** A journal with one saved reward. */
const withReward = (over: Partial<World> = {}) =>
  world({ journal: journal({ currentRevision: 2 }), rewards: [stored()], ...over });

describe('AssetRewardService.mutateWithin characterization', () => {
  it('creates a reward after every event at its instant', async () => {
    const input = create({ occurredAt: '2026-02-01T10:00:00.000Z' });
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #11f3c5a7 ["new-1","owner","account"]",
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"assertReward\\":true,\\"instrumentId\\":\\"btc\\",\\"category\\":\\"staking\\",\\"occurredAt\\":\\"2026-02-01T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"0.1\\",\\"acquisitionBasisUsd\\":\\"5\\",\\"incomeValueUsd\\":\\"5\\"}","create","btc","staking","2026-02-01T10:00:00.000Z",1,"0.1","5","5"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 1,
        "quantity": "0.1",
        "requestId": "request",
        "rewardId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('keeps a given order and refuses an automatic one past the integer bound', async () => {
    const given = create({ occurredAt: '2026-02-01T10:00:00.000Z', orderWithinTimestamp: 5 });
    expect(await mutate(world(), 'create', given)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #11f3c5a7 ["new-1","owner","account"]",
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","new-1",1,2,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":1,\\"assertReward\\":true,\\"instrumentId\\":\\"btc\\",\\"category\\":\\"staking\\",\\"occurredAt\\":\\"2026-02-01T10:00:00.000Z\\",\\"orderWithinTimestamp\\":5,\\"quantity\\":\\"0.1\\",\\"acquisitionBasisUsd\\":\\"5\\",\\"incomeValueUsd\\":\\"5\\"}","create","btc","staking","2026-02-01T10:00:00.000Z",5,"0.1","5","5"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",2]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-01T10:00:00.000Z",
        "orderWithinTimestamp": 5,
        "quantity": "0.1",
        "requestId": "request",
        "rewardId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
    const state = world({ trades: [bought({ orderWithinTimestamp: 2147483647 })] });
    const input = create({ occurredAt: '2026-02-01T10:00:00.000Z' });
    expect(await mutate(state, 'create', input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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

  it('starts the journal with the first reward of an account', async () => {
    const state = world({ journal: undefined, trades: [] });
    const input = create({ expectedJournalRevision: 0 });
    expect(await mutate(state, 'create', input)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$… #4e41e910 ["owner","account"]",
    "INSERT INTO account_trade_journals ("ownerId","accountId","requestId","canonicalPayload","… #72eec9ba ["owner","account","request","{\\"coverageFrom\\":\\"1970-01-01T00:00:00.000Z\\",\\"assertEmpty\\":true}","1970-01-01T00:00:00.000Z"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1) #11f3c5a7 ["new-1","owner","account"]",
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","new-1",1,1,"request","{\\"kind\\":\\"create\\",\\"expectedJournalRevision\\":0,\\"assertReward\\":true,\\"instrumentId\\":\\"btc\\",\\"category\\":\\"staking\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":null,\\"quantity\\":\\"0.1\\",\\"acquisitionBasisUsd\\":\\"5\\",\\"incomeValueUsd\\":\\"5\\"}","create","btc","staking","2026-02-02T10:00:00.000Z",0,"0.1","5","5"]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",1]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 1,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 1,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.1",
        "requestId": "request",
        "rewardId": "new-1",
        "version": 1,
      },
    },
  },
}
`);
  });

  it('starts no journal where one exists or the account was opened with balances', async () => {
    const input = create({ expectedJournalRevision: 0 });
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2 #a30930fa ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    const opened = world({
      journal: undefined,
      trades: [],
      account: { id: account, currentRevision: 3 },
    });
    expect(await mutate(opened, 'create', input)).toMatchInlineSnapshot(`
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "transferVersionSelect WHERE v."ownerId"=$1 AND v.version=t."currentVersion" AND v.kind<>'v… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR U… #608265bd ["owner",["account"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=ANY($2::uuid[]) OR… #21bccb93 ["owner",["account"]]",
  ],
}
`);
  });

  it('replays a request with the same payload and refuses one with another', async () => {
    const replay = stored({
      requestId: request,
      canonicalPayload: rewardPayload('create', create()),
    });
    expect(
      await mutate(withReward({ rewards: [replay] }), 'create', create()),
    ).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
  ],
  "value": {
    "created": false,
    "value": {
      "accountId": "account",
      "journalRevision": 2,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 2,
        "kind": "create",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.1",
        "requestId": "request",
        "rewardId": "rewardA",
        "version": 1,
      },
    },
  },
}
`);
    const other = stored({ requestId: request, canonicalPayload: '{}' });
    expect(
      await mutate(withReward({ rewards: [other] }), 'create', create()),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
  ],
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
  ],
}
`);
  });

  it('refuses a correction of a reward the account does not have', async () => {
    expect(await mutate(withReward(), 'correct', correct(), rewardB)).toMatchInlineSnapshot(`
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardB"]",
  ],
}
`);
  });

  it('refuses a stale version, a voided reward and a void without a target', async () => {
    expect(
      await mutate(withReward(), 'correct', correct({ expectedVersion: 2 }), rewardA),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
  ],
}
`);
    const voided = withReward({ rewards: [stored(), stored({ version: 2, kind: 'void' })] });
    expect(
      await mutate(voided, 'correct', correct({ expectedVersion: 2 }), rewardA),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
  ],
}
`);
    expect(await mutate(withReward(), 'void', voiding())).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
  ],
}
`);
  });

  it('fails a create without fields', async () => {
    const input = { requestId: request, expectedJournalRevision: 1 } as RewardCreateInput;
    expect(await mutate(world(), 'create', input)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "Error",
    "message": "Reward fields required",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
  ],
}
`);
  });

  it('refuses an instrument the owner does not have', async () => {
    expect(await mutate(world({ instruments: [] }), 'create', create())).toMatchInlineSnapshot(`
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
  ],
}
`);
  });

  it('refuses a reward past the owner or account limits', async () => {
    expect(
      await mutate(world({ ownerCounts: { versions: 10000, active: 0 } }), 'create', create()),
    ).toMatchInlineSnapshot(`
{
  "error": {
    "class": "ConflictException",
    "response": {
      "error": "Conflict",
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
  ],
}
`);
    expect(
      await mutate(
        withReward({ accountCounts: { versions: 1, active: 1000 } }),
        'correct',
        correct({ quantity: '0.2' }),
        rewardA,
      ),
    ).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","rewardA",2,3,"request","{\\"kind\\":\\"correct\\",\\"rewardId\\":\\"rewardA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2,\\"assertReward\\":true,\\"instrumentId\\":\\"btc\\",\\"category\\":\\"staking\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"quantity\\":\\"0.2\\",\\"acquisitionBasisUsd\\":\\"5\\",\\"incomeValueUsd\\":\\"5\\"}","correct","btc","staking","2026-02-02T10:00:00.000Z",0,"0.2","5","5"]",
    "UPDATE account_rewards SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND i… #b1b09e86 ["owner","account","rewardA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 3,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.2",
        "requestId": "request",
        "rewardId": "rewardA",
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
      "message": "Reward request conflicts with saved state",
      "statusCode": 409,
    },
    "status": 409,
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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

  it('refuses a reward dated before the journal starts but voids one', async () => {
    const late = journal({ coverageFrom: new Date('2026-02-02T12:00:00.000Z') });
    expect(
      await mutate(world({ journal: late, trades: [] }), 'create', create()),
    ).toMatchInlineSnapshot(`
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    const state = withReward({ journal: journal({ ...late, currentRevision: 2 }), trades: [] });
    expect(await mutate(state, 'void', voiding(), rewardA)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "FifoHistoryError",
    "message": "Invalid trade history",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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

  it('refuses a reward on a full journal', async () => {
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
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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

  it('corrects a reward', async () => {
    const input = correct({ quantity: '0.2' });
    expect(await mutate(withReward(), 'correct', input, rewardA)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","rewardA",2,3,"request","{\\"kind\\":\\"correct\\",\\"rewardId\\":\\"rewardA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2,\\"assertReward\\":true,\\"instrumentId\\":\\"btc\\",\\"category\\":\\"staking\\",\\"occurredAt\\":\\"2026-02-02T10:00:00.000Z\\",\\"orderWithinTimestamp\\":0,\\"quantity\\":\\"0.2\\",\\"acquisitionBasisUsd\\":\\"5\\",\\"incomeValueUsd\\":\\"5\\"}","correct","btc","staking","2026-02-02T10:00:00.000Z",0,"0.2","5","5"]",
    "UPDATE account_rewards SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND i… #b1b09e86 ["owner","account","rewardA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 3,
        "kind": "correct",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.2",
        "requestId": "request",
        "rewardId": "rewardA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('voids a reward', async () => {
    expect(await mutate(withReward(), 'void', voiding(), rewardA)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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
    "INSERT INTO account_reward_versions ("ownerId","accountId","rewardId",version,"journalRevi… #b1e32c6a ["owner","account","rewardA",2,3,"request","{\\"kind\\":\\"void\\",\\"rewardId\\":\\"rewardA\\",\\"expectedVersion\\":1,\\"expectedJournalRevision\\":2}","void","btc","staking","2026-02-02T10:00:00.000Z",0,"0.1","5","5"]",
    "UPDATE account_rewards SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND i… #b1b09e86 ["owner","account","rewardA",2]",
    "UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=… #65938338 ["owner","account",3]",
  ],
  "value": {
    "created": true,
    "value": {
      "accountId": "account",
      "journalRevision": 3,
      "reward": {
        "accountId": "account",
        "acquisitionBasisUsd": "5",
        "category": "staking",
        "createdAt": "2026-03-01T00:00:00.000Z",
        "incomeValueUsd": "5",
        "instrumentId": "btc",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 3,
        "kind": "void",
        "occurredAt": "2026-02-02T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.1",
        "requestId": "request",
        "rewardId": "rewardA",
        "version": 2,
      },
    },
  },
}
`);
  });

  it('refuses a void that a later sale depends on', async () => {
    const sale = bought({
      side: 'sell',
      occurredAt: new Date('2026-02-03T10:00:00.000Z'),
      quantity: '0.05',
      grossUsd: '3',
      feeUsd: '0',
    });
    const state = withReward({ trades: [sale] });
    expect(await mutate(state, 'void', voiding(), rewardA)).toMatchInlineSnapshot(`
{
  "error": {
    "class": "FifoHistoryError",
    "message": "Invalid trade history",
  },
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $1::text, 0)) #44b4aa8e ["owner"]",
    "rewardVersionSelect WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3 #9288cdeb ["owner","account","request"]",
    "SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2 AND to_jsonb… #36a3ab8e ["owner","account"]",
    "rewardVersionSelect rewardHeadJoin WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."reward… #7baf6be0 ["owner","account","rewardA"]",
    "SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2 #16a67b43 ["owner","btc"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 #5af5344a ["owner"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #927dc19e ["owner"]",
    "SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1 AND v."a… #b81895b2 ["owner","account"]",
    "SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active FROM ac… #18f74ecd ["owner","account"]",
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

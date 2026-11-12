import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { readConnectedLedger, readConnectedLedgers } from './connected-accounting.store';

// Characterization of the batched ledger read (readLedgers) through readConnectedLedgers and
// readConnectedLedger against a recording fake manager: the statements in order, the ledgers
// and every refusal with the statement it stopped at. Synthetic identifiers only.
const owner = '00000000-0000-4000-8000-000000000001';
const a = '00000000-0000-4000-8000-0000000000a1';
const b = '00000000-0000-4000-8000-0000000000a2';
const c = '00000000-0000-4000-8000-0000000000a3';
const btc = '00000000-0000-4000-8000-0000000000b1';
const usd = '00000000-0000-4000-8000-0000000000b2';
const createdAt = new Date('2026-03-01T00:00:00.000Z');
const coverageFrom = new Date('2026-01-01T00:00:00.000Z');

type Row = Record<string, unknown>;
interface World {
  transfers: Row[];
  journals: Row[];
  tradeCounts: Row[];
  trades: Row[];
  rewardCounts: Row[];
  rewards: Row[];
  swapCounts: Row[];
  swaps: Row[];
  returnCounts: Row[];
  returns: Row[];
  lots: Row[];
  participants: Row[];
  splits: Row[];
}

const journal = (accountId: string, over: Row = {}): Row => ({
  accountId,
  requestId: '00000000-0000-4000-8000-0000000000d0',
  canonicalPayload: '{}',
  originKind: 'declared-empty',
  openingRevision: null,
  coverageFrom,
  createdAt,
  currentRevision: 3,
  ...over,
});
const trade = (accountId: string, tradeId: string): Row => ({
  accountId,
  tradeId,
  version: 1,
  journalRevision: 1,
  requestId: '00000000-0000-4000-8000-0000000000d1',
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
});

function world(): World {
  return {
    transfers: [
      {
        transferId: '00000000-0000-4000-8000-0000000000f1',
        version: 1,
        journalRevision: 1,
        requestId: '00000000-0000-4000-8000-0000000000d2',
        canonicalPayload: '{}',
        kind: 'create',
        createdAt,
        fromAccountId: a,
        toAccountId: b,
        fromJournalRevision: 2,
        toJournalRevision: 2,
        instrumentId: btc,
        occurredAt: new Date('2026-02-03T10:00:00.000Z'),
        orderWithinTimestamp: 0,
        quantity: '0.5',
        feeInstrumentId: null,
        feeQuantity: '0',
        instrumentName: 'Bitcoin',
        instrumentSymbol: 'BTC',
        feeInstrumentName: null,
        feeInstrumentSymbol: null,
      },
    ],
    journals: [
      journal(a),
      journal(b, { originKind: 'known-cost-carry-in', openingRevision: 1 }),
      journal(c),
    ],
    tradeCounts: [
      { accountId: a, count: 1 },
      { accountId: c, count: 1 },
    ],
    trades: [
      trade(a, '00000000-0000-4000-8000-0000000000c1'),
      trade(c, '00000000-0000-4000-8000-0000000000c2'),
    ],
    rewardCounts: [{ accountId: a, active: 1 }],
    rewards: [
      {
        accountId: a,
        rewardId: '00000000-0000-4000-8000-0000000000e1',
        version: 1,
        journalRevision: 2,
        requestId: '00000000-0000-4000-8000-0000000000d3',
        kind: 'create',
        createdAt,
        instrumentId: btc,
        instrumentName: 'Bitcoin',
        instrumentSymbol: 'BTC',
        category: 'staking',
        occurredAt: new Date('2026-02-02T10:00:00.000Z'),
        orderWithinTimestamp: 0,
        quantity: '0.1',
        acquisitionBasisUsd: null,
        incomeValueUsd: '5',
        canonicalPayload: '{}',
      },
    ],
    swapCounts: [{ accountId: c, active: 0 }],
    swaps: [],
    returnCounts: [{ accountId: b, active: 1 }],
    returns: [
      {
        accountId: b,
        capitalReturnId: '00000000-0000-4000-8000-0000000000e3',
        version: 1,
        journalRevision: 3,
        requestId: '00000000-0000-4000-8000-0000000000d4',
        kind: 'create',
        createdAt,
        instrumentId: btc,
        instrumentName: 'Bitcoin',
        instrumentSymbol: 'BTC',
        cashInstrumentId: usd,
        cashInstrumentName: 'US dollar',
        cashInstrumentSymbol: 'USD',
        occurredAt: new Date('2026-02-04T10:00:00.000Z'),
        orderWithinTimestamp: 0,
        amount: '1',
        amountUsd: '1',
        paidCurrency: null,
        rateDate: null,
        perUsd: null,
        rateSource: null,
        canonicalPayload: '{}',
      },
    ],
    lots: [
      {
        accountId: b,
        lotId: '00000000-0000-4000-8000-0000000000f2',
        openingRevision: 1,
        ordinal: 1,
        instrumentId: btc,
        instrumentName: 'Bitcoin',
        instrumentSymbol: 'BTC',
        acquiredAt: new Date('2025-12-01T00:00:00.000Z'),
        orderWithinTimestamp: 0,
        originalQuantity: '1',
        originalCostUsd: '10',
        carriedQuantity: '1',
      },
    ],
    participants: [{ id: a }, { id: b }],
    splits: [
      {
        id: '00000000-0000-4000-8000-0000000000f3',
        instrumentId: btc,
        effectiveAt: new Date('2026-02-05T00:00:00.000Z'),
        ratio: 2,
      },
    ],
  };
}

function answer(state: World, sql: string, params: unknown[]): unknown[] {
  const has = (part: string) => sql.includes(part);
  const ids = (params[1] ?? []) as string[];
  const within = (rows: Row[]) => rows.filter((row) => ids.includes(row.accountId as string));
  if (has('pg_advisory_xact_lock')) return [];
  if (has('FROM owned_transfer_versions')) return state.transfers;
  if (has('SELECT id FROM manual_accounts')) return ids.map((id) => ({ id }));
  if (has('FROM account_trade_journals')) return within(state.journals);
  if (has('count(*)::int AS count FROM account_trades t')) return state.tradeCounts;
  if (has('FROM account_trade_versions v')) return state.trades;
  if (has('FROM account_reward_versions'))
    return has('GROUP BY') ? state.rewardCounts : state.rewards;
  if (has('FROM account_swap_versions')) return has('GROUP BY') ? state.swapCounts : state.swaps;
  if (has('FROM account_capital_return_versions'))
    return has('GROUP BY') ? state.returnCounts : state.returns;
  if (has('FROM account_carry_in_lots')) return state.lots;
  if (has('FROM owned_transfers t')) return state.participants;
  if (has('FROM instrument_splits')) return state.splits;
  return [];
}

const names = new Map(Object.entries({ owner, a, b, c, btc, usd }).map(([n, id]) => [id, n]));
const short = (text: string) =>
  text.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (id) => names.get(id) ?? `…${id.slice(-2)}`,
  );
/** A readable start of the statement, a hash of its exact text, and its parameters. */
function line(sql: string, params: unknown[]): string {
  const text = sql.replace(/\s+/g, ' ').trim();
  const hash = createHash('sha256').update(sql).digest('hex').slice(0, 8);
  return short(`${text.slice(0, 70)}… #${hash} ${JSON.stringify(params)}`);
}

async function read(state: World, work: (manager: EntityManager) => Promise<unknown>) {
  const trace: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      trace.push(line(sql, params));
      return answer(state, sql, params);
    },
    queryRunner: { isTransactionActive: true },
  } as unknown as EntityManager;
  try {
    return { trace, value: await work(manager) };
  } catch (error) {
    return {
      trace,
      error: `${(error as Error).constructor.name}: ${(error as Error).message}`,
      response: (error as { response?: unknown }).response,
    };
  }
}

const both = (manager: EntityManager) => readConnectedLedgers(manager, owner, [c, a]);

describe('readLedgers characterization', () => {
  it('reads every component of the seeds with one query per table', async () => {
    expect(await read(world(), both)).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT v.*,t."fromAccountId",t."toAccountId", i.name AS "instrumentNam… #3f35fea0 ["owner"]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId… #21bccb93 ["owner",["c","a","b"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN… #e2ff6b80 ["owner",["c","a","b"]]",
    "SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrumentSymbol"… #554b7dea ["owner",["c","a","b"],20002]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #6253c38d ["owner",["c","a","b"]]",
    "SELECT v.*,i.name AS "instrumentName",i.symbol AS "instrumentSymbol" F… #017d693f ["owner",["c","a","b"],2002]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #2e3ca39a ["owner",["c","a","b"]]",
    "SELECT v.*,o.name AS "outgoingInstrumentName",o.symbol AS "outgoingIns… #3d3a610c ["owner",["c","a","b"],2002]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #28fc5887 ["owner",["c","a","b"]]",
    "SELECT v.*,v."rateDate"::text AS "rateDate", i.name AS "instrumentName… #4ce3a23d ["owner",["c","a","b"],2002]",
    "SELECT "accountId","lotId","openingRevision",ordinal,"instrumentId","i… #dad1ed3e ["owner",["b"],[1]]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATER… #09752f90 ["owner",["c","a","b"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits… #c5952854 ["owner",1001]",
  ],
  "value": [
    {
      "accounts": Map {
        "00000000-0000-4000-8000-0000000000a3" => {
          "accountId": "00000000-0000-4000-8000-0000000000a3",
          "capitalReturns": [],
          "coverageFrom": "2026-01-01T00:00:00.000Z",
          "initialLots": [],
          "journal": {
            "accountId": "00000000-0000-4000-8000-0000000000a3",
            "canonicalPayload": "{}",
            "coverageFrom": 2026-01-01T00:00:00.000Z,
            "createdAt": 2026-03-01T00:00:00.000Z,
            "currentRevision": 3,
            "openingRevision": null,
            "originKind": "declared-empty",
            "requestId": "00000000-0000-4000-8000-0000000000d0",
          },
          "rewards": [],
          "swaps": [],
          "trades": [
            {
              "createdAt": "2026-03-01T00:00:00.000Z",
              "feeUsd": "1",
              "grossUsd": "100",
              "instrumentId": "00000000-0000-4000-8000-0000000000b1",
              "instrumentName": "Bitcoin",
              "instrumentSymbol": "BTC",
              "journalRevision": 1,
              "kind": "create",
              "occurredAt": "2026-02-01T10:00:00.000Z",
              "orderWithinTimestamp": 0,
              "quantity": "2",
              "requestId": "00000000-0000-4000-8000-0000000000d1",
              "side": "buy",
              "tradeId": "00000000-0000-4000-8000-0000000000c2",
              "version": 1,
            },
          ],
        },
      },
      "capitalReturnParticipants": Set {},
      "participants": Set {},
      "rewardParticipants": Set {},
      "splits": [
        {
          "effectiveAt": "2026-02-05T00:00:00.000Z",
          "instrumentId": "00000000-0000-4000-8000-0000000000b1",
          "ratio": 2,
          "splitId": "00000000-0000-4000-8000-0000000000f3",
        },
      ],
      "swapParticipants": Set {
        "00000000-0000-4000-8000-0000000000a3",
      },
      "transfers": [],
    },
    {
      "accounts": Map {
        "00000000-0000-4000-8000-0000000000a1" => {
          "accountId": "00000000-0000-4000-8000-0000000000a1",
          "capitalReturns": [],
          "coverageFrom": "2026-01-01T00:00:00.000Z",
          "initialLots": [],
          "journal": {
            "accountId": "00000000-0000-4000-8000-0000000000a1",
            "canonicalPayload": "{}",
            "coverageFrom": 2026-01-01T00:00:00.000Z,
            "createdAt": 2026-03-01T00:00:00.000Z,
            "currentRevision": 3,
            "openingRevision": null,
            "originKind": "declared-empty",
            "requestId": "00000000-0000-4000-8000-0000000000d0",
          },
          "rewards": [
            {
              "accountId": "00000000-0000-4000-8000-0000000000a1",
              "acquisitionBasisUsd": null,
              "category": "staking",
              "createdAt": "2026-03-01T00:00:00.000Z",
              "incomeValueUsd": "5",
              "instrumentId": "00000000-0000-4000-8000-0000000000b1",
              "instrumentName": "Bitcoin",
              "instrumentSymbol": "BTC",
              "journalRevision": 2,
              "kind": "create",
              "occurredAt": "2026-02-02T10:00:00.000Z",
              "orderWithinTimestamp": 0,
              "quantity": "0.1",
              "requestId": "00000000-0000-4000-8000-0000000000d3",
              "rewardId": "00000000-0000-4000-8000-0000000000e1",
              "version": 1,
            },
          ],
          "swaps": [],
          "trades": [
            {
              "createdAt": "2026-03-01T00:00:00.000Z",
              "feeUsd": "1",
              "grossUsd": "100",
              "instrumentId": "00000000-0000-4000-8000-0000000000b1",
              "instrumentName": "Bitcoin",
              "instrumentSymbol": "BTC",
              "journalRevision": 1,
              "kind": "create",
              "occurredAt": "2026-02-01T10:00:00.000Z",
              "orderWithinTimestamp": 0,
              "quantity": "2",
              "requestId": "00000000-0000-4000-8000-0000000000d1",
              "side": "buy",
              "tradeId": "00000000-0000-4000-8000-0000000000c1",
              "version": 1,
            },
          ],
        },
        "00000000-0000-4000-8000-0000000000a2" => {
          "accountId": "00000000-0000-4000-8000-0000000000a2",
          "capitalReturns": [
            {
              "accountId": "00000000-0000-4000-8000-0000000000a2",
              "amount": "1",
              "amountUsd": "1",
              "capitalReturnId": "00000000-0000-4000-8000-0000000000e3",
              "cashInstrumentId": "00000000-0000-4000-8000-0000000000b2",
              "cashInstrumentName": "US dollar",
              "cashInstrumentSymbol": "USD",
              "createdAt": "2026-03-01T00:00:00.000Z",
              "instrumentId": "00000000-0000-4000-8000-0000000000b1",
              "instrumentName": "Bitcoin",
              "instrumentSymbol": "BTC",
              "journalRevision": 3,
              "kind": "create",
              "occurredAt": "2026-02-04T10:00:00.000Z",
              "orderWithinTimestamp": 0,
              "paidCurrency": null,
              "rate": null,
              "requestId": "00000000-0000-4000-8000-0000000000d4",
              "version": 1,
            },
          ],
          "coverageFrom": "2026-01-01T00:00:00.000Z",
          "initialLots": [
            {
              "acquiredAt": "2025-12-01T00:00:00.000Z",
              "carriedQuantity": "1",
              "instrumentId": "00000000-0000-4000-8000-0000000000b1",
              "instrumentName": "Bitcoin",
              "instrumentSymbol": "BTC",
              "lotId": "00000000-0000-4000-8000-0000000000f2",
              "openingRevision": 1,
              "orderWithinTimestamp": 0,
              "ordinal": 1,
              "originalCostUsd": "10",
              "originalQuantity": "1",
            },
          ],
          "journal": {
            "accountId": "00000000-0000-4000-8000-0000000000a2",
            "canonicalPayload": "{}",
            "coverageFrom": 2026-01-01T00:00:00.000Z,
            "createdAt": 2026-03-01T00:00:00.000Z,
            "currentRevision": 3,
            "openingRevision": 1,
            "originKind": "known-cost-carry-in",
            "requestId": "00000000-0000-4000-8000-0000000000d0",
          },
          "rewards": [],
          "swaps": [],
          "trades": [],
        },
      },
      "capitalReturnParticipants": Set {
        "00000000-0000-4000-8000-0000000000a2",
      },
      "participants": Set {
        "00000000-0000-4000-8000-0000000000a1",
        "00000000-0000-4000-8000-0000000000a2",
      },
      "rewardParticipants": Set {
        "00000000-0000-4000-8000-0000000000a1",
      },
      "splits": [
        {
          "effectiveAt": "2026-02-05T00:00:00.000Z",
          "instrumentId": "00000000-0000-4000-8000-0000000000b1",
          "ratio": 2,
          "splitId": "00000000-0000-4000-8000-0000000000f3",
        },
      ],
      "swapParticipants": Set {},
      "transfers": [
        {
          "createdAt": "2026-03-01T00:00:00.000Z",
          "feeInstrumentId": null,
          "feeInstrumentName": null,
          "feeInstrumentSymbol": null,
          "feeQuantity": "0",
          "fromAccountId": "00000000-0000-4000-8000-0000000000a1",
          "fromJournalRevision": 2,
          "instrumentId": "00000000-0000-4000-8000-0000000000b1",
          "instrumentName": "Bitcoin",
          "instrumentSymbol": "BTC",
          "journalRevision": 1,
          "kind": "create",
          "occurredAt": "2026-02-03T10:00:00.000Z",
          "orderWithinTimestamp": 0,
          "quantity": "0.5",
          "requestId": "00000000-0000-4000-8000-0000000000d2",
          "toAccountId": "00000000-0000-4000-8000-0000000000a2",
          "toJournalRevision": 2,
          "transferId": "00000000-0000-4000-8000-0000000000f1",
          "version": 1,
        },
      ],
    },
  ],
}
`);
  });

  it('reads one locked component', async () => {
    const state = world();
    const result = await read(state, (manager) =>
      readConnectedLedger(manager, owner, [b], { lock: true }),
    );
    expect(result).toMatchInlineSnapshot(`
{
  "trace": [
    "SELECT pg_advisory_xact_lock(hashtextextended('accounting-owner:' || $… #44b4aa8e ["owner"]",
    "SELECT v.*,t."fromAccountId",t."toAccountId", i.name AS "instrumentNam… #3f35fea0 ["owner"]",
    "SELECT id FROM manual_accounts WHERE "ownerId"=$1 AND id=ANY($2::uuid[… #608265bd ["owner",["a","b"]]",
    "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId… #21bccb93 ["owner",["a","b"]]",
    "SELECT t."accountId",count(*)::int AS count FROM account_trades t JOIN… #e2ff6b80 ["owner",["a","b"]]",
    "SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrumentSymbol"… #554b7dea ["owner",["a","b"],10001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #6253c38d ["owner",["a","b"]]",
    "SELECT v.*,i.name AS "instrumentName",i.symbol AS "instrumentSymbol" F… #017d693f ["owner",["a","b"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #2e3ca39a ["owner",["a","b"]]",
    "SELECT v.*,o.name AS "outgoingInstrumentName",o.symbol AS "outgoingIns… #3d3a610c ["owner",["a","b"],1001]",
    "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::int AS act… #28fc5887 ["owner",["a","b"]]",
    "SELECT v.*,v."rateDate"::text AS "rateDate", i.name AS "instrumentName… #4ce3a23d ["owner",["a","b"],1001]",
    "SELECT "accountId","lotId","openingRevision",ordinal,"instrumentId","i… #dad1ed3e ["owner",["b"],[1]]",
    "SELECT DISTINCT participant.id FROM owned_transfers t CROSS JOIN LATER… #09752f90 ["owner",["a","b"]]",
    "SELECT id, "instrumentId", "effectiveAt", ratio FROM instrument_splits… #c5952854 ["owner",1001]",
  ],
  "value": {
    "accounts": Map {
      "00000000-0000-4000-8000-0000000000a1" => {
        "accountId": "00000000-0000-4000-8000-0000000000a1",
        "capitalReturns": [],
        "coverageFrom": "2026-01-01T00:00:00.000Z",
        "initialLots": [],
        "journal": {
          "accountId": "00000000-0000-4000-8000-0000000000a1",
          "canonicalPayload": "{}",
          "coverageFrom": 2026-01-01T00:00:00.000Z,
          "createdAt": 2026-03-01T00:00:00.000Z,
          "currentRevision": 3,
          "openingRevision": null,
          "originKind": "declared-empty",
          "requestId": "00000000-0000-4000-8000-0000000000d0",
        },
        "rewards": [
          {
            "accountId": "00000000-0000-4000-8000-0000000000a1",
            "acquisitionBasisUsd": null,
            "category": "staking",
            "createdAt": "2026-03-01T00:00:00.000Z",
            "incomeValueUsd": "5",
            "instrumentId": "00000000-0000-4000-8000-0000000000b1",
            "instrumentName": "Bitcoin",
            "instrumentSymbol": "BTC",
            "journalRevision": 2,
            "kind": "create",
            "occurredAt": "2026-02-02T10:00:00.000Z",
            "orderWithinTimestamp": 0,
            "quantity": "0.1",
            "requestId": "00000000-0000-4000-8000-0000000000d3",
            "rewardId": "00000000-0000-4000-8000-0000000000e1",
            "version": 1,
          },
        ],
        "swaps": [],
        "trades": [
          {
            "createdAt": "2026-03-01T00:00:00.000Z",
            "feeUsd": "1",
            "grossUsd": "100",
            "instrumentId": "00000000-0000-4000-8000-0000000000b1",
            "instrumentName": "Bitcoin",
            "instrumentSymbol": "BTC",
            "journalRevision": 1,
            "kind": "create",
            "occurredAt": "2026-02-01T10:00:00.000Z",
            "orderWithinTimestamp": 0,
            "quantity": "2",
            "requestId": "00000000-0000-4000-8000-0000000000d1",
            "side": "buy",
            "tradeId": "00000000-0000-4000-8000-0000000000c1",
            "version": 1,
          },
        ],
      },
      "00000000-0000-4000-8000-0000000000a2" => {
        "accountId": "00000000-0000-4000-8000-0000000000a2",
        "capitalReturns": [
          {
            "accountId": "00000000-0000-4000-8000-0000000000a2",
            "amount": "1",
            "amountUsd": "1",
            "capitalReturnId": "00000000-0000-4000-8000-0000000000e3",
            "cashInstrumentId": "00000000-0000-4000-8000-0000000000b2",
            "cashInstrumentName": "US dollar",
            "cashInstrumentSymbol": "USD",
            "createdAt": "2026-03-01T00:00:00.000Z",
            "instrumentId": "00000000-0000-4000-8000-0000000000b1",
            "instrumentName": "Bitcoin",
            "instrumentSymbol": "BTC",
            "journalRevision": 3,
            "kind": "create",
            "occurredAt": "2026-02-04T10:00:00.000Z",
            "orderWithinTimestamp": 0,
            "paidCurrency": null,
            "rate": null,
            "requestId": "00000000-0000-4000-8000-0000000000d4",
            "version": 1,
          },
        ],
        "coverageFrom": "2026-01-01T00:00:00.000Z",
        "initialLots": [
          {
            "acquiredAt": "2025-12-01T00:00:00.000Z",
            "carriedQuantity": "1",
            "instrumentId": "00000000-0000-4000-8000-0000000000b1",
            "instrumentName": "Bitcoin",
            "instrumentSymbol": "BTC",
            "lotId": "00000000-0000-4000-8000-0000000000f2",
            "openingRevision": 1,
            "orderWithinTimestamp": 0,
            "ordinal": 1,
            "originalCostUsd": "10",
            "originalQuantity": "1",
          },
        ],
        "journal": {
          "accountId": "00000000-0000-4000-8000-0000000000a2",
          "canonicalPayload": "{}",
          "coverageFrom": 2026-01-01T00:00:00.000Z,
          "createdAt": 2026-03-01T00:00:00.000Z,
          "currentRevision": 3,
          "openingRevision": 1,
          "originKind": "known-cost-carry-in",
          "requestId": "00000000-0000-4000-8000-0000000000d0",
        },
        "rewards": [],
        "swaps": [],
        "trades": [],
      },
    },
    "capitalReturnParticipants": Set {
      "00000000-0000-4000-8000-0000000000a2",
    },
    "participants": Set {
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000a2",
    },
    "rewardParticipants": Set {
      "00000000-0000-4000-8000-0000000000a1",
    },
    "splits": [
      {
        "effectiveAt": "2026-02-05T00:00:00.000Z",
        "instrumentId": "00000000-0000-4000-8000-0000000000b1",
        "ratio": 2,
        "splitId": "00000000-0000-4000-8000-0000000000f3",
      },
    ],
    "swapParticipants": Set {},
    "transfers": [
      {
        "createdAt": "2026-03-01T00:00:00.000Z",
        "feeInstrumentId": null,
        "feeInstrumentName": null,
        "feeInstrumentSymbol": null,
        "feeQuantity": "0",
        "fromAccountId": "00000000-0000-4000-8000-0000000000a1",
        "fromJournalRevision": 2,
        "instrumentId": "00000000-0000-4000-8000-0000000000b1",
        "instrumentName": "Bitcoin",
        "instrumentSymbol": "BTC",
        "journalRevision": 1,
        "kind": "create",
        "occurredAt": "2026-02-03T10:00:00.000Z",
        "orderWithinTimestamp": 0,
        "quantity": "0.5",
        "requestId": "00000000-0000-4000-8000-0000000000d2",
        "toAccountId": "00000000-0000-4000-8000-0000000000a2",
        "toJournalRevision": 2,
        "transferId": "00000000-0000-4000-8000-0000000000f1",
        "version": 1,
      },
    ],
  },
}
`);
  });

  it('refuses each component that fails a check at the statement it fails after', async () => {
    const many = (accountId: string, count: number) =>
      Array.from({ length: count }, () => ({ accountId }));
    const cases: Record<string, Partial<World>> = {
      'a journal missing': { journals: [journal(a), journal(c)] },
      'journals missing in two components': { journals: [journal(a)] },
      'a journal twice': { journals: [journal(a), journal(b), journal(c), journal(c)] },
      'trades of one account': { tradeCounts: [{ accountId: a, count: 1001 }] },
      'trades of a component': {
        tradeCounts: Array.from({ length: 11 }, () => ({ accountId: b, count: 1000 })),
      },
      'trade rows': { trades: many(a, 10001) },
      'rewards of one account': { rewardCounts: [{ accountId: c, active: 1001 }] },
      'rewards of a component': {
        rewardCounts: [
          { accountId: a, active: 600 },
          { accountId: b, active: 401 },
        ],
      },
      'reward rows': { rewards: many(b, 1001) },
      'swaps of one account': { swapCounts: [{ accountId: c, active: 1001 }] },
      'swaps of a component': {
        swapCounts: [
          { accountId: a, active: 500 },
          { accountId: b, active: 501 },
        ],
      },
      'swap rows': { swaps: many(c, 1001) },
      'returns of one account': { returnCounts: [{ accountId: a, active: 1001 }] },
      'returns of a component': {
        returnCounts: [
          { accountId: a, active: 1000 },
          { accountId: b, active: 1 },
        ],
      },
      'return rows': { returns: many(a, 1001) },
    };
    const outcomes: Record<string, unknown> = {};
    for (const [name, over] of Object.entries(cases)) {
      const { trace, ...rest } = await read({ ...world(), ...over }, both);
      outcomes[name] = { ...rest, statements: trace.length, last: trace.at(-1)?.slice(0, 60) };
    }
    expect(outcomes).toMatchInlineSnapshot(`
{
  "a journal missing": {
    "error": "ConflictException: The records of an account have not started",
    "last": "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND ",
    "response": {
      "coverage": {
        "accountId": "00000000-0000-4000-8000-0000000000a2",
        "coverageFrom": null,
      },
      "error": "Conflict",
      "message": "The records of an account have not started",
      "statusCode": 409,
    },
    "statements": 2,
  },
  "a journal twice": {
    "error": "ConflictException: Accounting history conflicts with saved state",
    "last": "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND ",
    "response": {
      "error": "Conflict",
      "message": "Accounting history conflicts with saved state",
      "statusCode": 409,
    },
    "statements": 2,
  },
  "journals missing in two components": {
    "error": "ConflictException: The records of an account have not started",
    "last": "SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND ",
    "response": {
      "coverage": {
        "accountId": "00000000-0000-4000-8000-0000000000a3",
        "coverageFrom": null,
      },
      "error": "Conflict",
      "message": "The records of an account have not started",
      "statusCode": 409,
    },
    "statements": 2,
  },
  "return rows": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v.*,v."rateDate"::text AS "rateDate", i.name AS "inst",
    "response": undefined,
    "statements": 10,
  },
  "returns of a component": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 9,
  },
  "returns of one account": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 9,
  },
  "reward rows": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v.*,i.name AS "instrumentName",i.symbol AS "instrumen",
    "response": undefined,
    "statements": 6,
  },
  "rewards of a component": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 5,
  },
  "rewards of one account": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 5,
  },
  "swap rows": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v.*,o.name AS "outgoingInstrumentName",o.symbol AS "o",
    "response": undefined,
    "statements": 8,
  },
  "swaps of a component": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 7,
  },
  "swaps of one account": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v."accountId",count(*) FILTER(WHERE v.kind<>'void')::",
    "response": undefined,
    "statements": 7,
  },
  "trade rows": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrum",
    "response": undefined,
    "statements": 4,
  },
  "trades of a component": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT t."accountId",count(*)::int AS count FROM account_tra",
    "response": undefined,
    "statements": 3,
  },
  "trades of one account": {
    "error": "OwnedTransferCapacityError: Invalid trade history",
    "last": "SELECT t."accountId",count(*)::int AS count FROM account_tra",
    "response": undefined,
    "statements": 3,
  },
}
`);
  });
});

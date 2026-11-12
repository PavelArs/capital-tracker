import type { EntityManager } from 'typeorm';
import { appendTradeVersion, type PreparedTrade } from './trade-journal.store';

// Characterization of appendTradeVersion against a recording fake manager: the statements in
// order with their parameters, and the version it returns. Synthetic identifiers only.
const owner = '00000000-0000-4000-8000-000000000001';
const account = '00000000-0000-4000-8000-0000000000a1';
const btc = '00000000-0000-4000-8000-0000000000b1';
const usd = '00000000-0000-4000-8000-0000000000b2';
const trade = '00000000-0000-4000-8000-0000000000c1';
const request = '00000000-0000-4000-8000-0000000000d1';
const createdAt = new Date('2026-03-01T00:00:00.000Z');

function recorder(active = true) {
  const calls: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push(`${sql.replace(/\s+/g, ' ').trim()} ${JSON.stringify(params)}`);
      if (!sql.includes('INSERT INTO account_trade_versions')) return [];
      const [ownerId, accountId, tradeId, version, journalRevision, requestId, canonicalPayload] =
        params;
      const [kind, instrumentId, side, occurredAt, orderWithinTimestamp, quantity] =
        params.slice(7);
      const [grossUsd, feeUsd] = params.slice(13);
      return [
        {
          ownerId,
          accountId,
          tradeId,
          version,
          journalRevision,
          requestId,
          canonicalPayload,
          kind,
          instrumentId,
          side,
          occurredAt: new Date(occurredAt as string),
          orderWithinTimestamp,
          quantity,
          grossUsd,
          feeUsd,
          createdAt,
        },
      ];
    },
    queryRunner: { isTransactionActive: active },
  } as unknown as EntityManager;
  return { calls, manager };
}

const base: PreparedTrade = {
  tradeId: trade,
  version: 1,
  journalRevision: 4,
  requestId: request,
  canonicalPayload: '{"kind":"create"}',
  kind: 'create',
  instrumentId: btc,
  instrumentName: 'Bitcoin',
  instrumentSymbol: 'BTC',
  side: 'buy',
  occurredAt: '2026-02-02T10:00:00.000Z',
  orderWithinTimestamp: 0,
  quantity: '1',
  grossUsd: '50',
  feeUsd: '0.5',
};

async function append(next: PreparedTrade, active = true) {
  const { calls, manager } = recorder(active);
  try {
    return { calls, value: await appendTradeVersion(manager, owner, account, next) };
  } catch (error) {
    return { calls, error: `${(error as Error).constructor.name}: ${(error as Error).message}` };
  }
}

describe('appendTradeVersion characterization', () => {
  it('writes a created trade paid in rubles, settled in cash and with a note', async () => {
    expect(
      await append({
        ...base,
        paid: {
          currency: 'RUB',
          gross: '4000',
          fee: '40',
          rateDate: '2026-02-02',
          perUsd: '80',
          rateSource: 'bank-of-russia',
        },
        settlement: {
          instrumentId: usd,
          instrumentName: 'US dollar',
          instrumentSymbol: 'USD',
          quantity: '50.5',
        },
        comment: 'note',
      }),
    ).toMatchInlineSnapshot(`
{
  "calls": [
    "INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt") VALUES ($1,$2,$3,1,clock_timestamp()) ["00000000-0000-4000-8000-0000000000c1","00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1"]",
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind, "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()) RETURNING * ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",1,4,"00000000-0000-4000-8000-0000000000d1","{\\"kind\\":\\"create\\"}","create","00000000-0000-4000-8000-0000000000b1","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_payments ("ownerId","accountId","tradeId",version,currency,gross,fee,"rateDate","perUsd","rateSource") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",1,"RUB","4000","40","2026-02-02","80","bank-of-russia"]",
    "INSERT INTO account_trade_version_settlements ("ownerId","accountId","tradeId",version,"instrumentId",quantity) VALUES ($1,$2,$3,$4,$5,$6) ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",1,"00000000-0000-4000-8000-0000000000b2","50.5"]",
    "INSERT INTO account_trade_version_comments ("ownerId","accountId","tradeId",version,comment) VALUES ($1,$2,$3,$4,$5) ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",1,"note"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3 ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",1]",
  ],
  "value": {
    "comment": "note",
    "createdAt": "2026-03-01T00:00:00.000Z",
    "feeUsd": "0.5",
    "grossUsd": "50",
    "instrumentId": "00000000-0000-4000-8000-0000000000b1",
    "instrumentName": "Bitcoin",
    "instrumentSymbol": "BTC",
    "journalRevision": 4,
    "kind": "create",
    "occurredAt": "2026-02-02T10:00:00.000Z",
    "orderWithinTimestamp": 0,
    "paid": {
      "currency": "RUB",
      "fee": "40",
      "gross": "4000",
      "perUsd": "80",
      "rateDate": "2026-02-02",
      "rateSource": "bank-of-russia",
    },
    "quantity": "1",
    "requestId": "00000000-0000-4000-8000-0000000000d1",
    "settlement": {
      "instrumentId": "00000000-0000-4000-8000-0000000000b2",
      "instrumentName": "US dollar",
      "instrumentSymbol": "USD",
      "quantity": "50.5",
    },
    "side": "buy",
    "tradeId": "00000000-0000-4000-8000-0000000000c1",
    "version": 1,
  },
}
`);
  });

  it('writes a corrected trade with a purpose and without the trade row', async () => {
    expect(
      await append({ ...base, kind: 'correct', version: 2, purpose: 'income' }),
    ).toMatchInlineSnapshot(`
{
  "calls": [
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind, "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()) RETURNING * ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",2,4,"00000000-0000-4000-8000-0000000000d1","{\\"kind\\":\\"create\\"}","correct","00000000-0000-4000-8000-0000000000b1","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "INSERT INTO account_trade_version_purposes ("ownerId","accountId","tradeId",version,purpose) VALUES ($1,$2,$3,$4,$5) ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",2,"income"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3 ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",2]",
  ],
  "value": {
    "createdAt": "2026-03-01T00:00:00.000Z",
    "feeUsd": "0.5",
    "grossUsd": "50",
    "instrumentId": "00000000-0000-4000-8000-0000000000b1",
    "instrumentName": "Bitcoin",
    "instrumentSymbol": "BTC",
    "journalRevision": 4,
    "kind": "correct",
    "occurredAt": "2026-02-02T10:00:00.000Z",
    "orderWithinTimestamp": 0,
    "purpose": "income",
    "quantity": "1",
    "requestId": "00000000-0000-4000-8000-0000000000d1",
    "side": "buy",
    "tradeId": "00000000-0000-4000-8000-0000000000c1",
    "version": 2,
  },
}
`);
  });

  it('writes a void without optional rows', async () => {
    expect(await append({ ...base, kind: 'void', version: 3 })).toMatchInlineSnapshot(`
{
  "calls": [
    "INSERT INTO account_trade_versions ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind, "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()) RETURNING * ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",3,4,"00000000-0000-4000-8000-0000000000d1","{\\"kind\\":\\"create\\"}","void","00000000-0000-4000-8000-0000000000b1","buy","2026-02-02T10:00:00.000Z",0,"1","50","0.5"]",
    "UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3 ["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-0000000000a1","00000000-0000-4000-8000-0000000000c1",3]",
  ],
  "value": {
    "createdAt": "2026-03-01T00:00:00.000Z",
    "feeUsd": "0.5",
    "grossUsd": "50",
    "instrumentId": "00000000-0000-4000-8000-0000000000b1",
    "instrumentName": "Bitcoin",
    "instrumentSymbol": "BTC",
    "journalRevision": 4,
    "kind": "void",
    "occurredAt": "2026-02-02T10:00:00.000Z",
    "orderWithinTimestamp": 0,
    "quantity": "1",
    "requestId": "00000000-0000-4000-8000-0000000000d1",
    "side": "buy",
    "tradeId": "00000000-0000-4000-8000-0000000000c1",
    "version": 3,
  },
}
`);
  });

  it('refuses to write outside a transaction', async () => {
    expect(await append(base, false)).toMatchInlineSnapshot(`
{
  "calls": [],
  "error": "Error: Trade write requires transaction",
}
`);
  });
});

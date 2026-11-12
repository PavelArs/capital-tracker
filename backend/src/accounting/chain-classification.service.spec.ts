import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { marketPricesAt } from '../prices/market-price.store';
import { lockAccountingOwner } from './accounting-lock';
import type { AssetRewardService } from './asset-reward.service';
import { projectRewardVersion, readRewardHead } from './asset-reward.store';
import type { AssetSwapService } from './asset-swap.service';
import { projectSwapVersion, readSwapHead } from './asset-swap.store';
import { availableQuantity } from './available-quantity';
import {
  type ClassificationInput,
  classificationPayload,
  parseClassification,
} from './chain-classification';
import {
  ChainClassificationService,
  type ClassificationRow,
  classificationView,
} from './chain-classification.service';
import { type OwnRecord, readOwnRecords } from './chain-duplicate.store';
import { readConnectedLedger } from './connected-accounting.store';
import { FifoHistoryError } from './fifo';
import type { OwnedTransferService } from './owned-transfer.service';
import { readTransferHead } from './owned-transfer.store';
import { findOrCreateInstrument, type TradeService } from './trade.service';
import { readJournal } from './trade-journal.store';

// Characterization of the transaction code of ChainClassificationService: every statement,
// journal call and appended version, in order, against a fake manager. The pure planning
// helpers run for real; the stores of other journals are stubbed at their module boundary.
// All ids, hashes and amounts are synthetic.

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: () => mockUuid(),
}));
jest.mock('./accounting-lock', () => ({ lockAccountingOwner: jest.fn() }));
jest.mock('./trade-journal.store', () => ({
  ...jest.requireActual('./trade-journal.store'),
  readJournal: jest.fn(),
}));
jest.mock('./trade.service', () => ({
  ...jest.requireActual('./trade.service'),
  findOrCreateInstrument: jest.fn(),
}));
jest.mock('./asset-reward.store', () => ({
  ...jest.requireActual('./asset-reward.store'),
  readRewardHead: jest.fn(),
  projectRewardVersion: jest.fn(),
}));
jest.mock('./asset-swap.store', () => ({
  ...jest.requireActual('./asset-swap.store'),
  readSwapHead: jest.fn(),
  projectSwapVersion: jest.fn(),
}));
jest.mock('./owned-transfer.store', () => ({
  ...jest.requireActual('./owned-transfer.store'),
  readTransferHead: jest.fn(),
}));
jest.mock('./chain-duplicate.store', () => ({ readOwnRecords: jest.fn() }));
jest.mock('../prices/market-price.store', () => ({
  ...jest.requireActual('../prices/market-price.store'),
  marketPricesAt: jest.fn(),
}));
jest.mock('./connected-accounting.store', () => ({
  ...jest.requireActual('./connected-accounting.store'),
  readConnectedLedger: jest.fn(),
}));
jest.mock('./available-quantity', () => ({ availableQuantity: jest.fn() }));

let uuids = 0;
function mockUuid(): string {
  uuids += 1;
  return `ffffffff-ffff-4fff-8fff-${uuids.toString(16).padStart(12, '0')}`;
}

const aliases = new Map<string, string>();
const uuid = (name: string, n: number) => {
  const value = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  aliases.set(value, name);
  return value;
};
const hash = (name: string, digit: string) => {
  const value = digit.repeat(64);
  aliases.set(value, name);
  return value;
};

const OWNER = uuid('OWNER', 1);
const ADDR_A = uuid('ADDR_A', 2);
const ADDR_B = uuid('ADDR_B', 3);
const ADDR_C = uuid('ADDR_C', 4);
const ACC_A = uuid('ACC_A', 5);
const ACC_B = uuid('ACC_B', 6);
const ACC_C = uuid('ACC_C', 7);
const TRADE_OLD = uuid('TRADE_OLD', 8);
const REWARD_OLD = uuid('REWARD_OLD', 9);
const TRANSFER_OLD = uuid('TRANSFER_OLD', 10);
const SWAP_OLD = uuid('SWAP_OLD', 11);
const TRADE_NEW = uuid('TRADE_NEW', 12);
const REWARD_NEW = uuid('REWARD_NEW', 13);
const TRANSFER_NEW = uuid('TRANSFER_NEW', 14);
const SWAP_NEW = uuid('SWAP_NEW', 15);
const REQUEST = uuid('REQUEST', 16);
const RECORD = uuid('RECORD', 17);
const OTHER_TRADE = uuid('OTHER_TRADE', 18);
const TX_A = hash('TX_A', 'a');
const TX_B = hash('TX_B', 'b');
const TX_C = hash('TX_C', 'c');
const instrumentIds = new Map<string, string>([
  ['ETH', uuid('INST_ETH', 32)],
  ['USDT', uuid('INST_USDT', 33)],
  ['BTC', uuid('INST_BTC', 34)],
  ['USDC', uuid('INST_USDC', 35)],
]);
const CREATED = new Date('2026-04-01T00:00:00.000Z');

/** A synthetic raw leg as readLeg returns it. */
interface LegRow {
  network: 'ethereum' | 'bitcoin' | 'bybit';
  asset: string | null;
  accountId: string | null;
  blockTime: Date;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
  quoteAsset?: string | null;
  hash?: string | null;
}
const ethOut = (accountId: string | null, at = '2026-03-01T10:00:00.000Z'): LegRow => ({
  network: 'ethereum',
  asset: null,
  accountId,
  blockTime: new Date(at),
  receivedUnits: '0',
  sentUnits: '1001000000000000000',
  feeUnits: '1000000000000000',
  quoteAsset: null,
  hash: null,
});
const ethIn = (accountId: string | null, at = '2026-03-01T10:00:00.000Z'): LegRow => ({
  network: 'ethereum',
  asset: null,
  accountId,
  blockTime: new Date(at),
  receivedUnits: '1000000000000000000',
  sentUnits: '0',
  feeUnits: '0',
  quoteAsset: null,
  hash: null,
});
const usdtIn = (accountId: string | null, at = '2026-03-01T10:05:00.000Z'): LegRow => ({
  network: 'ethereum',
  asset: 'USDT',
  accountId,
  blockTime: new Date(at),
  receivedUnits: '2000000000',
  sentUnits: '0',
  feeUnits: '0',
  quoteAsset: null,
  hash: null,
});

const answer = (
  fields: Partial<ClassificationRow> & Pick<ClassificationRow, 'addressId' | 'txid' | 'version'>,
): ClassificationRow => ({
  requestId: uuid('REQUEST_OLD', 19),
  canonicalPayload: '{"old":true}',
  status: 'classified',
  type: null,
  details: null,
  comment: null,
  accountId: null,
  tradeId: null,
  rewardId: null,
  transferId: null,
  linkedAddressId: null,
  automatic: null,
  swapAccountId: null,
  swapId: null,
  pairedAddressId: null,
  pairedTxid: null,
  createdAt: CREATED,
  ...fields,
});

/** What the fake database holds for one test. */
interface World {
  legs: Map<string, LegRow>;
  heads: Map<string, number>;
  versions: Map<string, ClassificationRow>;
  replay: ClassificationRow[];
  tradeKinds: Map<string, string>;
  swapHeads: Map<string, { version: number; kind: string }>;
  rewardHeads: Map<string, { version: number; kind: string }>;
  transferHeads: Map<
    string,
    { version: number; kind: string; fromAccountId: string; toAccountId: string }
  >;
  partners: (LegRow & { addressId: string; txid: string })[];
  named: (LegRow & { addressId: string; txid: string })[];
  withdrawals: Map<string, (LegRow & { addressId: string; txid: string; partial: boolean })[]>;
  siblings: { addressId: string; txid: string }[];
  linked: Map<string, string>;
  recordTrade: unknown[];
  recordSwap: unknown[];
  tradeAccounts: Map<string, string>;
  matchLegs: unknown[];
  missingInstruments: Set<string>;
  journals: Map<string, { currentRevision: number } | null>;
  prices: Map<string, string>;
  records: OwnRecord[];
  available: string;
  failures: Map<string, unknown[]>;
}
let world: World;
const fresh = (): World => ({
  legs: new Map(),
  heads: new Map(),
  versions: new Map(),
  replay: [],
  tradeKinds: new Map(),
  swapHeads: new Map(),
  rewardHeads: new Map(),
  transferHeads: new Map(),
  partners: [],
  named: [],
  withdrawals: new Map(),
  siblings: [],
  linked: new Map(),
  recordTrade: [],
  recordSwap: [],
  tradeAccounts: new Map(),
  matchLegs: [],
  missingInstruments: new Set(),
  journals: new Map(),
  prices: new Map(),
  records: [],
  available: '0',
  failures: new Map(),
});
const at = (address: string, txid: string) => `${address}:${txid}`;
/** Puts a leg, its head version and its answers into the fake database. */
function put(address: string, txid: string, row: LegRow, ...versions: ClassificationRow[]) {
  world.legs.set(at(address, txid), row);
  if (versions.length > 0) world.heads.set(at(address, txid), versions.length);
  for (const version of versions)
    world.versions.set(`${at(address, txid)}:${version.version}`, version);
}
/** The next call of `label` throws `error`. */
const failNext = (label: string, error: unknown) =>
  world.failures.set(label, [...(world.failures.get(label) ?? []), error]);
const failIfAsked = (label: string) => {
  const queue = world.failures.get(label);
  if (queue && queue.length > 0) throw queue.shift();
};

let trace: string[];
const show = (value: unknown): string => {
  let text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? 'undefined'
        : value instanceof Date
          ? value.toISOString()
          : JSON.stringify(value);
  for (const [raw, name] of aliases) text = text.split(raw).join(name);
  return text.replace(/ffffffff-ffff-4fff-8fff-0*([0-9a-f]+)/g, 'uuid#$1');
};
const note = (label: string, ...args: unknown[]) =>
  trace.push([label, ...args.map(show)].join(' '));

/** The statement a SQL text is, by a part only it has. */
function statement(sql: string): string {
  const has = (part: string) => sql.includes(part);
  if (['SAVEPOINT chain_swap', 'RELEASE SAVEPOINT chain_swap'].includes(sql)) return sql;
  if (sql === 'ROLLBACK TO SAVEPOINT chain_swap') return sql;
  if (has('v."ownerId"=$1 AND v."requestId"=$2')) return 'replay';
  if (has('v."addressId"=$1 AND v.txid=$2 AND v.version=$3')) return 'version';
  if (has('SELECT "currentVersion" FROM chain_transaction_classifications')) return 'head';
  if (has('t."addressId"<>$3 AND w."accountId"=$4')) return 'partners';
  if (has('t."addressId"=$2 AND t.txid=$3 AND w."accountId"=$4')) return 'named-partner';
  if (has('WHERE t."ownerId"=$1 AND t."addressId"=$2 AND t.txid=$3')) return 'leg';
  if (has('SELECT v.kind FROM account_trades')) return 'trade-head';
  if (has('"cashSpent"') && has('FROM account_trades t')) return 'record-trade';
  if (has('FROM account_swaps s')) return 'record-swap';
  if (has('SELECT "accountId" FROM account_trades')) return 'trade-account';
  if (has("v.type='pool-withdrawal'")) return 'withdrawals';
  if (has('v."transferId"=$2 AND v.status=')) return 'siblings';
  if (has('h."addressId"=$2 AND v."transferId"=$3')) return 'linked-txid';
  if (has('UPDATE chain_transaction_classifications SET')) return 'head-update';
  if (has('INSERT INTO chain_transaction_classifications (')) return 'head-insert';
  if (has('INSERT INTO chain_transaction_classification_versions')) return 'version-insert';
  if (has('AS "loneTo"')) return 'match-legs';
  throw new Error(`Unexpected SQL: ${sql}`);
}

let inserted: ClassificationRow[];
function rows(label: string, params: unknown[]): unknown[] {
  const [first, second, third] = params as string[];
  switch (label) {
    case 'replay':
      return world.replay;
    case 'version': {
      const found = world.versions.get(`${at(first, second)}:${third}`);
      return found ? [found] : [];
    }
    case 'head': {
      const found = world.heads.get(at(first, second));
      return found === undefined ? [] : [{ currentVersion: found }];
    }
    case 'leg': {
      const found = world.legs.get(at(second, third));
      return found ? [found] : [];
    }
    case 'partners':
      return world.partners;
    case 'named-partner':
      return world.named;
    case 'trade-head': {
      const kind = world.tradeKinds.get(third);
      return kind === undefined ? [] : [{ kind }];
    }
    case 'record-trade':
      return world.recordTrade;
    case 'record-swap':
      return world.recordSwap;
    case 'trade-account': {
      const found = world.tradeAccounts.get(second);
      return found === undefined ? [] : [{ accountId: found }];
    }
    case 'withdrawals':
      return world.withdrawals.get(at(second, third)) ?? [];
    case 'siblings':
      return world.siblings;
    case 'linked-txid': {
      const found = world.linked.get(`${second}:${third}`);
      return found === undefined ? [] : [{ txid: found }];
    }
    case 'version-insert': {
      const p = params as (string | number | boolean | null)[];
      const saved = {
        addressId: p[1],
        txid: p[2],
        version: p[3],
        requestId: p[4],
        canonicalPayload: p[5],
        status: p[6],
        type: p[7],
        details: p[8] === null ? null : JSON.parse(p[8] as string),
        comment: p[9],
        accountId: p[10],
        tradeId: p[11],
        rewardId: p[12],
        transferId: p[13],
        linkedAddressId: p[14],
        automatic: p[15],
        swapAccountId: p[16],
        swapId: p[17],
        pairedAddressId: p[18],
        pairedTxid: p[19],
        createdAt: CREATED,
      } as ClassificationRow;
      inserted.push(saved);
      return [saved];
    }
    case 'match-legs':
      return world.matchLegs;
    default:
      return [];
  }
}

const manager = {
  async query(sql: string, params: unknown[] = []) {
    const label = statement(sql);
    note(label, ...params);
    failIfAsked(label);
    return rows(label, params);
  },
};
const source = {
  manager,
  query: (sql: string, params: unknown[]) => manager.query(sql, params),
  async transaction(...args: unknown[]) {
    const work = args[args.length - 1] as (m: typeof manager) => Promise<unknown>;
    note('begin', ...(args.length > 1 ? [args[0]] : []));
    try {
      const result = await work(manager);
      note('commit');
      return result;
    } catch (error) {
      note('rollback');
      throw error;
    }
  },
};

const journalCall =
  (service: string, produced: Record<string, unknown>) =>
  async (...args: unknown[]) => {
    const [, ...rest] = args;
    const action = service.endsWith('transfers') ? rest[1] : rest[2];
    note(`${service}.${action}`, ...rest);
    failIfAsked(`${service}.${action}`);
    return { value: produced };
  };
const trades = {
  mutateWithin: jest.fn(journalCall('trades', { trade: { tradeId: TRADE_NEW } })),
  settleWithin: jest.fn(async (...args: unknown[]) => {
    note('trades.settle', ...args.slice(1));
    failIfAsked('trades.settle');
  }),
};
const rewards = {
  mutateWithin: jest.fn(journalCall('rewards', { reward: { rewardId: REWARD_NEW } })),
};
const transfers = {
  mutateWithin: jest.fn(journalCall('transfers', { transfer: { transferId: TRANSFER_NEW } })),
};
const swaps = {
  mutateWithin: jest.fn(journalCall('swaps', { swap: { swapId: SWAP_NEW } })),
};

interface Target {
  address: string;
  txid: string;
  row: LegRow;
  version: number;
}
/** The private steps under test, reached as the public methods reach them. */
interface Internals {
  record(
    manager: unknown,
    owner: string,
    target: Target,
    input: ClassificationInput,
    payload: string,
    automatic: boolean,
  ): Promise<ClassificationRow>;
  recordSwap(
    manager: unknown,
    owner: string,
    target: Target,
    input: ClassificationInput,
    payload: string,
    value: unknown,
  ): Promise<ClassificationRow>;
  recordSwapOfRecord(
    manager: unknown,
    owner: string,
    target: Target,
    input: ClassificationInput,
    payload: string,
    value: unknown,
  ): Promise<ClassificationRow>;
  retire(manager: unknown, owner: string, row: ClassificationRow, written: string[]): Promise<void>;
  linkQuietly(owner: string): Promise<void>;
}
let service: ChainClassificationService;
let internals: Internals;

beforeEach(() => {
  uuids = 0;
  trace = [];
  inserted = [];
  world = fresh();
  service = new ChainClassificationService(
    source as unknown as DataSource,
    trades as unknown as TradeService,
    rewards as unknown as AssetRewardService,
    transfers as unknown as OwnedTransferService,
    swaps as unknown as AssetSwapService,
  );
  internals = service as unknown as Internals;
  jest.mocked(lockAccountingOwner).mockImplementation(async (_m, owner) => {
    note('lock', owner);
  });
  jest.mocked(readJournal).mockImplementation(async (_m: EntityManager, _o, account) => {
    note('journal', account);
    const journal = world.journals.has(account)
      ? world.journals.get(account)
      : { currentRevision: 7 };
    return (journal ?? undefined) as Awaited<ReturnType<typeof readJournal>>;
  });
  jest.mocked(findOrCreateInstrument).mockImplementation(async (_m, _o, asset, create) => {
    note('instrument', asset.symbol, create);
    if (world.missingInstruments.has(asset.symbol)) return null;
    return {
      id: instrumentIds.get(asset.symbol) ?? 'unknown',
      name: asset.name,
      symbol: asset.symbol,
    };
  });
  jest.mocked(readRewardHead).mockImplementation(async (_m, _o, account, id) => {
    note('reward-head', account, id);
    return world.rewardHeads.get(id) as Awaited<ReturnType<typeof readRewardHead>>;
  });
  jest
    .mocked(projectRewardVersion)
    .mockImplementation((head) => head as unknown as ReturnType<typeof projectRewardVersion>);
  jest.mocked(readSwapHead).mockImplementation(async (_m, _o, account, id) => {
    note('swap-head', account, id);
    return world.swapHeads.get(id) as Awaited<ReturnType<typeof readSwapHead>>;
  });
  jest
    .mocked(projectSwapVersion)
    .mockImplementation((head) => head as unknown as ReturnType<typeof projectSwapVersion>);
  jest.mocked(readTransferHead).mockImplementation(async (_m, _o, id) => {
    note('transfer-head', id);
    return world.transferHeads.get(id) as Awaited<ReturnType<typeof readTransferHead>>;
  });
  jest.mocked(readOwnRecords).mockImplementation(async (_m, _o, accounts) => {
    note('own-records', accounts);
    return world.records;
  });
  jest.mocked(marketPricesAt).mockImplementation(async (_m, items) => {
    note('prices', items);
    return items.map((item) => ({ price: world.prices.get(item.asset) ?? null })) as Awaited<
      ReturnType<typeof marketPricesAt>
    >;
  });
  jest.mocked(readConnectedLedger).mockImplementation(async (_m, _o, accounts) => {
    note('ledger', accounts);
    return 'LEDGER' as unknown as Awaited<ReturnType<typeof readConnectedLedger>>;
  });
  jest.mocked(availableQuantity).mockImplementation((_ledger, account, instrument, time) => {
    note('available', account, instrument, time);
    return world.available;
  });
});

/** The class and message a call was refused with. */
async function refusal(promise: Promise<unknown>): Promise<[string, string]> {
  try {
    await promise;
  } catch (error) {
    return [(error as Error).constructor.name, (error as Error).message];
  }
  throw new Error('The call was not refused');
}

const PAYLOAD = '{"payload":true}';
const input = (
  classification: unknown,
  extra: Partial<ClassificationInput> = {},
): ClassificationInput => ({
  requestId: REQUEST,
  expectedVersion: 0,
  hidden: false,
  classification: classification as ClassificationInput['classification'],
  ...extra,
});
const ethOutTarget = (version = 0): Target => ({
  address: ADDR_A,
  txid: TX_A,
  row: ethOut(ACC_A),
  version,
});
const ethInTarget = (version = 0): Target => ({
  address: ADDR_A,
  txid: TX_A,
  row: ethIn(ACC_A),
  version,
});
const live = (fields: Partial<ClassificationRow>) =>
  answer({ addressId: ADDR_A, txid: TX_A, version: 1, accountId: ACC_A, ...fields });
const transferHead = (fromAccountId: string, toAccountId: string, kind = 'create') => ({
  version: 1,
  kind,
  fromAccountId,
  toAccountId,
});

describe('retire: voids the entry an earlier answer produced', () => {
  it('voids a swap, then its carrying transfer, then frees the other side', async () => {
    world.swapHeads.set(SWAP_OLD, { version: 2, kind: 'create' });
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    put(
      ADDR_C,
      TX_C,
      usdtIn(ACC_B),
      answer({ addressId: ADDR_C, txid: TX_C, version: 1, swapId: SWAP_OLD, swapAccountId: ACC_B }),
    );
    const row = live({
      type: 'swap',
      swapAccountId: ACC_B,
      swapId: SWAP_OLD,
      transferId: TRANSFER_OLD,
      pairedAddressId: ADDR_C,
      pairedTxid: TX_C,
    });
    await internals.retire(manager, OWNER, row, [at(ADDR_A, TX_A)]);
    expect(trace).toEqual([
      'swap-head ACC_B SWAP_OLD',
      'journal ACC_B',
      'swaps.void OWNER ACC_B void {"requestId":"uuid#1","expectedJournalRevision":7,"expectedVersion":2} SWAP_OLD',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#2","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 uuid#3 {"unlinkedFrom":"SWAP_OLD","addressId":"ADDR_C","txid":"TX_C"} unclassified null null null null null null null null null null null null null',
    ]);
  });

  it('refuses a swap whose head is gone', async () => {
    const row = live({ type: 'swap', swapAccountId: ACC_B, swapId: SWAP_OLD });
    expect(await refusal(internals.retire(manager, OWNER, row, []))).toEqual([
      'Error',
      'Missing produced swap',
    ]);
    expect(trace).toEqual(['swap-head ACC_B SWAP_OLD']);
  });

  it('leaves the other side of a swap that is written now', async () => {
    world.swapHeads.set(SWAP_OLD, { version: 1, kind: 'create' });
    const row = live({
      type: 'swap',
      swapAccountId: ACC_A,
      swapId: SWAP_OLD,
      pairedAddressId: ADDR_C,
      pairedTxid: TX_C,
    });
    await internals.retire(manager, OWNER, row, [at(ADDR_A, TX_A), at(ADDR_C, TX_C)]);
    expect(trace).toEqual([
      'swap-head ACC_A SWAP_OLD',
      'journal ACC_A',
      'swaps.void OWNER ACC_A void {"requestId":"uuid#1","expectedJournalRevision":7,"expectedVersion":1} SWAP_OLD',
    ]);
  });

  it('settles a paid purchase again before its carrying transfer is voided', async () => {
    world.tradeAccounts.set(OTHER_TRADE, ACC_B);
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    put(ADDR_A, TX_A, usdtIn(ACC_A));
    const row = live({
      type: 'recorded',
      details: { type: 'recorded', operation: { kind: 'trade', id: OTHER_TRADE } },
      transferId: TRANSFER_OLD,
    });
    await internals.retire(manager, OWNER, row, [at(ADDR_A, TX_A)]);
    expect(trace).toEqual([
      'trade-account OWNER OTHER_TRADE',
      'leg OWNER ADDR_A TX_A',
      'trades.settle OWNER ACC_B OTHER_TRADE USDT TRANSFER_OLD',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
    ]);
  });

  it('voids the transfer of a recorded answer whose purchase is gone', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    const row = live({
      type: 'recorded',
      details: { type: 'recorded', operation: { kind: 'trade', id: OTHER_TRADE } },
      transferId: TRANSFER_OLD,
    });
    await internals.retire(manager, OWNER, row, []);
    expect(trace).toEqual([
      'trade-account OWNER OTHER_TRADE',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
    ]);
  });

  it('voids the transfer of a recorded swap without settling anything', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    const row = live({
      type: 'recorded',
      details: { type: 'recorded', operation: { kind: 'swap', id: OTHER_TRADE } },
      transferId: TRANSFER_OLD,
    });
    await internals.retire(manager, OWNER, row, []);
    expect(trace).toEqual([
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
    ]);
  });

  it('frees the linked leg of a voided transfer, found by the transfer', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    world.linked.set(`${ADDR_B}:${TRANSFER_OLD}`, TX_B);
    put(
      ADDR_B,
      TX_B,
      ethIn(ACC_B),
      answer({ addressId: ADDR_B, txid: TX_B, version: 1, transferId: TRANSFER_OLD }),
    );
    const row = live({ type: 'transfer', transferId: TRANSFER_OLD, linkedAddressId: ADDR_B });
    await internals.retire(manager, OWNER, row, [at(ADDR_A, TX_A)]);
    expect(trace).toEqual([
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'linked-txid OWNER ADDR_B TRANSFER_OLD',
      'head ADDR_B TX_B',
      'version ADDR_B TX_B 1',
      'head-update ADDR_B TX_B 2',
      'version-insert OWNER ADDR_B TX_B 2 uuid#2 {"unlinkedFrom":"TRANSFER_OLD","addressId":"ADDR_B","txid":"TX_B"} unclassified null null null null null null null null null null null null null',
    ]);
  });

  it('leaves a linked leg that is written now or has no answer of the transfer', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    world.linked.set(`${ADDR_B}:${TRANSFER_OLD}`, TX_A);
    const written = live({ type: 'transfer', transferId: TRANSFER_OLD, linkedAddressId: ADDR_B });
    await internals.retire(manager, OWNER, written, [at(ADDR_A, TX_A), at(ADDR_B, TX_A)]);
    const missing = live({ type: 'transfer', transferId: TRANSFER_OLD, linkedAddressId: ADDR_C });
    await internals.retire(manager, OWNER, missing, []);
    expect(trace).toEqual([
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'linked-txid OWNER ADDR_B TRANSFER_OLD',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#2","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'linked-txid OWNER ADDR_C TRANSFER_OLD',
    ]);
  });

  it('frees the siblings of a transfer joined across two hashes, but not the written one', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    world.siblings = [
      { addressId: ADDR_B, txid: TX_B },
      { addressId: ADDR_C, txid: TX_C },
      { addressId: ADDR_C, txid: TX_A },
    ];
    put(
      ADDR_B,
      TX_B,
      ethIn(ACC_B),
      answer({ addressId: ADDR_B, txid: TX_B, version: 1, transferId: TRANSFER_OLD }),
    );
    put(
      ADDR_C,
      TX_C,
      ethIn(ACC_C),
      answer({ addressId: ADDR_C, txid: TX_C, version: 1, transferId: TRANSFER_NEW }),
    );
    const row = live({ type: 'transfer', transferId: TRANSFER_OLD });
    await internals.retire(manager, OWNER, row, [at(ADDR_C, TX_A)]);
    expect(trace).toEqual([
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'siblings OWNER TRANSFER_OLD ADDR_A TX_A',
      'head ADDR_B TX_B',
      'version ADDR_B TX_B 1',
      'head-update ADDR_B TX_B 2',
      'version-insert OWNER ADDR_B TX_B 2 uuid#2 {"unlinkedFrom":"TRANSFER_OLD","addressId":"ADDR_B","txid":"TX_B"} unclassified null null null null null null null null null null null null null',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
    ]);
  });

  it('takes a swap without its account as a transfer', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    const row = live({ type: 'other', swapId: SWAP_OLD, transferId: TRANSFER_OLD });
    await internals.retire(manager, OWNER, row, []);
    expect(trace).toEqual([
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
    ]);
  });

  it('voids nothing for an answer that produced no entry', async () => {
    await internals.retire(manager, OWNER, live({ type: 'other' }), []);
    await internals.retire(manager, OWNER, live({ type: 'pool-deposit', accountId: null }), []);
    expect(trace).toEqual([]);
  });

  it('voids a trade', async () => {
    await internals.retire(manager, OWNER, live({ type: 'buy', tradeId: TRADE_OLD }), []);
    expect(trace).toEqual([
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
    ]);
  });

  it('voids only the trade of an answer that names a trade and a reward', async () => {
    const row = live({ type: 'buy', tradeId: TRADE_OLD, rewardId: REWARD_OLD });
    await internals.retire(manager, OWNER, row, []);
    expect(trace).toEqual([
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
    ]);
  });

  it('voids a reward at its head version', async () => {
    world.rewardHeads.set(REWARD_OLD, { version: 3, kind: 'create' });
    await internals.retire(manager, OWNER, live({ type: 'reward', rewardId: REWARD_OLD }), []);
    expect(trace).toEqual([
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#1","expectedJournalRevision":7,"expectedVersion":3} REWARD_OLD',
    ]);
  });

  it('refuses a reward whose head is gone', async () => {
    const row = live({ type: 'reward', rewardId: REWARD_OLD });
    expect(await refusal(internals.retire(manager, OWNER, row, []))).toEqual([
      'Error',
      'Missing produced reward',
    ]);
    expect(trace).toEqual(['journal ACC_A', 'reward-head ACC_A REWARD_OLD']);
  });

  it('passes a refused void on unchanged', async () => {
    failNext('trades.void', new ConflictException('refused'));
    const row = live({ type: 'buy', tradeId: TRADE_OLD });
    expect(await refusal(internals.retire(manager, OWNER, row, []))).toEqual([
      'ConflictException',
      'refused',
    ]);
    expect(trace).toEqual([
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
    ]);
  });
});

const purchase = (fields: Partial<OwnRecord> = {}): OwnRecord => ({
  kind: 'trade',
  id: RECORD,
  version: 3,
  answer: { type: 'buy', currency: 'USD', amount: '2000' },
  comment: null,
  accountId: ACC_A,
  coin: 'USDT',
  inbound: true,
  atoms: 2000n * 10n ** 30n,
  at: new Date('2026-03-01T09:00:00.000Z'),
  instrumentId: instrumentIds.get('USDT') as string,
  valueUsd: '2000',
  quantity: '2000',
  ...fields,
});
const recordSwapValue = (valueUsd: string | null = null, version = 3) => ({
  type: 'swap' as const,
  record: { kind: 'trade' as const, id: RECORD, version },
  valueUsd,
});

describe('recordSwapOfRecord: a swap against a record added by hand', () => {
  const swapOfRecord = (target: Target, value = recordSwapValue()) =>
    internals.recordSwapOfRecord(
      manager,
      OWNER,
      target,
      input(value, { expectedVersion: target.version }),
      PAYLOAD,
      value,
    );

  it('asks for the account of the wallet before reading anything', async () => {
    const target = { ...ethOutTarget(), row: ethOut(null) };
    expect(await refusal(swapOfRecord(target))).toEqual([
      'UnprocessableEntityException',
      'Choose the account of this wallet first',
    ]);
    expect(trace).toEqual([]);
  });

  it.each([
    ['is gone', []],
    ['changed its version', [purchase({ version: 4 })]],
    ['is a reward of the same id', [purchase({ kind: 'reward' })]],
    ['has another id', [purchase({ id: OTHER_TRADE })]],
  ])('refuses a record that %s', async (_name, records) => {
    world.records = records as OwnRecord[];
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'ConflictException',
      'That record changed; reload and try again',
    ]);
    expect(trace).toEqual(['own-records ["ACC_A"]']);
  });

  it.each([
    ['an income', { type: 'income', valueUsd: '10' }],
    ['a buy with a fee', { type: 'buy', currency: 'USD', amount: '2000', fee: '1' }],
    ['a buy at a paid rate', { type: 'buy', currency: 'RUB', amount: '2000', perUsd: '90' }],
  ])('refuses %s as the other side of a swap', async (_name, recordAnswer) => {
    world.records = [purchase({ answer: recordAnswer as OwnRecord['answer'] })];
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'UnprocessableEntityException',
      'That record cannot be replaced by a swap',
    ]);
  });

  it.each([
    [
      'a fee before the direction',
      { answer: { type: 'sell', currency: 'USD', amount: '1', fee: '1' }, inbound: false },
      'That record cannot be replaced by a swap',
    ],
    [
      'the direction before the coin',
      { inbound: false, coin: 'ETH' },
      'Choose a record that moved coins the other way',
    ],
    [
      'the coin before the time',
      { coin: 'ETH', at: new Date('2026-04-01T00:00:00.000Z') },
      'A swap needs two different coins',
    ],
    [
      'a record too far away',
      { at: new Date('2026-03-08T10:00:00.001Z') },
      'That record is too far from this transaction',
    ],
  ])('refuses %s', async (_name, fields, message) => {
    world.records = [purchase(fields as Partial<OwnRecord>)];
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'UnprocessableEntityException',
      message,
    ]);
    expect(trace).toEqual(['own-records ["ACC_A"]']);
  });

  it('accepts a record exactly a week away', async () => {
    world.records = [purchase({ at: new Date('2026-03-08T10:00:00.000Z') })];
    await swapOfRecord(ethOutTarget());
    expect(trace[1]).toBe('journal ACC_A');
    expect(inserted).toHaveLength(1);
  });

  it('voids the live answer, then the record, then writes the swap paying with the leg', async () => {
    world.records = [purchase()];
    world.tradeKinds.set(TRADE_OLD, 'create');
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'sell', tradeId: TRADE_OLD }));
    const saved = await swapOfRecord(ethOutTarget(1));
    expect(saved).toBe(inserted[0]);
    expect(trace).toEqual([
      'own-records ["ACC_A"]',
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#2","expectedJournalRevision":7}',
      'instrument ETH true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","record":{"kind":"trade","id":"RECORD","version":3},"valueUsd":null} null ACC_A null null null null null ACC_A SWAP_NEW null null',
    ]);
  });

  it('writes a swap receiving the leg at the owner value, without a fee', async () => {
    world.records = [
      purchase({
        answer: { type: 'sell', currency: 'USD', amount: '3000' },
        coin: 'ETH',
        inbound: false,
        instrumentId: instrumentIds.get('ETH') as string,
        quantity: '1.5',
      }),
    ];
    const target: Target = { address: ADDR_C, txid: TX_C, row: usdtIn(ACC_A), version: 0 };
    const saved = await swapOfRecord(target, recordSwapValue('2999.99'));
    expect(saved).toBe(inserted[0]);
    expect(trace).toEqual([
      'own-records ["ACC_A"]',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#2","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1.5","incomingQuantity":"2000","considerationUsd":"2999.99","feeSource":null,"feeInstrumentId":null,"feeQuantity":"0"}',
      'head-insert OWNER ADDR_C TX_C 1',
      'version-insert OWNER ADDR_C TX_C 1 REQUEST {"payload":true} classified swap {"type":"swap","record":{"kind":"trade","id":"RECORD","version":3},"valueUsd":"2999.99"} null ACC_A null null null null null ACC_A SWAP_NEW null null',
    ]);
  });

  it('leaves an answer whose entry was voided elsewhere', async () => {
    world.records = [purchase()];
    world.tradeKinds.set(TRADE_OLD, 'void');
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'sell', tradeId: TRADE_OLD }));
    await swapOfRecord(ethOutTarget(1));
    expect(trace).toEqual([
      'own-records ["ACC_A"]',
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'instrument ETH true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#2","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","record":{"kind":"trade","id":"RECORD","version":3},"valueUsd":null} null ACC_A null null null null null ACC_A SWAP_NEW null null',
    ]);
  });

  it('stops when the coin of the leg cannot be created', async () => {
    world.records = [purchase()];
    world.missingInstruments.add('ETH');
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'Error',
      'Chain coin was not created',
    ]);
    expect(trace).toEqual([
      'own-records ["ACC_A"]',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'instrument ETH true',
    ]);
  });

  it.each([
    ['a conflict', new ConflictException('refused')],
    ['a history error', new FifoHistoryError()],
  ])('turns %s of the swap journal into a refusal', async (_name, error) => {
    world.records = [purchase()];
    failNext('swaps.create', error);
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'UnprocessableEntityException',
      'The books do not hold the coins of this swap at that time; answer the earlier transactions of this wallet first',
    ]);
    expect(inserted).toEqual([]);
  });

  it('passes any other failure of the swap journal on', async () => {
    world.records = [purchase()];
    failNext('swaps.create', new BadRequestException('Invalid accounting input'));
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'BadRequestException',
      'Invalid accounting input',
    ]);
  });

  it('turns a refused void of the record into a refusal', async () => {
    world.records = [purchase()];
    failNext('trades.void', new FifoHistoryError());
    expect(await refusal(swapOfRecord(ethOutTarget()))).toEqual([
      'UnprocessableEntityException',
      'The books would not hold the coins without that record; change the entries that depend on it first',
    ]);
    expect(trace).toEqual([
      'own-records ["ACC_A"]',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#1","expectedJournalRevision":7}',
    ]);
  });
});

const swapWith = (valueUsd: string | null = '2000') => ({
  type: 'swap' as const,
  with: { addressId: ADDR_C, txid: TX_C },
  valueUsd,
});

describe('recordSwap: a swap of two raw transactions', () => {
  const recordSwap = (target: Target, value: ReturnType<typeof swapWith>, comment?: string) =>
    internals.recordSwap(
      manager,
      OWNER,
      target,
      input(value, { expectedVersion: target.version, ...(comment ? { comment } : {}) }),
      PAYLOAD,
      value,
    );

  it('writes the swap and both answers when neither side had one', async () => {
    put(ADDR_C, TX_C, usdtIn(ACC_A));
    const saved = await recordSwap(ethOutTarget(), swapWith());
    expect(saved).toBe(inserted[0]);
    expect(inserted).toHaveLength(2);
    expect(trace).toEqual([
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#1","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
      'head-insert OWNER ADDR_C TX_C 1',
      'version-insert OWNER ADDR_C TX_C 1 uuid#2 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
    ]);
  });

  it('carries the paid coins over first when the sides are in two accounts', async () => {
    put(ADDR_C, TX_C, usdtIn(ACC_B));
    world.prices.set('ETH', '3000');
    await recordSwap(ethOutTarget(), swapWith(null));
    expect(trace).toEqual([
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'prices [{"asset":"ETH","at":"2026-03-01T10:05:00.000Z"}]',
      'journal ACC_B',
      'swaps.create OWNER ACC_B create {"requestId":"uuid#2","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":null,"feeInstrumentId":null,"feeQuantity":"0"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":null} null ACC_A null null TRANSFER_NEW null null ACC_B SWAP_NEW ADDR_C TX_C',
      'head-insert OWNER ADDR_C TX_C 1',
      'version-insert OWNER ADDR_C TX_C 1 uuid#3 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":null} null ACC_B null null TRANSFER_NEW null null ACC_B SWAP_NEW ADDR_A TX_A',
    ]);
  });

  it('keeps a swap both sides still name', async () => {
    world.swapHeads.set(SWAP_OLD, { version: 1, kind: 'create' });
    put(
      ADDR_A,
      TX_A,
      ethOut(ACC_A),
      live({
        type: 'swap',
        details: swapWith(),
        swapAccountId: ACC_A,
        swapId: SWAP_OLD,
        pairedAddressId: ADDR_C,
        pairedTxid: TX_C,
        comment: 'kept',
      }),
    );
    put(
      ADDR_C,
      TX_C,
      usdtIn(ACC_A),
      answer({
        addressId: ADDR_C,
        txid: TX_C,
        version: 1,
        type: 'swap',
        swapAccountId: ACC_A,
        swapId: SWAP_OLD,
      }),
    );
    const saved = await recordSwap(ethOutTarget(1), swapWith(), 'kept');
    expect(saved).toBe(inserted[0]);
    expect(inserted).toHaveLength(1);
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'swap-head ACC_A SWAP_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'swap-head ACC_A SWAP_OLD',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} kept ACC_A null null null null null ACC_A SWAP_OLD ADDR_C TX_C',
    ]);
  });

  it('writes a new swap when the other side is unclassified', async () => {
    world.swapHeads.set(SWAP_OLD, { version: 1, kind: 'create' });
    put(
      ADDR_A,
      TX_A,
      ethOut(ACC_A),
      live({
        type: 'swap',
        details: swapWith(),
        swapAccountId: ACC_A,
        swapId: SWAP_OLD,
        pairedAddressId: ADDR_C,
        pairedTxid: TX_C,
      }),
    );
    put(
      ADDR_C,
      TX_C,
      usdtIn(ACC_A),
      answer({ addressId: ADDR_C, txid: TX_C, version: 1, status: 'unclassified' }),
    );
    await recordSwap(ethOutTarget(1), swapWith());
    expect(inserted).toHaveLength(2);
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'swap-head ACC_A SWAP_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'swap-head ACC_A SWAP_OLD',
      'journal ACC_A',
      'swaps.void OWNER ACC_A void {"requestId":"uuid#1","expectedJournalRevision":7,"expectedVersion":1} SWAP_OLD',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#2","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 uuid#3 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
    ]);
  });

  const twoLive = () => {
    world.tradeKinds.set(TRADE_OLD, 'create');
    world.rewardHeads.set(REWARD_OLD, { version: 1, kind: 'create' });
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'sell', tradeId: TRADE_OLD }));
    put(
      ADDR_C,
      TX_C,
      usdtIn(ACC_A),
      answer({
        addressId: ADDR_C,
        txid: TX_C,
        version: 1,
        type: 'reward',
        accountId: ACC_A,
        rewardId: REWARD_OLD,
      }),
    );
  };

  it('voids the paying entry, then the receiving one inside a savepoint before the swap', async () => {
    twoLive();
    await recordSwap(ethOutTarget(1), swapWith());
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'reward-head ACC_A REWARD_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'SAVEPOINT chain_swap',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#2","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'RELEASE SAVEPOINT chain_swap',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 uuid#4 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
    ]);
  });

  it('voids the receiving entry after the swap when the books refuse it first', async () => {
    twoLive();
    failNext('rewards.void', new ConflictException('refused'));
    await recordSwap(ethOutTarget(1), swapWith());
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'reward-head ACC_A REWARD_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'SAVEPOINT chain_swap',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#2","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
      'ROLLBACK TO SAVEPOINT chain_swap',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#4","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 uuid#5 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
    ]);
  });

  it('writes the swap before the void when the swap is refused inside the savepoint', async () => {
    twoLive();
    failNext('swaps.create', new FifoHistoryError());
    await recordSwap(ethOutTarget(1), swapWith());
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'reward-head ACC_A REWARD_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'SAVEPOINT chain_swap',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#2","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'ROLLBACK TO SAVEPOINT chain_swap',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#4","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"2000","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#5","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 uuid#6 {"pairedWith":{"addressId":"ADDR_A","txid":"TX_A"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"2000"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
    ]);
  });

  it('passes any other failure inside the savepoint on', async () => {
    twoLive();
    failNext('rewards.void', new Error('boom'));
    expect(await refusal(recordSwap(ethOutTarget(1), swapWith()))).toEqual(['Error', 'boom']);
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'reward-head ACC_A REWARD_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'SAVEPOINT chain_swap',
      'journal ACC_A',
      'reward-head ACC_A REWARD_OLD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#2","expectedJournalRevision":7,"expectedVersion":1} REWARD_OLD',
    ]);
  });

  it('voids one shared entry once when the leg is the receiving side', async () => {
    world.swapHeads.set(SWAP_OLD, { version: 1, kind: 'create' });
    const shared = {
      type: 'swap',
      swapAccountId: ACC_A,
      swapId: SWAP_OLD,
      accountId: ACC_A,
    } as const;
    put(
      ADDR_A,
      TX_A,
      ethOut(ACC_A),
      live({ ...shared, details: swapWith('1'), pairedAddressId: ADDR_C, pairedTxid: TX_C }),
    );
    put(
      ADDR_C,
      TX_C,
      usdtIn(ACC_A),
      answer({
        addressId: ADDR_C,
        txid: TX_C,
        version: 1,
        ...shared,
        pairedAddressId: ADDR_A,
        pairedTxid: TX_A,
      }),
    );
    const value = { type: 'swap' as const, with: { addressId: ADDR_A, txid: TX_A }, valueUsd: '5' };
    const target: Target = { address: ADDR_C, txid: TX_C, row: usdtIn(ACC_A), version: 1 };
    await internals.recordSwap(
      manager,
      OWNER,
      target,
      input(value, { expectedVersion: 1 }),
      PAYLOAD,
      value,
    );
    expect(trace).toEqual([
      'version ADDR_C TX_C 1',
      'swap-head ACC_A SWAP_OLD',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'version ADDR_A TX_A 1',
      'swap-head ACC_A SWAP_OLD',
      'swap-head ACC_A SWAP_OLD',
      'journal ACC_A',
      'swaps.void OWNER ACC_A void {"requestId":"uuid#1","expectedJournalRevision":7,"expectedVersion":1} SWAP_OLD',
      'instrument ETH true',
      'instrument USDT true',
      'journal ACC_A',
      'swaps.create OWNER ACC_A create {"requestId":"uuid#2","expectedJournalRevision":7,"assertExecuted":true,"outgoingInstrumentId":"INST_ETH","incomingInstrumentId":"INST_USDT","occurredAt":"2026-03-01T10:05:00.000Z","orderWithinTimestamp":null,"outgoingQuantity":"1","incomingQuantity":"2000","considerationUsd":"5","feeSource":"held","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-update ADDR_C TX_C 2',
      'version-insert OWNER ADDR_C TX_C 2 REQUEST {"payload":true} classified swap {"type":"swap","with":{"addressId":"ADDR_A","txid":"TX_A"},"valueUsd":"5"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_A TX_A',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 uuid#3 {"pairedWith":{"addressId":"ADDR_C","txid":"TX_C"},"swapId":"SWAP_NEW"} classified swap {"type":"swap","with":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":"5"} null ACC_A null null null null null ACC_A SWAP_NEW ADDR_C TX_C',
    ]);
  });
});

const ethInRow = (addressId: string, txid: string, accountId: string, time?: string) => ({
  ...ethIn(accountId, time),
  addressId,
  txid,
});

describe('record: the answer of one leg and the entry it stands for', () => {
  const record = (target: Target, value: ClassificationInput, automatic = false) =>
    internals.record(manager, OWNER, target, value, PAYLOAD, automatic);

  it('hides a leg with no answer and records nothing', async () => {
    const saved = await record(ethInTarget(), input({ type: 'other' }, { hidden: true }));
    expect(saved).toBe(inserted[0]);
    expect(trace).toEqual([
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} hidden other {"type":"other"} null null null null null null null null null null null',
    ]);
  });

  it('refuses another answer for a deposit that a withdrawal names', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'pool-deposit' }));
    world.withdrawals.set(at(ADDR_A, TX_A), [{ ...ethInRow(ADDR_B, TX_B, ACC_A), partial: false }]);
    expect(
      await refusal(record(ethOutTarget(1), input({ type: 'other' }, { expectedVersion: 1 }))),
    ).toEqual([
      'UnprocessableEntityException',
      'A pool withdrawal names this deposit; change the withdrawal first',
    ]);
    expect(trace).toEqual(['version ADDR_A TX_A 1', 'withdrawals OWNER ADDR_A TX_A ADDR_A TX_A']);
  });

  it('changes a deposit no withdrawal names', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'pool-deposit' }));
    await record(ethOutTarget(1), input({ type: 'other' }, { expectedVersion: 1 }));
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'withdrawals OWNER ADDR_A TX_A ADDR_A TX_A',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified other {"type":"other"} null ACC_A null null null null null null null null null',
    ]);
  });

  it('adds a note to a deposit without asking for its withdrawals', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'pool-deposit' }));
    await record(
      ethOutTarget(1),
      input({ type: 'pool-deposit' }, { expectedVersion: 1, comment: 'note' }),
    );
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified pool-deposit {"type":"pool-deposit"} note ACC_A null null null null null null null null null',
    ]);
  });

  it('refuses an answer for a wallet without an account', async () => {
    const target = { ...ethInTarget(), row: ethIn(null) };
    expect(await refusal(record(target, input({ type: 'other' })))).toEqual([
      'UnprocessableEntityException',
      'Choose the account of this wallet first',
    ]);
    expect(trace).toEqual([]);
  });

  it('clears an answer of a wallet without an account', async () => {
    const target = { ...ethInTarget(), row: ethIn(null) };
    await record(target, input(null));
    expect(trace).toEqual([
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} unclassified null null null null null null null null null null null null null',
    ]);
  });

  const buy = () => input({ type: 'buy', currency: 'USD', amount: '3000' }, { comment: 'n' });

  it('records a buy the app made as a recognised new trade', async () => {
    await record(ethInTarget(), buy(), true);
    expect(inserted[0].automatic).toBe(true);
    expect(trace).toEqual([
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#1","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"buy","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","grossUsd":"3000","feeUsd":"0","comment":"n","settlementCurrency":"USD"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified buy {"type":"buy","currency":"USD","amount":"3000"} n ACC_A TRADE_NEW null null null true null null null null',
    ]);
  });

  it('records a buy the owner made as a new trade', async () => {
    await record(ethInTarget(), buy(), false);
    expect(inserted[0].automatic).toBeNull();
    expect(trace).toEqual([
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#1","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"buy","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","grossUsd":"3000","feeUsd":"0","comment":"n","settlementCurrency":"USD"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified buy {"type":"buy","currency":"USD","amount":"3000"} n ACC_A TRADE_NEW null null null null null null null null',
    ]);
  });

  it('records a reward as recognised when the app made it', async () => {
    await record(ethInTarget(), input({ type: 'staking-reward', valueUsd: '5' }), true);
    expect(trace).toEqual([
      'instrument ETH true',
      'journal ACC_A',
      'rewards.create OWNER ACC_A create {"requestId":"uuid#1","expectedJournalRevision":7,"assertReward":true,"instrumentId":"INST_ETH","category":"staking","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","acquisitionBasisUsd":"5","incomeValueUsd":"5"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified staking-reward {"type":"staking-reward","valueUsd":"5"} null ACC_A null REWARD_NEW null null true null null null null',
    ]);
  });

  it('values a fee without a value at its stored price', async () => {
    world.prices.set('ETH', '3000');
    await record(ethOutTarget(), input({ type: 'fee', valueUsd: null }));
    expect(trace).toEqual([
      'prices [{"asset":"ETH","at":"2026-03-01T10:00:00.000Z"}]',
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#1","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"sell","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1.001","grossUsd":"3003","feeUsd":"3003","purpose":"fee"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified fee {"type":"fee","valueUsd":null} null ACC_A TRADE_NEW null null null null null null null null',
    ]);
  });

  it('refuses a fee without a value or a stored price', async () => {
    expect(await refusal(record(ethOutTarget(), input({ type: 'fee', valueUsd: null })))).toEqual([
      'UnprocessableEntityException',
      'No stored price for this coin at that time',
    ]);
    expect(trace).toEqual(['prices [{"asset":"ETH","at":"2026-03-01T10:00:00.000Z"}]']);
  });

  it('keeps the entry of the same answer', async () => {
    world.tradeKinds.set(TRADE_OLD, 'create');
    const value = { type: 'buy', currency: 'USD', amount: '3000' };
    put(
      ADDR_A,
      TX_A,
      ethIn(ACC_A),
      live({ type: 'buy', details: value as ClassificationRow['details'], tradeId: TRADE_OLD }),
    );
    await record(ethInTarget(1), input(value, { expectedVersion: 1 }), true);
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified buy {"type":"buy","currency":"USD","amount":"3000"} null ACC_A TRADE_OLD null null null true null null null null',
    ]);
  });

  it('adds the new entry before voiding the old one of a receipt', async () => {
    world.tradeKinds.set(TRADE_OLD, 'create');
    put(ADDR_A, TX_A, ethIn(ACC_A), live({ type: 'buy', tradeId: TRADE_OLD }));
    await record(ethInTarget(1), input({ type: 'reward', valueUsd: '10' }, { expectedVersion: 1 }));
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'instrument ETH true',
      'journal ACC_A',
      'rewards.create OWNER ACC_A create {"requestId":"uuid#1","expectedJournalRevision":7,"assertReward":true,"instrumentId":"INST_ETH","category":"other","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","acquisitionBasisUsd":"10","incomeValueUsd":"10"}',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#2","expectedJournalRevision":7}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified reward {"type":"reward","valueUsd":"10"} null ACC_A null REWARD_NEW null null null null null null null',
    ]);
  });

  it('voids the old entry of a send before adding the new one', async () => {
    world.tradeKinds.set(TRADE_OLD, 'create');
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ type: 'sell', tradeId: TRADE_OLD }));
    await record(
      ethOutTarget(1),
      input({ type: 'expense', valueUsd: '10' }, { expectedVersion: 1 }),
    );
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_A TRADE_OLD',
      'journal ACC_A',
      'trades.void OWNER ACC_A void TRADE_OLD {"requestId":"uuid#1","expectedJournalRevision":7}',
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#2","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"sell","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1.001","grossUsd":"10","feeUsd":"0","purpose":"expense"}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified expense {"type":"expense","valueUsd":"10"} null ACC_A TRADE_NEW null null null null null null null null',
    ]);
  });

  it('records a transfer with the other leg of the same transaction and links it', async () => {
    world.partners = [ethInRow(ADDR_B, TX_A, ACC_B)];
    await record(ethOutTarget(), input({ type: 'transfer', accountId: ACC_B }));
    expect(inserted).toHaveLength(2);
    expect(trace).toEqual([
      'partners OWNER TX_A ADDR_A ACC_B null',
      'head ADDR_B TX_A',
      'instrument ETH true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_B"} null ACC_A null null TRANSFER_NEW ADDR_B false null null null null',
      'head-insert OWNER ADDR_B TX_A 1',
      'version-insert OWNER ADDR_B TX_A 1 uuid#2 {"linkedTo":{"addressId":"ADDR_A","txid":"TX_A"},"accountId":"ACC_A","tradeId":null,"rewardId":null,"transferId":"TRANSFER_NEW","swapAccountId":null,"swapId":null} classified transfer {"type":"transfer","accountId":"ACC_A"} null ACC_B null null TRANSFER_NEW ADDR_A false null null null null',
    ]);
  });

  it('frees the other leg of a receipt first and keeps its transfer note', async () => {
    world.tradeKinds.set(TRADE_OLD, 'create');
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_C));
    world.partners = [{ ...ethOut(ACC_A), addressId: ADDR_B, txid: TX_A }];
    put(
      ADDR_B,
      TX_A,
      ethOut(ACC_A),
      answer({ addressId: ADDR_B, txid: TX_A, version: 1, status: 'unclassified' }),
      answer({
        addressId: ADDR_B,
        txid: TX_A,
        version: 2,
        type: 'transfer',
        accountId: ACC_A,
        transferId: TRANSFER_OLD,
        comment: 'their note',
      }),
    );
    put(ADDR_A, TX_A, ethIn(ACC_B), live({ type: 'buy', accountId: ACC_B, tradeId: TRADE_OLD }));
    const target: Target = { address: ADDR_A, txid: TX_A, row: ethIn(ACC_B), version: 1 };
    await record(target, input({ type: 'transfer', accountId: ACC_A }, { expectedVersion: 1 }));
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'trade-head OWNER ACC_B TRADE_OLD',
      'partners OWNER TX_A ADDR_A ACC_A null',
      'head ADDR_B TX_A',
      'version ADDR_B TX_A 2',
      'transfer-head TRANSFER_OLD',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_C',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'siblings OWNER TRANSFER_OLD ADDR_B TX_A',
      'instrument ETH true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#2","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'journal ACC_B',
      'trades.void OWNER ACC_B void TRADE_OLD {"requestId":"uuid#3","expectedJournalRevision":7}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_A"} null ACC_B null null TRANSFER_NEW ADDR_B false null null null null',
      'head-update ADDR_B TX_A 3',
      'version-insert OWNER ADDR_B TX_A 3 uuid#4 {"linkedTo":{"addressId":"ADDR_A","txid":"TX_A"},"accountId":"ACC_B","tradeId":null,"rewardId":null,"transferId":"TRANSFER_NEW","swapAccountId":null,"swapId":null} classified transfer {"type":"transfer","accountId":"ACC_B"} their note ACC_A null null TRANSFER_NEW ADDR_A false null null null null',
    ]);
  });

  it('joins a named leg of another hash without linking the address', async () => {
    world.named = [ethInRow(ADDR_B, TX_B, ACC_B, '2026-03-01T11:00:00.000Z')];
    await record(
      ethOutTarget(),
      input({
        type: 'transfer',
        accountId: ACC_B,
        partner: { addressId: ADDR_B, txid: TX_B },
      }),
    );
    expect(trace).toEqual([
      'named-partner OWNER ADDR_B TX_B ACC_B',
      'head ADDR_B TX_B',
      'instrument ETH true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_B","partner":{"addressId":"ADDR_B","txid":"TX_B"}} null ACC_A null null TRANSFER_NEW null false null null null null',
      'head-insert OWNER ADDR_B TX_B 1',
      'version-insert OWNER ADDR_B TX_B 1 uuid#2 {"linkedTo":{"addressId":"ADDR_A","txid":"TX_A"},"accountId":"ACC_A","tradeId":null,"rewardId":null,"transferId":"TRANSFER_NEW","swapAccountId":null,"swapId":null} classified transfer {"type":"transfer","accountId":"ACC_A"} null ACC_B null null TRANSFER_NEW null false null null null null',
    ]);
  });

  it('refuses a named leg that is not the other side', async () => {
    world.named = [ethInRow(ADDR_B, TX_B, ACC_B, '2026-03-03T11:00:00.000Z')];
    expect(
      await refusal(
        record(
          ethOutTarget(),
          input({
            type: 'transfer',
            accountId: ACC_B,
            partner: { addressId: ADDR_B, txid: TX_B },
          }),
        ),
      ),
    ).toEqual([
      'UnprocessableEntityException',
      'That transaction is not the other side of this one: it must move the same coin the other way, within a day and a fee of the amount',
    ]);
    expect(trace).toEqual(['named-partner OWNER ADDR_B TX_B ACC_B']);
  });

  it('refuses a transfer when several legs of the account took part', async () => {
    world.partners = [ethInRow(ADDR_B, TX_A, ACC_B), ethInRow(ADDR_C, TX_A, ACC_B)];
    expect(
      await refusal(record(ethOutTarget(), input({ type: 'transfer', accountId: ACC_B }))),
    ).toEqual([
      'UnprocessableEntityException',
      'Several addresses of that account took part in this transaction',
    ]);
    expect(trace).toEqual(['partners OWNER TX_A ADDR_A ACC_B null']);
  });

  it('records a transfer to an account without a tracked leg', async () => {
    await record(ethOutTarget(), input({ type: 'transfer', accountId: ACC_B }), true);
    expect(inserted).toHaveLength(1);
    expect(trace).toEqual([
      'partners OWNER TX_A ADDR_A ACC_B null',
      'instrument ETH true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_B"} null ACC_A null null TRANSFER_NEW null true null null null null',
    ]);
  });

  it('keeps a transfer both legs still name, recognised as before', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    world.partners = [ethInRow(ADDR_B, TX_A, ACC_B)];
    const value = { type: 'transfer', accountId: ACC_B } as const;
    put(
      ADDR_A,
      TX_A,
      ethOut(ACC_A),
      live({
        type: 'transfer',
        details: value,
        transferId: TRANSFER_OLD,
        linkedAddressId: ADDR_B,
        automatic: true,
      }),
    );
    put(
      ADDR_B,
      TX_A,
      ethIn(ACC_B),
      answer({
        addressId: ADDR_B,
        txid: TX_A,
        version: 1,
        type: 'transfer',
        accountId: ACC_B,
        transferId: TRANSFER_OLD,
      }),
    );
    await record(ethOutTarget(1), input(value, { expectedVersion: 1, comment: 'new note' }));
    expect(inserted).toHaveLength(1);
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'transfer-head TRANSFER_OLD',
      'partners OWNER TX_A ADDR_A ACC_B null',
      'head ADDR_B TX_A',
      'version ADDR_B TX_A 1',
      'transfer-head TRANSFER_OLD',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_B"} new note ACC_A null null TRANSFER_OLD ADDR_B true null null null null',
    ]);
  });

  it('voids a shared transfer once when the link changes', async () => {
    world.transferHeads.set(TRANSFER_OLD, transferHead(ACC_A, ACC_B));
    world.partners = [ethInRow(ADDR_B, TX_A, ACC_B)];
    world.siblings = [{ addressId: ADDR_B, txid: TX_A }];
    const value = { type: 'transfer', accountId: ACC_B } as const;
    const shared = { type: 'transfer', transferId: TRANSFER_OLD } as const;
    put(ADDR_A, TX_A, ethOut(ACC_A), live({ ...shared, details: value }));
    put(
      ADDR_B,
      TX_A,
      ethIn(ACC_B),
      answer({ addressId: ADDR_B, txid: TX_A, version: 1, accountId: ACC_B, ...shared }),
    );
    await record(ethOutTarget(1), input(value, { expectedVersion: 1 }));
    expect(trace).toEqual([
      'version ADDR_A TX_A 1',
      'transfer-head TRANSFER_OLD',
      'partners OWNER TX_A ADDR_A ACC_B null',
      'head ADDR_B TX_A',
      'version ADDR_B TX_A 1',
      'transfer-head TRANSFER_OLD',
      'transfer-head TRANSFER_OLD',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.void OWNER void {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"expectedVersion":1} TRANSFER_OLD',
      'siblings OWNER TRANSFER_OLD ADDR_A TX_A',
      'instrument ETH true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#2","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_ETH","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","feeInstrumentId":"INST_ETH","feeQuantity":"0.001"}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"payload":true} classified transfer {"type":"transfer","accountId":"ACC_B"} null ACC_A null null TRANSFER_NEW ADDR_B false null null null null',
      'head-update ADDR_B TX_A 2',
      'version-insert OWNER ADDR_B TX_A 2 uuid#3 {"linkedTo":{"addressId":"ADDR_A","txid":"TX_A"},"accountId":"ACC_A","tradeId":null,"rewardId":null,"transferId":"TRANSFER_NEW","swapAccountId":null,"swapId":null} classified transfer {"type":"transfer","accountId":"ACC_A"} null ACC_B null null TRANSFER_NEW ADDR_A false null null null null',
    ]);
  });

  const paidPurchase = {
    accountId: ACC_B,
    side: 'buy',
    asset: 'BTC',
    cash: null,
    incoming: null,
    occurredAt: new Date('2026-03-01T12:00:00.000Z'),
    cashSpent: null,
    gross: '500',
    fee: '0',
    other: false,
  };
  const usdtOut = (): Target => ({
    address: ADDR_A,
    txid: TX_A,
    row: {
      network: 'ethereum',
      asset: 'USDT',
      accountId: ACC_A,
      blockTime: new Date('2026-03-01T10:00:00.000Z'),
      receivedUnits: '0',
      sentUnits: '500000000',
      feeUnits: '0',
      quoteAsset: null,
      hash: null,
    },
    version: 0,
  });
  const recorded = { type: 'recorded', operation: { kind: 'trade', id: OTHER_TRADE } };

  it('carries the coins to a purchase in another account and settles it', async () => {
    world.recordTrade = [paidPurchase];
    await record(usdtOut(), input(recorded));
    expect(trace).toEqual([
      'record-trade OWNER OTHER_TRADE',
      'instrument USDT true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_USDT","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"500","feeInstrumentId":null,"feeQuantity":"0"}',
      'trades.settle OWNER ACC_B OTHER_TRADE USDT',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified recorded {"type":"recorded","operation":{"kind":"trade","id":"OTHER_TRADE"}} null ACC_A null null TRANSFER_NEW null false null null null null',
    ]);
  });

  it('refuses to carry coins the wallet did not hold before the purchase', async () => {
    world.recordTrade = [paidPurchase];
    failNext('transfers.create', new ConflictException('refused'));
    expect(await refusal(record(usdtOut(), input(recorded)))).toEqual([
      'UnprocessableEntityException',
      'The wallet did not hold these coins yet when that purchase was made; check the purchase date',
    ]);
    expect(trace).toEqual([
      'record-trade OWNER OTHER_TRADE',
      'instrument USDT true',
      'journal ACC_A',
      'journal ACC_B',
      'transfers.create OWNER create {"requestId":"uuid#1","expectedFromJournalRevision":7,"expectedToJournalRevision":7,"fromAccountId":"ACC_A","toAccountId":"ACC_B","assertInternal":true,"instrumentId":"INST_USDT","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"500","feeInstrumentId":null,"feeQuantity":"0"}',
    ]);
  });

  it('records nothing for a movement recorded in the same account', async () => {
    world.recordTrade = [{ ...paidPurchase, accountId: ACC_A, asset: 'ETH', cash: 'USDT' }];
    await record(ethInTarget(), input(recorded));
    expect(trace).toEqual([
      'record-trade OWNER OTHER_TRADE',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified recorded {"type":"recorded","operation":{"kind":"trade","id":"OTHER_TRADE"}} null ACC_A null null null null null null null null null',
    ]);
  });

  it('refuses a recorded swap of another account', async () => {
    world.recordSwap = [{ ...paidPurchase, side: null, occurredAt: null }];
    expect(
      await refusal(
        record(ethInTarget(), input({ type: 'recorded', operation: { kind: 'swap', id: RECORD } })),
      ),
    ).toEqual(['UnprocessableEntityException', 'Choose an operation of this wallet']);
    expect(trace).toEqual(['record-swap OWNER RECORD']);
  });

  const deposit = (): LegRow => ({
    ...ethOut(ACC_A, '2026-02-01T10:00:00.000Z'),
    sentUnits: '2001000000000000000',
  });
  const withdrawal = (): Target => ({
    address: ADDR_A,
    txid: TX_A,
    row: { ...ethIn(ACC_A), receivedUnits: '2500000000000000000' },
    version: 0,
  });
  const poolValue = { type: 'pool-withdrawal', deposit: { addressId: ADDR_C, txid: TX_C } };

  it('records the gain of a pool withdrawal at the stored price and names its deposit', async () => {
    world.prices.set('ETH', '3000');
    put(
      ADDR_C,
      TX_C,
      deposit(),
      answer({ addressId: ADDR_C, txid: TX_C, version: 1, type: 'pool-deposit' }),
    );
    await record(withdrawal(), input({ ...poolValue, valueUsd: null }));
    expect(trace).toEqual([
      'withdrawals OWNER ADDR_C TX_C ADDR_A TX_A',
      'leg OWNER ADDR_C TX_C',
      'head ADDR_C TX_C',
      'version ADDR_C TX_C 1',
      'withdrawals OWNER ADDR_C TX_C ADDR_A TX_A',
      'prices [{"asset":"ETH","at":"2026-03-01T10:00:00.000Z"}]',
      'instrument ETH true',
      'journal ACC_A',
      'rewards.create OWNER ACC_A create {"requestId":"uuid#1","expectedJournalRevision":7,"assertReward":true,"instrumentId":"INST_ETH","category":"other","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"0.5","acquisitionBasisUsd":"1500","incomeValueUsd":"1500"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"payload":true} classified pool-withdrawal {"type":"pool-withdrawal","deposit":{"addressId":"ADDR_C","txid":"TX_C"},"valueUsd":null} null ACC_A null REWARD_NEW null null null null null ADDR_C TX_C',
    ]);
  });

  it('refuses a withdrawal under which a later one returns the deposit', async () => {
    put(
      ADDR_C,
      TX_C,
      deposit(),
      answer({ addressId: ADDR_C, txid: TX_C, version: 1, type: 'pool-deposit' }),
    );
    world.withdrawals.set(at(ADDR_C, TX_C), [
      { ...ethInRow(ADDR_B, TX_B, ACC_A, '2026-03-02T10:00:00.000Z'), partial: true },
    ]);
    expect(await refusal(record(withdrawal(), input({ ...poolValue, valueUsd: '1' })))).toEqual([
      'UnprocessableEntityException',
      'A later withdrawal already returns part of this deposit; change it first',
    ]);
    expect(trace).toEqual(['withdrawals OWNER ADDR_C TX_C ADDR_A TX_A']);
  });

  it('hands a swap of two legs to recordSwap and one of a record to recordSwapOfRecord', async () => {
    const both = jest.fn(async () => answer({ addressId: ADDR_A, txid: TX_A, version: 1 }));
    const ofRecord = jest.fn(async () => answer({ addressId: ADDR_A, txid: TX_A, version: 2 }));
    internals.recordSwap = both;
    internals.recordSwapOfRecord = ofRecord;
    const target = ethOutTarget();
    expect((await record(target, input(swapWith()))).version).toBe(1);
    expect((await record(target, input(recordSwapValue()))).version).toBe(2);
    expect(both.mock.calls).toEqual([
      [manager, OWNER, target, input(swapWith()), PAYLOAD, swapWith()],
    ]);
    expect(ofRecord.mock.calls).toEqual([
      [manager, OWNER, target, input(recordSwapValue()), PAYLOAD, recordSwapValue()],
    ]);
    expect(trace).toEqual([]);
  });
});

const TX_BYBIT = 'bybit-trade-T1';
const bybitBuy = (): LegRow => ({
  network: 'bybit',
  asset: 'BTC',
  accountId: ACC_A,
  blockTime: new Date('2026-03-01T10:00:00.000Z'),
  receivedUnits: '10000000000000000',
  sentUnits: '0',
  feeUnits: '0',
  quoteAsset: 'USDT',
  hash: null,
});
const replaces = { kind: 'trade', id: RECORD, version: 3 };

describe('classify: one answer, checked first, then written in one transaction', () => {
  const raw = (classification: unknown, extra: Record<string, unknown> = {}) => ({
    requestId: REQUEST,
    expectedVersion: 0,
    hidden: false,
    classification,
    ...extra,
  });
  const classify = (body: unknown, txid = TX_A) => service.classify(OWNER, ADDR_A, txid, body);

  beforeEach(() => {
    jest.spyOn(service, 'linkQuietly').mockImplementation(async (owner) => {
      note('link-quietly', owner);
    });
    put(ADDR_A, TX_A, ethIn(ACC_A));
  });

  it.each([
    [
      'an owner that is not a UUID, before the transaction id',
      () => service.classify('owner', ADDR_A, 'nope', raw(null)),
      'BadRequestException',
      'Invalid accounting input',
    ],
    [
      'an address that is not a UUID',
      () => service.classify(OWNER, 'address', TX_A, raw(null)),
      'BadRequestException',
      'Invalid accounting input',
    ],
    [
      'a transaction id of no chain, before the answer',
      () => classify({}, 'nope'),
      'NotFoundException',
      'Not Found',
    ],
    [
      'a malformed answer',
      () => classify(raw(null, { expectedVersion: -1 })),
      'BadRequestException',
      'Invalid accounting input',
    ],
    [
      'a replacement that hides',
      () => classify(raw({ type: 'other' }, { hidden: true, replaces })),
      'BadRequestException',
      'Invalid accounting input',
    ],
    [
      'a replacement that clears',
      () => classify(raw(null, { replaces })),
      'BadRequestException',
      'Invalid accounting input',
    ],
    [
      'a replacement by a swap against a record',
      () =>
        classify(
          raw(
            {
              type: 'swap',
              record: { kind: 'trade', id: OTHER_TRADE, version: 1 },
              valueUsd: null,
            },
            { replaces },
          ),
        ),
      'BadRequestException',
      'Invalid accounting input',
    ],
  ])('refuses %s before reading anything', async (_name, call, kind, message) => {
    expect(await refusal(call())).toEqual([kind, message]);
    expect(trace).toEqual([]);
  });

  it.each([
    [
      'a pool withdrawal of a send',
      ethOut(ACC_A),
      { type: 'pool-withdrawal', deposit: { addressId: ADDR_C, txid: TX_C }, valueUsd: null },
    ],
    ['a pool deposit of a receipt', ethIn(ACC_A), { type: 'pool-deposit' }],
    ['a sale of a receipt', ethIn(ACC_A), { type: 'sell', currency: 'USD', amount: '1' }],
    [
      'a pool deposit of only a fee',
      { ...ethOut(ACC_A), sentUnits: '1000000000000000' },
      { type: 'pool-deposit' },
    ],
  ])('refuses %s after reading the leg only', async (_name, row, classification) => {
    put(ADDR_A, TX_A, row as LegRow);
    expect(await refusal(classify(raw(classification)))).toEqual([
      'UnprocessableEntityException',
      'This type does not fit the direction of the transaction',
    ]);
    expect(trace).toEqual(['leg OWNER ADDR_A TX_A']);
  });

  it('refuses a fee without a value or stored price before the transaction', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A));
    expect(await refusal(classify(raw({ type: 'fee', valueUsd: null })))).toEqual([
      'UnprocessableEntityException',
      'No stored price for this coin at that time',
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'prices [{"asset":"ETH","at":"2026-03-01T10:00:00.000Z"}]',
    ]);
  });

  it('returns the saved answer of a repeated request without writing', async () => {
    const body = raw({ type: 'other' });
    const replay = answer({
      addressId: ADDR_A,
      txid: TX_A,
      version: 1,
      canonicalPayload: classificationPayload(ADDR_A, TX_A, parseClassification(body)),
    });
    world.replay = [replay];
    expect(await classify(body)).toEqual({ created: false, value: classificationView(replay) });
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'commit',
    ]);
  });

  it('refuses a repeated request that says something else', async () => {
    world.replay = [answer({ addressId: ADDR_A, txid: TX_A, version: 1 })];
    expect(await refusal(classify(raw({ type: 'other' })))).toEqual([
      'ConflictException',
      'Classification request conflicts with saved state',
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'rollback',
    ]);
  });

  it('refuses an answer to a version the owner did not see', async () => {
    expect(await refusal(classify(raw({ type: 'other' }, { expectedVersion: 1 })))).toEqual([
      'ConflictException',
      'Classification request conflicts with saved state',
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'rollback',
    ]);
  });

  it('refuses any answer to a deleted record', async () => {
    put(ADDR_A, TX_A, ethIn(ACC_A), live({ status: 'deleted' }));
    expect(await refusal(classify(raw({ type: 'other' }, { expectedVersion: 1 })))).toEqual([
      'NotFoundException',
      'Not Found',
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'version ADDR_A TX_A 1',
      'rollback',
    ]);
  });

  it('records a new answer, then links quietly', async () => {
    put(ADDR_A, TX_A, ethIn(ACC_A), live({ status: 'unclassified' }));
    const result = await classify(raw({ type: 'other' }, { expectedVersion: 1 }));
    expect(result).toEqual({ created: true, value: classificationView(inserted[0]) });
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'version ADDR_A TX_A 1',
      'version ADDR_A TX_A 1',
      'instrument ETH true',
      'journal ACC_A',
      'rewards.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertReward":true,"instrumentId":"INST_ETH","category":"unclassified","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","acquisitionBasisUsd":null,"incomeValueUsd":null}',
      'head-update ADDR_A TX_A 2',
      'version-insert OWNER ADDR_A TX_A 2 REQUEST {"addressId":"ADDR_A","txid":"TX_A","expectedVersion":1,"hidden":false,"classification":{"type":"other"}} classified other {"type":"other"} null ACC_A null REWARD_NEW null null null null null null null',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('refuses a Bybit buy paid in a quote coin the records do not hold yet', async () => {
    put(ADDR_A, TX_BYBIT, bybitBuy());
    world.available = '599.99';
    expect(
      await refusal(classify(raw({ type: 'buy', currency: 'USDT', amount: '600' }), TX_BYBIT)),
    ).toEqual([
      'ConflictException',
      "The account's records do not hold the USDT this trade paid with yet; answer the USDT deposit or transfer first",
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A bybit-trade-T1',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A bybit-trade-T1',
      'head ADDR_A bybit-trade-T1',
      'instrument USDT false',
      'journal ACC_A',
      'ledger ["ACC_A"]',
      'available ACC_A INST_USDT 2026-03-01T10:00:00.000Z',
      'rollback',
    ]);
  });

  it('records a Bybit buy paid in a quote coin the records hold', async () => {
    put(ADDR_A, TX_BYBIT, bybitBuy());
    world.available = '600';
    await classify(raw({ type: 'buy', currency: 'USDT', amount: '600' }), TX_BYBIT);
    expect(trace).toEqual([
      'leg OWNER ADDR_A bybit-trade-T1',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A bybit-trade-T1',
      'head ADDR_A bybit-trade-T1',
      'instrument USDT false',
      'journal ACC_A',
      'ledger ["ACC_A"]',
      'available ACC_A INST_USDT 2026-03-01T10:00:00.000Z',
      'instrument BTC true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#3","expectedJournalRevision":7,"instrumentId":"INST_BTC","side":"buy","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"0.01","grossUsd":"600","feeUsd":"0","settlementCurrency":"USDT"}',
      'head-insert OWNER ADDR_A bybit-trade-T1 1',
      'version-insert OWNER ADDR_A bybit-trade-T1 1 REQUEST {"addressId":"ADDR_A","txid":"bybit-trade-T1","expectedVersion":0,"hidden":false,"classification":{"type":"buy","currency":"USDT","amount":"600"}} classified buy {"type":"buy","currency":"USDT","amount":"600"} null ACC_A TRADE_NEW null null null null null null null null',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('records a Bybit buy paid in another coin without asking the records', async () => {
    put(ADDR_A, TX_BYBIT, bybitBuy());
    await classify(raw({ type: 'buy', currency: 'USD', amount: '600' }), TX_BYBIT);
    expect(trace).toEqual([
      'leg OWNER ADDR_A bybit-trade-T1',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A bybit-trade-T1',
      'head ADDR_A bybit-trade-T1',
      'instrument BTC true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#3","expectedJournalRevision":7,"instrumentId":"INST_BTC","side":"buy","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"0.01","grossUsd":"600","feeUsd":"0","settlementCurrency":"USD"}',
      'head-insert OWNER ADDR_A bybit-trade-T1 1',
      'version-insert OWNER ADDR_A bybit-trade-T1 1 REQUEST {"addressId":"ADDR_A","txid":"bybit-trade-T1","expectedVersion":0,"hidden":false,"classification":{"type":"buy","currency":"USD","amount":"600"}} classified buy {"type":"buy","currency":"USD","amount":"600"} null ACC_A TRADE_NEW null null null null null null null null',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('voids a replaced purchase before the answer that takes its place', async () => {
    const value = { type: 'buy', currency: 'USD', amount: '3000' };
    world.records = [
      purchase({ coin: 'ETH', atoms: 10n ** 30n, answer: value as OwnRecord['answer'] }),
    ];
    await classify(raw(value, { replaces }));
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'own-records ["ACC_A"]',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#3","expectedJournalRevision":7}',
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#4","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"buy","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","grossUsd":"3000","feeUsd":"0","settlementCurrency":"USD"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"addressId":"ADDR_A","txid":"TX_A","expectedVersion":0,"hidden":false,"classification":{"type":"buy","currency":"USD","amount":"3000"},"replaces":{"kind":"trade","id":"RECORD","version":3}} classified buy {"type":"buy","currency":"USD","amount":"3000"} null ACC_A TRADE_NEW null null null null null null null null',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('voids a replaced send before the answer that takes its place', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A));
    const value = { type: 'expense', valueUsd: '10' };
    world.records = [
      purchase({
        coin: 'ETH',
        inbound: false,
        atoms: 1001n * 10n ** 27n,
        answer: value as OwnRecord['answer'],
      }),
    ];
    await classify(raw(value, { replaces }));
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'own-records ["ACC_A"]',
      'journal ACC_A',
      'trades.void OWNER ACC_A void RECORD {"requestId":"uuid#3","expectedJournalRevision":7}',
      'instrument ETH true',
      'journal ACC_A',
      'trades.create OWNER ACC_A create undefined {"requestId":"uuid#4","expectedJournalRevision":7,"instrumentId":"INST_ETH","side":"sell","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1.001","grossUsd":"10","feeUsd":"0","purpose":"expense"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"addressId":"ADDR_A","txid":"TX_A","expectedVersion":0,"hidden":false,"classification":{"type":"expense","valueUsd":"10"},"replaces":{"kind":"trade","id":"RECORD","version":3}} classified expense {"type":"expense","valueUsd":"10"} null ACC_A TRADE_NEW null null null null null null null null',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('writes the answer before voiding a replaced reward of a receipt', async () => {
    const value = { type: 'reward', valueUsd: '10' };
    world.rewardHeads.set(RECORD, { version: 3, kind: 'create' });
    world.records = [
      purchase({
        kind: 'reward',
        coin: 'ETH',
        atoms: 10n ** 30n,
        answer: value as OwnRecord['answer'],
      }),
    ];
    await classify(raw(value, { replaces: { ...replaces, kind: 'reward' } }));
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'own-records ["ACC_A"]',
      'instrument ETH true',
      'journal ACC_A',
      'rewards.create OWNER ACC_A create {"requestId":"uuid#3","expectedJournalRevision":7,"assertReward":true,"instrumentId":"INST_ETH","category":"other","occurredAt":"2026-03-01T10:00:00.000Z","orderWithinTimestamp":null,"quantity":"1","acquisitionBasisUsd":"10","incomeValueUsd":"10"}',
      'head-insert OWNER ADDR_A TX_A 1',
      'version-insert OWNER ADDR_A TX_A 1 REQUEST {"addressId":"ADDR_A","txid":"TX_A","expectedVersion":0,"hidden":false,"classification":{"type":"reward","valueUsd":"10"},"replaces":{"kind":"reward","id":"RECORD","version":3}} classified reward {"type":"reward","valueUsd":"10"} null ACC_A null REWARD_NEW null null null null null null null',
      'journal ACC_A',
      'reward-head ACC_A RECORD',
      'rewards.void OWNER ACC_A void {"requestId":"uuid#4","expectedJournalRevision":7,"expectedVersion":3} RECORD',
      'commit',
      'link-quietly OWNER',
    ]);
  });

  it('turns an invalid replacement found in the transaction into a conflict', async () => {
    put(ADDR_A, TX_A, ethIn(null));
    expect(await refusal(classify(raw({ type: 'other' }, { replaces })))).toEqual([
      'ConflictException',
      'Accounting history conflicts with saved state',
    ]);
    expect(trace).toEqual([
      'leg OWNER ADDR_A TX_A',
      'begin',
      'lock OWNER',
      'replay OWNER REQUEST',
      'leg OWNER ADDR_A TX_A',
      'head ADDR_A TX_A',
      'rollback',
    ]);
  });

  it('refuses a replaced record that answers otherwise', async () => {
    world.records = [purchase({ coin: 'ETH', atoms: 10n ** 30n })];
    expect(
      await refusal(classify(raw({ type: 'buy', currency: 'USD', amount: '1' }, { replaces }))),
    ).toEqual(['ConflictException', 'That record changed; reload and try again']);
  });
});

describe('linkOwnTransfers: certain transfers between own accounts, each in its own transaction', () => {
  const matched = (addressId: string, accountId: string, units: Partial<LegRow>) => ({
    txid: TX_A,
    addressId,
    network: 'ethereum',
    asset: null,
    accountId,
    receivedUnits: '0',
    sentUnits: '0',
    feeUnits: '0',
    status: null,
    hash: null,
    loneTo: null,
    ...units,
  });
  const lone = (address: string, accountId: string, version: number, toAccount: string) =>
    answer({
      addressId: address,
      txid: TX_A,
      version,
      type: 'transfer',
      accountId,
      transferId: TRANSFER_OLD,
      details: { type: 'transfer', accountId: toAccount },
    });
  const unclassified = (address: string, version: number) =>
    answer({ addressId: address, txid: TX_A, version, status: 'unclassified' });

  beforeEach(() => {
    const out = ethOut(ACC_A);
    const arrived = ethIn(ACC_B);
    world.matchLegs = [matched(ADDR_A, ACC_A, out), matched(ADDR_B, ACC_B, arrived)];
    world.legs.set(at(ADDR_A, TX_A), out);
    world.legs.set(at(ADDR_B, TX_A), arrived);
    internals.record = jest.fn(async (_m, _o, target, value, payload, automatic) => {
      note('record', target.address, target.txid, target.version, value, payload, automatic);
      return answer({ addressId: target.address, txid: target.txid, version: 1 });
    });
  });

  it('answers the send when neither side has an answer', async () => {
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 1 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'record ADDR_A TX_A 0 {"requestId":"uuid#1","expectedVersion":0,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_B"}} {"automatic":true,"addressId":"ADDR_A","txid":"TX_A","expectedVersion":0,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_B"}} true',
      'commit',
    ]);
  });

  it('leaves a pair whose leg moved to another account meanwhile', async () => {
    world.legs.set(at(ADDR_B, TX_A), ethIn(ACC_C));
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 0 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'commit',
    ]);
  });

  it('answers the send when the receipt is a lone transfer from its account', async () => {
    put(ADDR_B, TX_A, ethIn(ACC_B), unclassified(ADDR_B, 1), lone(ADDR_B, ACC_B, 2, ACC_A));
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 1 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'version ADDR_B TX_A 2',
      'version ADDR_B TX_A 2',
      'record ADDR_A TX_A 0 {"requestId":"uuid#1","expectedVersion":0,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_B"}} {"automatic":true,"addressId":"ADDR_A","txid":"TX_A","expectedVersion":0,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_B"}} true',
      'commit',
    ]);
  });

  it('answers the receipt when the send is a lone transfer to its account', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), lone(ADDR_A, ACC_A, 1, ACC_B));
    put(ADDR_B, TX_A, ethIn(ACC_B), unclassified(ADDR_B, 1));
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 1 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'version ADDR_A TX_A 1',
      'version ADDR_B TX_A 1',
      'version ADDR_A TX_A 1',
      'record ADDR_B TX_A 1 {"requestId":"uuid#1","expectedVersion":1,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_A"}} {"automatic":true,"addressId":"ADDR_B","txid":"TX_A","expectedVersion":1,"hidden":false,"classification":{"type":"transfer","accountId":"ACC_A"}} true',
      'commit',
    ]);
  });

  it('leaves a pair whose receipt has another answer', async () => {
    put(ADDR_B, TX_A, ethIn(ACC_B), lone(ADDR_B, ACC_B, 1, ACC_C));
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 0 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'version ADDR_B TX_A 1',
      'version ADDR_B TX_A 1',
      'commit',
    ]);
  });

  it('leaves a pair whose send has another answer and whose receipt has none', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), { ...lone(ADDR_A, ACC_A, 1, ACC_B), linkedAddressId: ADDR_C });
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 0 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'version ADDR_A TX_A 1',
      'version ADDR_A TX_A 1',
      'commit',
    ]);
  });

  it('leaves a pair where both sides have answers', async () => {
    put(ADDR_A, TX_A, ethOut(ACC_A), lone(ADDR_A, ACC_A, 1, ACC_B));
    put(ADDR_B, TX_A, ethIn(ACC_B), lone(ADDR_B, ACC_B, 1, ACC_A));
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 0 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'version ADDR_A TX_A 1',
      'version ADDR_B TX_A 1',
      'commit',
    ]);
  });

  it('counts nothing for a pair the books refuse', async () => {
    internals.record = jest.fn(async () => {
      throw new ConflictException('refused');
    });
    expect(await service.linkOwnTransfers(OWNER)).toEqual({ linked: 0 });
    expect(trace).toEqual([
      'match-legs OWNER',
      'begin',
      'lock OWNER',
      'leg OWNER ADDR_A TX_A',
      'leg OWNER ADDR_B TX_A',
      'head ADDR_A TX_A',
      'head ADDR_B TX_A',
      'rollback',
    ]);
  });
});

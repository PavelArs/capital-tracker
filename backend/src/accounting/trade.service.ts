import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  type Execution,
  FifoHistoryError,
  type FifoResult,
  type FifoTrade,
  calculateFifo,
} from './fifo';
import { parseDecimal, parseUuid } from './input';
import {
  type TradeCreateInput,
  type TradePageQuery,
  type TradeVoidInput,
  parseJournalInitialization,
  parseTradeCorrection,
  parseTradeCreate,
  parseTradeHistoryQuery,
  parseTradePageQuery,
  parseTradeVoid,
} from './trade-input';

type Kind = 'create' | 'correct' | 'void';
interface AccountRow {
  id: string;
  currentRevision: number | null;
}
interface JournalRow {
  accountId: string;
  requestId: string;
  canonicalPayload: string;
  originKind: 'declared-empty';
  coverageFrom: Date;
  createdAt: Date;
  currentRevision: number;
}
interface VersionRow {
  tradeId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  canonicalPayload: string;
  kind: Kind;
  createdAt: Date;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  side: 'buy' | 'sell';
  occurredAt: Date;
  orderWithinTimestamp: number;
  quantity: string;
  grossUsd: string;
  feeUsd: string;
}
export interface JournalOrigin {
  accountId: string;
  requestId: string;
  originKind: 'declared-empty';
  coverageFrom: string;
  createdAt: string;
}
export interface TradeVersion extends FifoTrade {
  journalRevision: number;
  requestId: string;
  kind: Kind;
  createdAt: string;
}
export interface TradeReceipt {
  accountId: string;
  journalRevision: number;
  trade: TradeVersion;
}
export interface JournalState {
  accountId: string;
  eligible: boolean;
  ineligibilityReason: 'opening-history' | 'already-initialized' | null;
  journal:
    | (JournalOrigin & {
        journalRevision: number;
        activeTradeCount: number;
        versionCount: number;
        limits: { activeTrades: number; versions: number };
        summary: FifoResult['summary'];
      })
    | null;
}
interface CurrentSnapshot {
  journal: JournalRow;
  heads: TradeVersion[];
  fifo: FifoResult;
}
const conflict = () => new ConflictException('Trade request conflicts with saved state');
const versionSelect = `SELECT v.*, i.name AS "instrumentName", i.symbol AS "instrumentSymbol"
  FROM account_trade_versions v JOIN accounting_instruments i
  ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"`;

function execution(value: Execution): Execution {
  return {
    instrumentId: value.instrumentId,
    side: value.side,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    grossUsd: value.grossUsd,
    feeUsd: value.feeUsd,
  };
}
function origin(row: JournalRow): JournalOrigin {
  return {
    accountId: row.accountId,
    requestId: row.requestId,
    originKind: row.originKind,
    coverageFrom: row.coverageFrom.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
function version(row: VersionRow): TradeVersion {
  return {
    tradeId: row.tradeId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    instrumentSymbol: row.instrumentSymbol,
    side: row.side,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    quantity: parseDecimal(row.quantity, true),
    grossUsd: parseDecimal(row.grossUsd, true),
    feeUsd: parseDecimal(row.feeUsd, false),
  };
}
function receipt(accountId: string, trade: TradeVersion): TradeReceipt {
  return { accountId, journalRevision: trade.journalRevision, trade };
}
function calculate(heads: readonly (FifoTrade & { kind: Kind })[]): FifoResult {
  try {
    return calculateFifo(heads.filter((head) => head.kind !== 'void'));
  } catch (error) {
    if (error instanceof FifoHistoryError) throw conflict();
    throw error;
  }
}
function page<T>(snapshot: CurrentSnapshot, items: readonly T[], query: TradePageQuery) {
  const end = query.offset + query.limit;
  return {
    journalRevision: snapshot.journal.currentRevision,
    items: items.slice(query.offset, end),
    nextOffset: end < items.length ? end : null,
  };
}

@Injectable()
export class TradeService {
  constructor(private readonly source: DataSource) {}

  async initialize(ownerId: string, accountId: string, input: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const value = parseJournalInitialization(input);
    const payload = JSON.stringify({ coverageFrom: value.coverageFrom, assertEmpty: true });
    return this.source.transaction(async (manager) => {
      const account = await this.account(manager, owner, id, true);
      const previous = await this.journal(manager, owner, id);
      if (previous) {
        if (previous.requestId !== value.requestId || previous.canonicalPayload !== payload)
          throw conflict();
        return { created: false, value: origin(previous) };
      }
      if (account.currentRevision !== null || (await this.hasOpening(manager, owner, id)))
        throw conflict();
      const [row]: JournalRow[] = await manager.query(
        `INSERT INTO account_trade_journals
        ("ownerId","accountId","requestId","canonicalPayload","originKind","coverageFrom","createdAt","currentRevision")
        VALUES ($1,$2,$3,$4,'declared-empty',$5,clock_timestamp(),0) RETURNING *`,
        [owner, id, value.requestId, payload, value.coverageFrom],
      );
      return { created: true, value: origin(row) };
    });
  }

  async create(ownerId: string, accountId: string, input: unknown) {
    return this.mutate(
      parseUuid(ownerId),
      parseUuid(accountId),
      'create',
      undefined,
      parseTradeCreate(input),
    );
  }
  async correct(ownerId: string, accountId: string, tradeId: string, input: unknown) {
    return this.mutate(
      parseUuid(ownerId),
      parseUuid(accountId),
      'correct',
      parseUuid(tradeId),
      parseTradeCorrection(input),
    );
  }
  async void(ownerId: string, accountId: string, tradeId: string, input: unknown) {
    return this.mutate(
      parseUuid(ownerId),
      parseUuid(accountId),
      'void',
      parseUuid(tradeId),
      parseTradeVoid(input),
    );
  }

  private async mutate(
    owner: string,
    id: string,
    kind: Kind,
    target: string | undefined,
    value: TradeCreateInput | TradeVoidInput,
  ): Promise<{ created: boolean; value: TradeReceipt }> {
    const fields = kind === 'void' ? undefined : execution(value as TradeCreateInput);
    const payload = JSON.stringify({
      kind,
      ...(target === undefined ? {} : { tradeId: target }),
      expectedJournalRevision: value.expectedJournalRevision,
      ...fields,
    });
    return this.source.transaction(async (manager) => {
      await this.account(manager, owner, id, true);
      const journal = await this.journal(manager, owner, id);
      if (!journal) throw conflict();
      const [previous]: VersionRow[] = await manager.query(
        `${versionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
        [owner, id, value.requestId],
      );
      if (previous) {
        if (previous.canonicalPayload !== payload) throw conflict();
        return { created: false, value: receipt(id, version(previous)) };
      }
      const heads = await this.heads(manager, owner, id);
      const current =
        target === undefined ? undefined : heads.find((head) => head.tradeId === target);
      if (target !== undefined && !current) throw new NotFoundException();
      let nextExecution: Execution;
      let labels: { instrumentName: string; instrumentSymbol: string | null };
      if (fields) {
        const [instrument]: { name: string; symbol: string | null }[] = await manager.query(
          'SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2',
          [owner, fields.instrumentId],
        );
        if (!instrument) throw new NotFoundException();
        nextExecution = fields;
        labels = { instrumentName: instrument.name, instrumentSymbol: instrument.symbol };
      } else {
        if (!current) throw new NotFoundException();
        nextExecution = execution(current);
        labels = {
          instrumentName: current.instrumentName,
          instrumentSymbol: current.instrumentSymbol,
        };
      }
      if (
        current?.kind === 'void' ||
        journal.currentRevision !== value.expectedJournalRevision ||
        journal.currentRevision >= 10000
      )
        throw conflict();
      if (nextExecution.occurredAt < journal.coverageFrom.toISOString()) throw conflict();
      const tradeId = target ?? randomUUID();
      const next = {
        ...nextExecution,
        ...labels,
        tradeId,
        version: (current?.version ?? 0) + 1,
        journalRevision: journal.currentRevision + 1,
        requestId: value.requestId,
        kind,
      };
      calculate([...heads.filter((head) => head.tradeId !== tradeId), next]);
      if (kind === 'create') {
        await manager.query(
          `INSERT INTO account_trades (id,"ownerId","accountId","currentVersion","createdAt")
          VALUES ($1,$2,$3,1,clock_timestamp())`,
          [tradeId, owner, id],
        );
      }
      const [saved]: VersionRow[] = await manager.query(
        `INSERT INTO account_trade_versions
        ("ownerId","accountId","tradeId",version,"journalRevision","requestId","canonicalPayload",kind,
        "instrumentId",side,"occurredAt","orderWithinTimestamp",quantity,"grossUsd","feeUsd","createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,clock_timestamp()) RETURNING *`,
        [
          owner,
          id,
          tradeId,
          next.version,
          next.journalRevision,
          value.requestId,
          payload,
          kind,
          next.instrumentId,
          next.side,
          next.occurredAt,
          next.orderWithinTimestamp,
          next.quantity,
          next.grossUsd,
          next.feeUsd,
        ],
      );
      await manager.query(
        'UPDATE account_trades SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
        [owner, id, tradeId, next.version],
      );
      await manager.query(
        'UPDATE account_trade_journals SET "currentRevision"=$3 WHERE "ownerId"=$1 AND "accountId"=$2',
        [owner, id, next.journalRevision],
      );
      return { created: true, value: receipt(id, version({ ...saved, ...labels })) };
    });
  }

  async getJournal(ownerId: string, accountId: string): Promise<JournalState> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    return this.read(async (manager) => {
      const account = await this.account(manager, owner, id);
      const journal = await this.journal(manager, owner, id);
      if (!journal) {
        const ineligible =
          account.currentRevision !== null || (await this.hasOpening(manager, owner, id));
        return {
          accountId: id,
          eligible: !ineligible,
          ineligibilityReason: ineligible ? 'opening-history' : null,
          journal: null,
        };
      }
      const heads = await this.heads(manager, owner, id);
      const fifo = calculate(heads);
      return {
        accountId: id,
        eligible: false,
        ineligibilityReason: 'already-initialized',
        journal: {
          ...origin(journal),
          journalRevision: journal.currentRevision,
          activeTradeCount: heads.filter((head) => head.kind !== 'void').length,
          versionCount: journal.currentRevision,
          limits: { activeTrades: 1000, versions: 10000 },
          summary: fifo.summary,
        },
      };
    });
  }

  async listTrades(ownerId: string, accountId: string, rawQuery: unknown = {}) {
    const query = parseTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) =>
      page(snapshot, snapshot.heads, query),
    );
  }
  async listLots(ownerId: string, accountId: string, rawQuery: unknown = {}) {
    const query = parseTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) =>
      page(snapshot, snapshot.fifo.lots, query),
    );
  }
  async listRealizations(ownerId: string, accountId: string, rawQuery: unknown = {}) {
    const query = parseTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) =>
      page(snapshot, snapshot.fifo.realizations, query),
    );
  }
  async listMatches(ownerId: string, accountId: string, tradeId: string, rawQuery: unknown = {}) {
    const target = parseUuid(tradeId);
    const query = parseTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) => {
      const head = snapshot.heads.find((item) => item.tradeId === target);
      if (!head) throw new NotFoundException();
      if (head.kind === 'void' || head.side !== 'sell') throw conflict();
      return page(
        snapshot,
        snapshot.fifo.matches.filter((match) => match.sellTradeId === target),
        query,
      );
    });
  }
  async listVersions(ownerId: string, accountId: string, tradeId: string, rawQuery: unknown = {}) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const target = parseUuid(tradeId);
    const query = parseTradeHistoryQuery(rawQuery);
    return this.read(async (manager) => {
      await this.account(manager, owner, id);
      if (!(await this.journal(manager, owner, id))) throw conflict();
      const [trade] = await manager.query(
        'SELECT id FROM account_trades WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
        [owner, id, target],
      );
      if (!trade) throw new NotFoundException();
      const rows: VersionRow[] = await manager.query(
        `${versionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."tradeId"=$3
        AND ($4::int IS NULL OR v.version<$4) ORDER BY v.version DESC LIMIT $5`,
        [owner, id, target, query.beforeVersion ?? null, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(version);
      return {
        tradeId: target,
        items,
        nextBeforeVersion: rows.length > query.limit ? items[items.length - 1].version : null,
      };
    });
  }

  private current<T>(
    ownerId: string,
    accountId: string,
    query: TradePageQuery,
    project: (snapshot: CurrentSnapshot) => T,
  ): Promise<T> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    return this.read(async (manager) => {
      await this.account(manager, owner, id);
      const journal = await this.journal(manager, owner, id);
      if (
        !journal ||
        (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
      )
        throw conflict();
      const heads = await this.heads(manager, owner, id);
      return project({ journal, heads, fifo: calculate(heads) });
    });
  }
  private read<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return run(manager);
    });
  }
  private async account(
    manager: EntityManager,
    owner: string,
    id: string,
    lock = false,
  ): Promise<AccountRow> {
    const [account]: AccountRow[] = await manager.query(
      `SELECT id,"currentRevision" FROM manual_accounts WHERE "ownerId"=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
      [owner, id],
    );
    if (!account) throw new NotFoundException();
    return account;
  }
  private async journal(
    manager: EntityManager,
    owner: string,
    id: string,
  ): Promise<JournalRow | undefined> {
    const [journal]: JournalRow[] = await manager.query(
      'SELECT * FROM account_trade_journals WHERE "ownerId"=$1 AND "accountId"=$2',
      [owner, id],
    );
    return journal;
  }
  private async hasOpening(manager: EntityManager, owner: string, id: string): Promise<boolean> {
    const [row]: { present: boolean }[] = await manager.query(
      'SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2) AS present',
      [owner, id],
    );
    return row.present;
  }
  private async heads(manager: EntityManager, owner: string, id: string): Promise<TradeVersion[]> {
    const rows: VersionRow[] = await manager.query(
      `${versionSelect} JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accountId"
      AND t.id=v."tradeId" AND t."currentVersion"=v.version
      WHERE v."ownerId"=$1 AND v."accountId"=$2 ORDER BY v."occurredAt",v."orderWithinTimestamp",v."tradeId"`,
      [owner, id],
    );
    return rows.map(version);
  }
}

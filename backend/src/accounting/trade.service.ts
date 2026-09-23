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
import { parseUuid } from './input';
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

import {
  type JournalRow,
  type TradeKind as Kind,
  type TradeVersion,
  type VersionRow,
  advanceJournal,
  appendTradeVersion,
  projectTradeVersion,
  readJournal,
  readOwnedAccount,
  readTradeHeads,
  versionSelect,
} from './trade-journal.store';
export type { TradeVersion } from './trade-journal.store';

export interface JournalOrigin {
  accountId: string;
  requestId: string;
  originKind: 'declared-empty';
  coverageFrom: string;
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
      const account = await readOwnedAccount(manager, owner, id, true);
      const previous = await readJournal(manager, owner, id);
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
      await readOwnedAccount(manager, owner, id, true);
      const journal = await readJournal(manager, owner, id);
      if (!journal) throw conflict();
      const [previous]: VersionRow[] = await manager.query(
        `${versionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
        [owner, id, value.requestId],
      );
      if (previous) {
        if (previous.canonicalPayload !== payload) throw conflict();
        return { created: false, value: receipt(id, projectTradeVersion(previous)) };
      }
      const heads = await readTradeHeads(manager, owner, id);
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
      const saved = await appendTradeVersion(manager, owner, id, {
        ...next,
        canonicalPayload: payload,
      });
      await advanceJournal(manager, owner, id, next.journalRevision);
      return { created: true, value: receipt(id, saved) };
    });
  }

  async getJournal(ownerId: string, accountId: string): Promise<JournalState> {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    return this.read(async (manager) => {
      const account = await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
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
      const heads = await readTradeHeads(manager, owner, id);
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
      await readOwnedAccount(manager, owner, id);
      if (!(await readJournal(manager, owner, id))) throw conflict();
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
      const items = rows.slice(0, query.limit).map(projectTradeVersion);
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
      await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
      if (
        !journal ||
        (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
      )
        throw conflict();
      const heads = await readTradeHeads(manager, owner, id);
      return project({ journal, heads, fifo: calculate(heads) });
    });
  }
  private read<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return run(manager);
    });
  }
  private async hasOpening(manager: EntityManager, owner: string, id: string): Promise<boolean> {
    const [row]: { present: boolean }[] = await manager.query(
      'SELECT EXISTS(SELECT 1 FROM account_opening_snapshots WHERE "ownerId"=$1 AND "accountId"=$2) AS present',
      [owner, id],
    );
    return row.present;
  }
}

import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { lockAccountingOwner } from './accounting-lock';
import { classifyAsset, instrumentPayload } from './asset-classification';
import type { RewardSummary } from './asset-reward-types';
import type { SwapSummary } from './asset-swap-types';
import {
  availableQuantity,
  firstShortfall,
  type LedgerView,
  type Shortfall,
  withoutOperation,
  withoutTrade,
} from './available-quantity';
import { type CarryInOrigin, projectCarryInOrigin } from './carry-in-projections';
import {
  advanceConnectedJournals,
  assertRevisionCapacity,
  connectedResult,
  projectConnectedLedger,
  readConnectedLedger,
  readTradeVersionCount,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { type Execution, FifoHistoryError } from './fifo';
import { parseUuid } from './input';
import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { AccountFifoResult, TransferSummary } from './owned-transfer-fifo';
import { derivePaidAmounts } from './paid-currency';
import {
  parseAvailableQuery,
  parseDerivedTradePageQuery,
  parseJournalInitialization,
  parseTradeCorrection,
  parseTradeCreate,
  parseTradeHistoryQuery,
  parseTradePageQuery,
  parseTradeVoid,
  type TradeCreateInput,
  type TradePageQuery,
  type TradeVoidInput,
} from './trade-input';

import {
  appendTradeVersion,
  type JournalRow,
  type TradeKind as Kind,
  projectTradeVersion,
  readJournal,
  readOwnedAccount,
  readTradeHeads,
  startEmptyJournal,
  type TradeVersion,
  type VersionRow,
  versionSelect,
} from './trade-journal.store';
import { automaticOrder } from './trade-order';
import {
  cashAsset,
  type SettlementCurrency,
  settlementTotal,
  type TradeSettlement,
} from './trade-settlement';

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
    | ((JournalOrigin | CarryInOrigin) & {
        journalRevision: number;
        activeTradeCount: number;
        versionCount: number;
        limits: { activeTrades: number; versions: number };
        summary: AccountFifoResult['summary'];
        transferSummary?: TransferSummary;
        rewardSummary?: RewardSummary;
        swapSummary?: SwapSummary;
        revisionBudget?: { used: number; limit: number };
      })
    | null;
}
interface CurrentSnapshot {
  journal: JournalRow;
  heads: TradeVersion[];
  fifo: AccountFifoResult;
}
const conflict = () => new ConflictException('Trade request conflicts with saved state');
/** A change that would leave a later operation spending more than its account holds. */
const dependent = (shortfall: Shortfall) =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: 'A later operation depends on this trade',
    dependent: shortfall,
  });

export { AUTOMATIC_COVERAGE_FROM } from './trade-journal.store';

const noRate = () => new ConflictException('No Bank of Russia rate is stored for the trade date');

type Ordered<O> = Omit<Execution, 'orderWithinTimestamp'> & { orderWithinTimestamp: O };
/** The execution fields; an automatic order stays null in the request as sent. */
function execution<O extends number | null>(value: Ordered<O>): Ordered<O> {
  return {
    instrumentId: value.instrumentId,
    side: value.side,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    grossUsd: value.grossUsd,
    feeUsd: value.feeUsd,
    ...(value.paid ? { paid: value.paid } : {}),
    ...(value.settlement ? { settlement: value.settlement } : {}),
    ...(value.purpose ? { purpose: value.purpose } : {}),
  };
}
/** The request as sent: amounts paid in RUB or EUR stay unconverted, so a replay never
 * depends on rates stored later (CUR-PAID-RUB). */
function requested(value: TradeCreateInput) {
  return {
    instrumentId: value.instrumentId,
    side: value.side,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    ...(value.paid ? { paid: value.paid } : { grossUsd: value.grossUsd, feeUsd: value.feeUsd }),
    ...(value.comment === undefined ? {} : { comment: value.comment }),
    ...(value.settlementCurrency === undefined
      ? {}
      : { settlementCurrency: value.settlementCurrency }),
    ...(value.purpose === undefined ? {} : { purpose: value.purpose }),
  };
}
function origin(row: Extract<JournalRow, { originKind: 'declared-empty' }>): JournalOrigin {
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
function page<T>(snapshot: CurrentSnapshot, items: readonly T[], query: TradePageQuery) {
  const end = query.offset + query.limit;
  return {
    journalRevision: snapshot.journal.currentRevision,
    items: items.slice(query.offset, end),
    nextOffset: end < items.length ? end : null,
  };
}

/**
 * The owner's market-priced asset with this type and ticker, the oldest if several; created
 * when `create` and none exists (a sale's cash, a chain coin being classified).
 */
export async function findOrCreateInstrument(
  manager: EntityManager,
  owner: string,
  asset: { assetType: 'fiat' | 'crypto'; symbol: string; name: string },
  create: boolean,
): Promise<{ id: string; name: string; symbol: string | null } | null> {
  const [found]: { id: string; name: string; symbol: string | null }[] = await manager.query(
    `SELECT id,name,symbol FROM accounting_instruments
      WHERE "ownerId"=$1 AND "assetType"=$2 AND upper(symbol)=$3
        AND ("assetType"<>'crypto' OR "priceSource"='market')
      ORDER BY "createdAt",id LIMIT 1`,
    [owner, asset.assetType, asset.symbol],
  );
  if (found || !create) return found ?? null;
  const value = { requestId: randomUUID(), ...asset };
  const classification = classifyAsset(value);
  const [created]: { id: string; name: string; symbol: string | null }[] = await manager.query(
    `INSERT INTO accounting_instruments
    (id,"ownerId","requestId","canonicalPayload",name,symbol,"assetType","valuationCurrency","priceSource")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,symbol`,
    [
      randomUUID(),
      owner,
      value.requestId,
      instrumentPayload(value, classification),
      value.name,
      value.symbol,
      classification.assetType,
      classification.valuationCurrency,
      classification.priceSource,
    ],
  );
  return created;
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
        if (
          previous.originKind !== 'declared-empty' ||
          previous.requestId !== value.requestId ||
          previous.canonicalPayload !== payload
        )
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
      if (row.originKind !== 'declared-empty') throw new Error('Invalid saved empty origin');
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
    return this.source
      .transaction((manager) => this.mutateWithin(manager, owner, id, kind, target, value))
      .catch(rethrowAccountingHistory);
  }

  /**
   * One create, correction or void inside the caller's transaction, under the owner's
   * accounting lock: a chain classification (M12) writes its own row in the same transaction.
   * The caller rethrows history errors.
   */
  async mutateWithin(
    manager: EntityManager,
    owner: string,
    id: string,
    kind: Kind,
    target: string | undefined,
    value: TradeCreateInput | TradeVoidInput,
  ): Promise<{ created: boolean; value: TradeReceipt }> {
    const input = kind === 'void' ? undefined : (value as TradeCreateInput);
    const fields = input && requested(input);
    const payload = JSON.stringify({
      kind,
      ...(target === undefined ? {} : { tradeId: target }),
      expectedJournalRevision: value.expectedJournalRevision,
      ...fields,
    });
    await lockAccountingOwner(manager, owner);
    const account = await readOwnedAccount(manager, owner, id);
    const journal =
      (await readJournal(manager, owner, id)) ??
      (kind === 'create' && value.expectedJournalRevision === 0
        ? await startEmptyJournal(manager, owner, account, value.requestId)
        : undefined);
    if (!journal) throw conflict();
    const [previous]: VersionRow[] = await manager.query(
      `${versionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
      [owner, id, value.requestId],
    );
    if (previous) {
      if (previous.canonicalPayload !== payload) throw conflict();
      return { created: false, value: receipt(id, projectTradeVersion(previous)) };
    }
    const ledger = await readConnectedLedger(manager, owner, [id], { lock: true });
    const heads = await readTradeHeads(manager, owner, id);
    const current =
      target === undefined ? undefined : heads.find((head) => head.tradeId === target);
    if (target !== undefined && !current) throw new NotFoundException();
    let nextExecution: Execution;
    let labels: { instrumentName: string; instrumentSymbol: string | null };
    const place = (fields: Ordered<number | null>): Execution => {
      const orderWithinTimestamp =
        fields.orderWithinTimestamp ??
        automaticOrder(ledger.accounts.get(id)!, ledger.transfers, fields.occurredAt, target);
      if (orderWithinTimestamp === null) throw conflict();
      return { ...fields, orderWithinTimestamp };
    };
    if (input) {
      const [instrument]: { name: string; symbol: string | null }[] = await manager.query(
        'SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2',
        [owner, input.instrumentId],
      );
      if (!instrument) throw new NotFoundException();
      if (input.paid) {
        const derived = derivePaidAmounts(input.paid, await readFxRates(manager), input.occurredAt);
        if (!derived) throw noRate();
        nextExecution = place(execution({ ...input, ...derived }));
      } else nextExecution = place(execution(input));
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
    if (input?.settlementCurrency) {
      const settlement = await this.settle(
        manager,
        owner,
        input.settlementCurrency,
        nextExecution,
        target === undefined ? ledger : withoutTrade(ledger, id, target),
        id,
      );
      if (settlement) nextExecution = { ...nextExecution, settlement };
    }
    const tradeId = target ?? randomUUID();
    const next = {
      ...nextExecution,
      ...labels,
      tradeId,
      version: (current?.version ?? 0) + 1,
      journalRevision: journal.currentRevision + 1,
      requestId: value.requestId,
      kind,
      ...(input?.comment === undefined ? {} : { comment: input.comment }),
    };
    assertRevisionCapacity(ledger);
    projectConnectedLedger(ledger);
    const trades = [...heads.filter((head) => head.tradeId !== tradeId), next].filter(
      (head) => head.kind !== 'void',
    );
    try {
      projectConnectedLedger(ledger, { accountId: id, trades });
    } catch (error) {
      // Name what the change would break: OPS-DELETE-GUARD, OPS-OVERSPEND.
      const shortfall =
        error instanceof FifoHistoryError &&
        firstShortfall({
          accounts: new Map(
            [...ledger.accounts].map(([key, item]) => [
              key,
              key === id ? { ...item, trades } : item,
            ]),
          ),
          transfers: ledger.transfers,
        });
      if (shortfall) throw dependent(shortfall);
      throw error;
    }
    const saved = await appendTradeVersion(manager, owner, id, {
      ...next,
      canonicalPayload: payload,
    });
    await advanceConnectedJournals(manager, owner, ledger);
    return { created: true, value: receipt(id, saved) };
  }

  /**
   * The cash side of a trade (OPS-SELL-CASH, OPS-BUY-CASH). A sale keeps its proceeds net of
   * fee as this cash in the same account, creating the cash asset when the owner has none. A
   * buy spends what the account can spend of it at that instant, up to the buy's cost; the
   * rest is money from outside. Without the asset there is no cash to spend.
   */
  private async settle(
    manager: EntityManager,
    owner: string,
    currency: SettlementCurrency,
    trade: Execution,
    others: LedgerView,
    accountId: string,
  ): Promise<TradeSettlement | null> {
    const instrument = await findOrCreateInstrument(
      manager,
      owner,
      cashAsset[currency],
      trade.side === 'sell',
    );
    // Without the asset there is no cash to spend.
    if (!instrument) return null;
    // Not a BadRequestException: the history rethrow would turn that into a 409.
    if (instrument.id === trade.instrumentId)
      throw new HttpException(
        'A trade cannot be settled in the asset it trades',
        HttpStatus.BAD_REQUEST,
      );
    const total = settlementTotal(trade);
    const quantity =
      trade.side === 'sell'
        ? total > 0n
          ? total
          : 0n
        : (() => {
            const held = canonicalDecimalToAtoms(
              availableQuantity(others, accountId, instrument.id, trade.occurredAt),
            );
            return held < total ? held : total;
          })();
    return {
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      instrumentSymbol: instrument.symbol,
      quantity: formatAtoms(quantity),
    };
  }

  /**
   * How much of an instrument the account can sell or send at an instant (PR-OPS-8): its
   * lowest balance from then on, with the trade being edited left out. An account without
   * a journal holds nothing.
   */
  async available(ownerId: string, accountId: string, rawQuery: unknown) {
    const owner = parseUuid(ownerId);
    const id = parseUuid(accountId);
    const query = parseAvailableQuery(rawQuery);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, id);
      const journal = await readJournal(manager, owner, id);
      let quantity = '0';
      if (journal) {
        const ledger = await readConnectedLedger(manager, owner, [id]);
        const withoutEdited = query.excludeTradeId
          ? withoutTrade(ledger, id, query.excludeTradeId)
          : ledger;
        const view = query.exclude ? withoutOperation(withoutEdited, query.exclude) : withoutEdited;
        quantity = availableQuantity(view, id, query.instrumentId, query.at);
      }
      return {
        accountId: id,
        instrumentId: query.instrumentId,
        at: query.at,
        journalRevision: journal?.currentRevision ?? null,
        quantity,
      };
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
      const ledger = await readConnectedLedger(manager, owner, [id]);
      const baseline = ledger.accounts.get(id)!.initialLots;
      const fifo = connectedResult(ledger, id, projectConnectedLedger(ledger).accounts.get(id)!);
      return {
        accountId: id,
        eligible: false,
        ineligibilityReason: 'already-initialized',
        journal: {
          ...(journal.originKind === 'declared-empty'
            ? origin(journal)
            : projectCarryInOrigin(journal, baseline)),
          journalRevision: journal.currentRevision,
          activeTradeCount: heads.filter((head) => head.kind !== 'void').length,
          versionCount: await readTradeVersionCount(manager, owner, id),
          limits: { activeTrades: 1000, versions: 10000 },
          summary: fifo.summary,
          ...(fifo.transferSummary ? { transferSummary: fifo.transferSummary } : {}),
          ...(fifo.rewardSummary ? { rewardSummary: fifo.rewardSummary } : {}),
          ...(fifo.swapSummary ? { swapSummary: fifo.swapSummary } : {}),
          ...(fifo.transferSummary || fifo.rewardSummary || fifo.swapSummary
            ? {
                revisionBudget: { used: journal.currentRevision, limit: 10000 },
              }
            : {}),
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
    const query = parseDerivedTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) =>
      page(snapshot, snapshot.fifo.lots, query),
    );
  }
  async listRealizations(ownerId: string, accountId: string, rawQuery: unknown = {}) {
    const query = parseDerivedTradePageQuery(rawQuery);
    return this.current(ownerId, accountId, query, (snapshot) =>
      page(snapshot, snapshot.fifo.realizations, query),
    );
  }
  async listMatches(ownerId: string, accountId: string, tradeId: string, rawQuery: unknown = {}) {
    const target = parseUuid(tradeId);
    const query = parseDerivedTradePageQuery(rawQuery);
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
      const ledger = await readConnectedLedger(manager, owner, [id]);
      const fifo = connectedResult(ledger, id, projectConnectedLedger(ledger).accounts.get(id)!);
      return project({ journal, heads, fifo });
    });
  }
  private read<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return run(manager).catch(rethrowAccountingHistory);
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

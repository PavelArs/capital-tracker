import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from '../accounting/accounting-lock';
import { classifyAsset, instrumentPayload } from '../accounting/asset-classification';
import {
  appendRewardVersion,
  REWARD_LIMITS,
  readRewardCounts,
  rewardHeadJoin,
} from '../accounting/asset-reward.store';
import { rewardPayload } from '../accounting/asset-reward-input';
import { swapHeadJoin } from '../accounting/asset-swap.store';
import { firstShortfall } from '../accounting/available-quantity';
import { rethrowAccountingHistory } from '../accounting/connected-accounting.store';
import { type Execution, FifoHistoryError } from '../accounting/fifo';
import {
  calculateOwnedTransfers,
  OwnedTransferCapacityError,
} from '../accounting/owned-transfer-fifo';
import { findOrCreateInstrument } from '../accounting/trade.service';
import {
  AUTOMATIC_COVERAGE_FROM,
  advanceJournal,
  appendTradeVersion,
  readJournal,
  readOwnedAccount,
  startEmptyJournal,
} from '../accounting/trade-journal.store';
import { cashAsset } from '../accounting/trade-settlement';
import { readFxRates } from '../fx-rates/fx-rates.service';
import { parseImport, parseUuid } from './broker-connection-input';
import { BrokerConnectionsService } from './broker-connections.service';
import type { TBankOperation } from './tbank-client';
import {
  type CashCurrency,
  type ImportInstrument,
  type JournalEntry,
  journalEntries,
} from './tbank-import-entries';
import { type ImportPlan, type PlanEntry, planImport } from './tbank-import-plan';

/** Why the history cannot be written as it stands, with the operations it concerns. */
export interface ImportProblem {
  reason:
    | 'not-recordable'
    | 'already-imported'
    | 'no-rate'
    | 'amount'
    | 'not-held'
    | 'before-records'
    | 'too-many-rewards'
    | 'too-many-entries';
  occurredAt: string | null;
  ticker: string;
  operationIds: string[];
}

interface Review {
  plan: ImportPlan;
  accountHasEntries: boolean;
  entries: JournalEntry[];
  problems: ImportProblem[];
  previewHash: string;
  canImport: boolean;
}

interface ImportRow {
  id: string;
  accountId: string;
  requestId: string;
  canonicalPayload: string;
  trades: number;
  rewards: number;
  firstJournalRevision: number;
  lastJournalRevision: number;
  createdAt: Date;
}

const conflict = () => new ConflictException('Broker import conflicts with saved state');
const cashCurrency: Record<string, CashCurrency> = { rub: 'RUB', usd: 'USD', eur: 'EUR' };

function receipt(row: ImportRow) {
  return {
    importId: row.id,
    accountId: row.accountId,
    requestId: row.requestId,
    trades: row.trades,
    rewards: row.rewards,
    firstJournalRevision: row.firstJournalRevision,
    lastJournalRevision: row.lastJournalRevision,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The fields an owner's own create request would have named, as the CSV import keeps them. */
function execution(value: Execution): Execution {
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

/**
 * BROKER-SYNC: a connected account's T-Bank history written into its empty records in one
 * command. The preview says what would be written and whether it can be; the import writes
 * exactly what the owner saw, or nothing. An account that already holds entries is refused, so
 * history entered by hand is never counted twice.
 */
@Injectable()
export class BrokerImportService {
  constructor(
    private readonly source: DataSource,
    private readonly connections: BrokerConnectionsService,
  ) {}

  /** The entries the history would become and whether they can be written. Nothing is recorded. */
  async preview(ownerId: string, accountId: string) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const history = await this.connections.history(owner, account);
    return this.source
      .transaction('REPEATABLE READ', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const review = await this.review(manager, owner, account, history, false);
        return {
          ...review.plan,
          accountHasEntries: review.accountHasEntries,
          problems: review.problems,
          canImport: review.canImport,
          previewHash: review.previewHash,
        };
      })
      .catch(rethrowAccountingHistory);
  }

  /** Writes the previewed history; a repeat of the same request returns the first receipt. */
  async import(ownerId: string, accountId: string, body: unknown) {
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const input = parseImport(body);
    const payload = JSON.stringify({ provider: 'tbank', previewHash: input.previewHash });
    const earlier = await this.replay(this.source.manager, owner, account, input.requestId);
    if (earlier) return this.replayed(earlier, payload);
    const history = await this.connections.history(owner, account);
    return this.source
      .transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const again = await this.replay(manager, owner, account, input.requestId);
        if (again) return this.replayed(again, payload);
        const row = await readOwnedAccount(manager, owner, account, true);
        const review = await this.review(manager, owner, account, history, true);
        if (!review.canImport || review.previewHash !== input.previewHash) throw conflict();
        const journal =
          (await readJournal(manager, owner, account)) ??
          (await startEmptyJournal(manager, owner, row, input.requestId));
        if (!journal) throw conflict();
        const first = journal.currentRevision + 1;
        const last = journal.currentRevision + review.entries.length;
        const id = randomUUID();
        const trades = review.entries.filter((entry) => entry.trade).length;
        const [saved]: ImportRow[] = await manager.query(
          `INSERT INTO broker_imports (id, "ownerId", "accountId", provider, "brokerAccountId",
              "requestId", "canonicalPayload", trades, rewards, "firstJournalRevision",
              "lastJournalRevision")
            VALUES ($1, $2, $3, 'tbank', $10, $4, $5, $6, $7, $8, $9)
            RETURNING id, "accountId", "requestId", "canonicalPayload", trades, rewards,
              "firstJournalRevision", "lastJournalRevision", "createdAt"`,
          [
            id,
            owner,
            account,
            input.requestId,
            payload,
            trades,
            review.entries.length - trades,
            first,
            last,
            history.brokerAccountId,
          ],
        );
        const written = { operations: [] as string[], trades: [] as (string | null)[] };
        const rewards: (string | null)[] = [];
        for (const [index, entry] of review.entries.entries()) {
          const revision = first + index;
          let tradeId: string | null = null;
          let rewardId: string | null = null;
          if (entry.trade) {
            tradeId = randomUUID();
            const fields = execution(entry.trade);
            await appendTradeVersion(manager, owner, account, {
              ...fields,
              tradeId,
              version: 1,
              journalRevision: revision,
              requestId: randomUUID(),
              kind: 'create',
              instrumentName: entry.trade.instrumentName,
              instrumentSymbol: entry.trade.instrumentSymbol,
              canonicalPayload: JSON.stringify({
                kind: 'create',
                expectedJournalRevision: revision - 1,
                ...fields,
              }),
            });
          } else {
            rewardId = randomUUID();
            const { rewardId: _, version, ...reward } = entry.reward;
            const request = {
              ...reward,
              assertReward: true as const,
              requestId: randomUUID(),
              expectedJournalRevision: revision - 1,
            };
            await appendRewardVersion(manager, owner, {
              ...reward,
              rewardId,
              version,
              accountId: account,
              kind: 'create',
              requestId: request.requestId,
              journalRevision: revision,
              canonicalPayload: rewardPayload('create', request),
            });
          }
          for (const operationId of entry.source.operationIds) {
            written.operations.push(operationId);
            written.trades.push(tradeId);
            rewards.push(rewardId);
          }
        }
        await manager.query(
          `INSERT INTO broker_imported_operations ("ownerId", "accountId", provider,
              "brokerAccountId", "operationId", "importId", "tradeId", "rewardId")
            SELECT $1, $2, 'tbank', $7, operation, $3, trade, reward
              FROM unnest($4::text[], $5::uuid[], $6::uuid[]) AS item(operation, trade, reward)`,
          [
            owner,
            account,
            id,
            written.operations,
            written.trades,
            rewards,
            history.brokerAccountId,
          ],
        );
        await advanceJournal(manager, owner, account, last);
        return { created: true, value: receipt(saved) };
      })
      .catch(rethrowAccountingHistory);
  }

  private async replay(manager: EntityManager, owner: string, account: string, request: string) {
    const [row]: ImportRow[] = await manager.query(
      `SELECT id, "accountId", "requestId", "canonicalPayload", trades, rewards,
          "firstJournalRevision", "lastJournalRevision", "createdAt"
        FROM broker_imports WHERE "ownerId" = $1 AND "accountId" = $2 AND "requestId" = $3`,
      [owner, account, request],
    );
    return row;
  }

  private replayed(row: ImportRow, payload: string) {
    if (row.canonicalPayload !== payload) throw conflict();
    return { created: false, value: receipt(row) };
  }

  /**
   * What the history becomes in this account and what stands in the way of writing it. With
   * `write`, the instruments it needs are created; otherwise a missing one is described only.
   */
  private async review(
    manager: EntityManager,
    owner: string,
    account: string,
    history: { brokerAccountId: string; operations: readonly TBankOperation[] },
    write: boolean,
  ): Promise<Review> {
    const plan = planImport(history.operations);
    const accountHasEntries = await this.holdsEntries(manager, owner, account);
    const problems: ImportProblem[] = [];
    // Anything left out that moved money or shares would leave the records better off than the
    // account really is, so it stops the import; an operation that moved nothing does not.
    const left = plan.skipped.filter((item) => item.reason !== 'no-amount');
    if (left.length > 0)
      problems.push(
        listed(
          'not-recordable',
          left.map((item) => item.operationId),
        ),
      );
    // An operation of this T-Bank account already written, into this account or another one.
    const done: { operationId: string }[] = await manager.query(
      `SELECT "operationId" FROM broker_imported_operations
        WHERE "ownerId" = $1 AND provider = 'tbank' AND "brokerAccountId" = $2
          AND "operationId" = ANY($3::text[]) ORDER BY "operationId"`,
      [owner, history.brokerAccountId, plan.entries.flatMap((entry) => entry.operationIds)],
    );
    if (done.length > 0)
      problems.push(
        listed(
          'already-imported',
          done.map((row) => row.operationId),
        ),
      );
    const instruments = await this.instruments(manager, owner, plan.entries, write);
    const built = journalEntries(plan.entries, instruments, await readFxRates(manager));
    for (const problem of built.problems) problems.push({ ...problem, ticker: '' });
    const entries = built.entries;
    const trades = entries.flatMap((entry) => (entry.trade ? [entry.trade] : []));
    const rewards = entries.flatMap((entry) => (entry.reward ? [entry.reward] : []));
    const journal = await readJournal(manager, owner, account);
    const coverageFrom = journal?.coverageFrom.toISOString() ?? AUTOMATIC_COVERAGE_FROM;
    const early = entries.find((entry) => (entry.trade ?? entry.reward).occurredAt < coverageFrom);
    if (early) problems.push(problemOf('before-records', early));
    // The reward journal's caps hold across all the owner's accounts, not only this one.
    const counts = await readRewardCounts(manager, owner);
    const fitsRewardLimit =
      plan.fitsRewardLimit &&
      counts.activeCount + plan.rewards <= REWARD_LIMITS.activeRewards &&
      counts.versionCount + plan.rewards <= REWARD_LIMITS.versions;
    if (!fitsRewardLimit)
      problems.push({ reason: 'too-many-rewards', occurredAt: null, ticker: '', operationIds: [] });
    if ((journal?.currentRevision ?? 0) + entries.length > 10000)
      problems.push({ reason: 'too-many-entries', occurredAt: null, ticker: '', operationIds: [] });
    if (plan.fitsTradeLimit && entries.length > 0) {
      const replayed = {
        accountId: account,
        coverageFrom: AUTOMATIC_COVERAGE_FROM,
        trades,
        rewards,
        initialLots: [],
      };
      try {
        calculateOwnedTransfers([replayed], []);
      } catch (error) {
        if (error instanceof OwnedTransferCapacityError || !(error instanceof FifoHistoryError))
          throw error;
        // The first entry that spends more than the account holds then, such as a sale of
        // shares that came in by a transfer the import leaves out.
        const shortfall = firstShortfall({
          accounts: new Map([[account, replayed]]),
          transfers: [],
        });
        const id = shortfall?.operationId.replace(/^(trade|reward):/, '');
        const entry = entries.find((item) => (item.trade?.tradeId ?? item.reward?.rewardId) === id);
        problems.push(
          entry
            ? problemOf('not-held', entry)
            : { reason: 'not-held', occurredAt: null, ticker: '', operationIds: [] },
        );
      }
    }
    const previewHash = createHash('sha256')
      .update(JSON.stringify(['tbank-import-v1', account, plan.grouping, plan.entries]))
      .digest('hex');
    return {
      plan: { ...plan, fitsRewardLimit },
      accountHasEntries,
      entries,
      problems,
      previewHash,
      canImport:
        !accountHasEntries && plan.fitsTradeLimit && problems.length === 0 && entries.length > 0,
    };
  }

  /**
   * Whether the account holds any history an import would add to: a standing trade, reward or
   * swap, a transfer in or out, an opening snapshot, a carried-in journal or any revision. A
   * voided entry no longer counts.
   */
  private async holdsEntries(manager: EntityManager, owner: string, account: string) {
    const [row]: { held: boolean }[] = await manager.query(
      `SELECT EXISTS (SELECT 1 FROM account_trade_versions v JOIN account_trades t
            ON t."ownerId" = v."ownerId" AND t."accountId" = v."accountId" AND t.id = v."tradeId"
            AND t."currentVersion" = v.version
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_reward_versions v ${rewardHeadJoin}
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_swap_versions v ${swapHeadJoin}
          WHERE v."ownerId" = $1 AND v."accountId" = $2 AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM owned_transfers t JOIN owned_transfer_versions v
            ON v."ownerId" = t."ownerId" AND v."transferId" = t.id AND v.version = t."currentVersion"
          WHERE t."ownerId" = $1 AND $2 IN (t."fromAccountId", t."toAccountId")
            AND v.kind <> 'void')
        OR EXISTS (SELECT 1 FROM account_opening_snapshots WHERE "ownerId" = $1 AND "accountId" = $2)
        OR EXISTS (SELECT 1 FROM account_trade_journals
          WHERE "ownerId" = $1 AND "accountId" = $2 AND "originKind" <> 'declared-empty')
        OR EXISTS (SELECT 1 FROM manual_accounts
          WHERE "ownerId" = $1 AND id = $2 AND "currentRevision" IS NOT NULL) AS held`,
      [owner, account],
    );
    return row.held;
  }

  /**
   * The cash asset of each currency the plan moves, and the owner's instrument for each security:
   * the one an earlier import linked, else a new asset priced by hand in its trade currency,
   * named by its ticker. Without `write`, a missing one is described but not created.
   */
  private async instruments(
    manager: EntityManager,
    owner: string,
    plan: readonly PlanEntry[],
    write: boolean,
  ) {
    const cash = {} as Record<CashCurrency, ImportInstrument>;
    for (const code of ['RUB', 'USD', 'EUR'] as const) {
      const asset = cashAsset[code];
      const used = plan.some(
        (entry) =>
          cashCurrency[entry.currency] === code ||
          (entry.cash !== undefined && cashCurrency[entry.cash] === code),
      );
      const found = used ? await findOrCreateInstrument(manager, owner, asset, write) : null;
      cash[code] = found ?? { id: `new-cash-${code}`, name: asset.name, symbol: asset.symbol };
    }
    const securities = new Map<string, ImportInstrument>();
    const wanted = new Map<string, PlanEntry>();
    for (const entry of plan)
      if (
        entry.record === 'trade' &&
        entry.instrumentUid &&
        !entry.cash &&
        !wanted.has(entry.instrumentUid)
      )
        wanted.set(entry.instrumentUid, entry);
    if (wanted.size === 0) return { cash, securities };
    const linked: (ImportInstrument & { uid: string })[] = await manager.query(
      `SELECT l."providerInstrumentId" AS uid, i.id, i.name, i.symbol
        FROM broker_instrument_links l JOIN accounting_instruments i
          ON i."ownerId" = l."ownerId" AND i.id = l."instrumentId"
        WHERE l."ownerId" = $1 AND l.provider = 'tbank' AND l."providerInstrumentId" = ANY($2::text[])`,
      [owner, [...wanted.keys()]],
    );
    for (const row of linked)
      securities.set(row.uid, { id: row.id, name: row.name, symbol: row.symbol });
    for (const [uid, entry] of wanted) {
      if (securities.has(uid)) continue;
      const name = entry.ticker || `T-Bank ${uid}`;
      const symbol = entry.ticker || null;
      if (!write) {
        securities.set(uid, { id: `new-${uid}`, name, symbol });
        continue;
      }
      const value = {
        requestId: randomUUID(),
        name,
        symbol,
        assetType: 'manual' as const,
        valuationCurrency: cashCurrency[entry.currency],
      };
      const classification = classifyAsset(value);
      const [created]: ImportInstrument[] = await manager.query(
        `INSERT INTO accounting_instruments
          (id, "ownerId", "requestId", "canonicalPayload", name, symbol, "assetType",
            "valuationCurrency", "priceSource")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, symbol`,
        [
          randomUUID(),
          owner,
          value.requestId,
          instrumentPayload(value, classification),
          name,
          symbol,
          classification.assetType,
          classification.valuationCurrency,
          classification.priceSource,
        ],
      );
      await manager.query(
        `INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId", "instrumentId")
          VALUES ($1, 'tbank', $2, $3)`,
        [owner, uid, created.id],
      );
      securities.set(uid, created);
    }
    return { cash, securities };
  }
}

/** A problem with the operations it names; the first 50 are enough to find them. */
function listed(reason: ImportProblem['reason'], operationIds: string[]): ImportProblem {
  return { reason, occurredAt: null, ticker: '', operationIds: operationIds.slice(0, 50) };
}

function problemOf(reason: ImportProblem['reason'], entry: JournalEntry): ImportProblem {
  return {
    reason,
    occurredAt: (entry.trade ?? entry.reward).occurredAt,
    ticker: entry.source.ticker,
    operationIds: entry.source.operationIds,
  };
}

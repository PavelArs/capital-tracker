import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AccountingService } from '../accounting/accounting.service';
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
import {
  appendCapitalReturnVersion,
  CAPITAL_RETURN_LIMITS,
  capitalReturnHeadJoin,
  capitalReturnPayload,
  readCapitalReturnCounts,
} from '../accounting/capital-return.store';
import { CarryInService } from '../accounting/carry-in.service';
import { rethrowAccountingHistory } from '../accounting/connected-accounting.store';
import type { FifoCarryInInput } from '../accounting/fifo';
import { type Execution, FifoHistoryError } from '../accounting/fifo';
import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import {
  calculateOwnedTransfers,
  OwnedTransferCapacityError,
} from '../accounting/owned-transfer-fifo';
import type { OwnedAccountInput } from '../accounting/owned-transfer-types';
import { readSplits } from '../accounting/share-split.store';
import type { FifoSplit } from '../accounting/share-split-types';
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
import { parseImport, parseImportPreview, parseUuid } from './broker-connection-input';
import { BrokerConnectionsService } from './broker-connections.service';
import {
  type InstrumentFacts,
  instrumentFacts,
  resolveLinks,
  type SavedLink,
} from './broker-instrument-links';
import {
  type BrokerOpening,
  type BrokerSplit,
  cashPositionCurrency,
  openingAssets,
  openingPositions,
  openingQuantities,
  splittable,
} from './broker-opening';
import { saveBrokerPrices } from './broker-prices';
import type { TBankOperation, TBankPosition } from './tbank-client';
import {
  type CashCurrency,
  type ImportInstrument,
  type ImportInstruments,
  type JournalEntry,
  journalEntries,
  recordOf,
} from './tbank-import-entries';
import { type ImportPlan, type PlanEntry, planImport } from './tbank-import-plan';

/** Why the history cannot be written as it stands, with the operations it concerns. */
export interface ImportProblem {
  reason:
    | 'opening-holding'
    | 'not-recordable'
    | 'already-imported'
    | 'no-rate'
    | 'amount'
    | 'fee-above-proceeds'
    | 'not-held'
    | 'before-records'
    | 'too-many-rewards'
    | 'too-many-capital-returns'
    | 'too-many-entries';
  occurredAt: string | null;
  ticker: string;
  operationIds: string[];
  availableQuantity?: string;
  requiredQuantity?: string;
  missingQuantity?: string;
}

interface Review {
  /** Splits declared with this import, by their accounting instrument, to save with it. */
  declaredSplits: { instrumentId: string; effectiveAt: string; ratio: number }[];
  openingLots: FifoCarryInInput[];
  openingPositions: ReturnType<typeof openingPositions>;
  plan: ImportPlan;
  accountHasEntries: boolean;
  entries: JournalEntry[];
  problems: ImportProblem[];
  previewHash: string;
  canImport: boolean;
  /**
   * BROKER-CASH-GAP: by lower-case currency code, cash the replayed history leaves above what
   * T-Bank reports for it.
   */
  cashGaps: Map<string, string>;
}

interface ImportRow {
  id: string;
  accountId: string;
  requestId: string;
  canonicalPayload: string;
  trades: number;
  rewards: number;
  capitalReturns: number;
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
    capitalReturns: row.capitalReturns,
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
    private readonly accounting: AccountingService,
    private readonly carryIn: CarryInService,
  ) {}

  /** The entries the history would become and whether they can be written. Nothing is recorded. */
  async preview(ownerId: string, accountId: string, raw: unknown = {}) {
    const { opening, splits } = parseImportPreview(raw);
    const owner = parseUuid(ownerId);
    const account = parseUuid(accountId);
    const history = await this.connections.history(owner, account, true);
    return this.source
      .transaction('REPEATABLE READ', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        const review = await this.review(manager, owner, account, history, false, opening, splits);
        return {
          ...review.plan,
          skipped: review.plan.skipped.map((item) => {
            const operation = history.operations.find(
              (operation) => operation.id === item.operationId,
            );
            return {
              ...item,
              ticker: operation?.ticker ?? '',
              occurredAt: operation?.occurredAt ?? null,
            };
          }),
          openingAssets: openingAssets(history.operations, history.positions),
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
    const payload = JSON.stringify({
      provider: 'tbank',
      previewHash: input.previewHash,
      ...(input.opening ? { opening: input.opening } : {}),
      ...(input.splits ? { splits: input.splits } : {}),
    });
    const earlier = await this.replay(this.source.manager, owner, account, input.requestId);
    if (earlier) return this.replayed(earlier, payload);
    const history = await this.connections.history(owner, account, true);
    return this.source
      .transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const again = await this.replay(manager, owner, account, input.requestId);
        if (again) return this.replayed(again, payload);
        const row = await readOwnedAccount(manager, owner, account, true);
        const review = await this.review(
          manager,
          owner,
          account,
          history,
          true,
          input.opening,
          input.splits,
        );
        if (!review.canImport || review.previewHash !== input.previewHash) throw conflict();
        // SPLIT: the declared splits hold for every account of the owner, from this import on.
        await saveDeclaredSplits(manager, owner, input.requestId, review.declaredSplits);
        if (input.opening)
          await this.saveOpening(manager, owner, account, input.requestId, input.opening, review);
        const journal =
          (await readJournal(manager, owner, account)) ??
          (await startEmptyJournal(manager, owner, row, input.requestId));
        if (!journal) throw conflict();
        const first = journal.currentRevision + 1;
        const last = journal.currentRevision + review.entries.length;
        const id = randomUUID();
        const trades = review.entries.filter((entry) => entry.trade).length;
        const capitalReturns = review.entries.filter((entry) => entry.capitalReturn).length;
        const [saved]: ImportRow[] = await manager.query(
          `INSERT INTO broker_imports (id, "ownerId", "accountId", provider, "brokerAccountId",
              "requestId", "canonicalPayload", trades, rewards, "capitalReturns",
              "firstJournalRevision", "lastJournalRevision")
            VALUES ($1, $2, $3, 'tbank', $11, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, "accountId", "requestId", "canonicalPayload", trades, rewards,
              "capitalReturns", "firstJournalRevision", "lastJournalRevision", "createdAt"`,
          [
            id,
            owner,
            account,
            input.requestId,
            payload,
            trades,
            review.entries.length - trades - capitalReturns,
            capitalReturns,
            first,
            last,
            history.brokerAccountId,
          ],
        );
        const written = { operations: [] as string[], trades: [] as (string | null)[] };
        const rewards: (string | null)[] = [];
        const returns: (string | null)[] = [];
        for (const [index, entry] of review.entries.entries()) {
          const ids = await writeEntry(manager, owner, account, entry, first + index);
          for (const operationId of entry.source.operationIds) {
            written.operations.push(operationId);
            written.trades.push(ids.tradeId);
            rewards.push(ids.rewardId);
            returns.push(ids.capitalReturnId);
          }
        }
        await manager.query(
          `INSERT INTO broker_imported_operations ("ownerId", "accountId", provider,
              "brokerAccountId", "operationId", "importId", "tradeId", "rewardId",
              "capitalReturnId")
            SELECT $1, $2, 'tbank', $8, operation, $3, trade, reward, capital_return
              FROM unnest($4::text[], $5::uuid[], $6::uuid[], $7::uuid[])
                AS item(operation, trade, reward, capital_return)`,
          [
            owner,
            account,
            id,
            written.operations,
            written.trades,
            rewards,
            returns,
            history.brokerAccountId,
          ],
        );
        await advanceJournal(manager, owner, account, last);
        // BPR-2: the securities just linked are valued at the price T-Bank reports for them now.
        // Links that disagree save no price: the asset stays unpriced rather than guessed.
        await saveBrokerPrices(manager, owner, history, new Date());
        return { created: true, value: receipt(saved) };
      })
      .catch(rethrowAccountingHistory);
  }

  /** The reviewed opening holdings, saved as the account's opening and its carried-in lots. */
  private async saveOpening(
    manager: EntityManager,
    owner: string,
    account: string,
    requestId: string,
    declared: BrokerOpening,
    review: Review,
  ) {
    const opening = await this.accounting.saveOpeningWithin(manager, owner, account, {
      requestId,
      expectedRevision: 0,
      asOf: declared.asOf,
      positions: review.openingPositions,
    });
    await this.carryIn.initializeWithin(manager, owner, account, {
      requestId,
      expectedOpeningRevision: opening.value.revision,
      assertReviewed: true,
      lots: review.openingLots.map((lot) => ({
        instrumentId: lot.instrumentId,
        acquiredAt: lot.acquiredAt,
        orderWithinTimestamp: lot.orderWithinTimestamp,
        originalQuantity: lot.originalQuantity,
        originalCostUsd: lot.originalCostUsd,
        remainingQuantity: lot.carriedQuantity,
      })),
    });
  }

  private async replay(manager: EntityManager, owner: string, account: string, request: string) {
    const [row]: ImportRow[] = await manager.query(
      `SELECT id, "accountId", "requestId", "canonicalPayload", trades, rewards, "capitalReturns",
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
    history: {
      brokerAccountId: string;
      operations: readonly TBankOperation[];
      positions?: readonly TBankPosition[];
    },
    write: boolean,
    opening?: BrokerOpening,
    splits: readonly BrokerSplit[] = [],
  ): Promise<Review> {
    // UIDs whose instrument this command created; a second plan finds them saved, but the preview
    // named them as new.
    const created = new Set<string>();
    // Splits saved for securities linked by earlier imports, and those declared now.
    const planSplits = [
      ...(await readLinkedSplits(manager, owner, history.operations)),
      ...splits.map((split) => ({
        uid: split.asset,
        effectiveAt: split.effectiveAt,
        ratio: BigInt(split.ratio),
      })),
    ];
    const reviewed = async (hoist: boolean) => {
      const plan = (cashGaps?: ReadonlyMap<string, string>) =>
        planImport(history.operations, {
          hoist,
          initialHoldings: openingQuantities(opening),
          splits: planSplits,
          cashGaps,
        });
      const first = await this.reviewPlan(
        manager,
        owner,
        account,
        history,
        write,
        plan(),
        created,
        opening,
        splits,
      );
      if (first.cashGaps.size === 0) return first;
      // BROKER-CASH-GAP: T-Bank reports less cash than its listed operations leave, so money left
      // in an operation it does not list. The history is replayed again with that money paid
      // out, and only a replay that then matches what T-Bank reports can be written.
      return this.reviewPlan(
        manager,
        owner,
        account,
        history,
        write,
        plan(first.cashGaps),
        created,
        opening,
        splits,
      );
    };
    const review = await reviewed(true);
    if (!review.problems.some((problem) => problem.reason === 'not-held')) return review;
    // The planner places a buy ahead of a same-instant sale of its security, so the buy may spend
    // cash the sale has not yet brought in. The history in its operation order may replay where
    // the planned order does not, and a history that replays is the one to write.
    const unhoisted = await reviewed(false);
    return unhoisted.problems.length === 0 ? unhoisted : review;
  }

  private async reviewPlan(
    manager: EntityManager,
    owner: string,
    account: string,
    history: {
      brokerAccountId: string;
      operations: readonly TBankOperation[];
      positions?: readonly TBankPosition[];
    },
    write: boolean,
    plan: ImportPlan,
    created: Set<string>,
    opening?: BrokerOpening,
    splits: readonly BrokerSplit[] = [],
  ): Promise<Review> {
    const accountHasEntries = await this.holdsEntries(manager, owner, account);
    const problems: ImportProblem[] = [];
    const cashGaps = new Map<string, string>();
    const reported = history.positions ?? [];
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
    const available = openingAssets(history.operations, history.positions);
    assertInHistory(opening, splits, available);
    const instruments = await this.instruments(
      manager,
      owner,
      plan.entries,
      write,
      created,
      opening,
      available,
      [...history.operations, ...reported.filter((row) => !row.virtual)],
    );
    // SPLIT: the owner's saved splits and those declared now replay with the history; a declared
    // one already saved for the security on that instant is not a second split.
    const saved = await readSplits(manager, owner);
    const declaredSplits = declaredSplitsOf(splits, instruments, saved);
    const replaySplits: FifoSplit[] = [
      ...saved,
      ...declaredSplits.map((split, index) => ({ splitId: `declared-${index}`, ...split })),
    ];
    const openingLots = openingLotsOf(opening, instruments);
    const positions = openingPositions(
      openingLots.map((lot) => ({
        instrumentId: lot.instrumentId,
        quantity: lot.carriedQuantity,
        costUsd: lot.originalCostUsd,
      })),
    );
    const built = journalEntries(plan.entries, instruments, await readFxRates(manager));
    for (const problem of built.problems) problems.push({ ...problem, ticker: '' });
    const entries = built.entries;
    const journal = await readJournal(manager, owner, account);
    const coverageFrom =
      opening?.asOf ?? journal?.coverageFrom.toISOString() ?? AUTOMATIC_COVERAGE_FROM;
    const early = entries.find((entry) => recordOf(entry).occurredAt < coverageFrom);
    if (early) problems.push(problemOf('before-records', early));
    // The reward journal's caps hold across all the owner's accounts, not only this one.
    const fitsRewardLimit = fitsCaps(
      plan.fitsRewardLimit,
      plan.rewards,
      await readRewardCounts(manager, owner),
      REWARD_LIMITS.activeRewards,
      REWARD_LIMITS.versions,
    );
    if (!fitsRewardLimit) problems.push(listed('too-many-rewards', []));
    // The same holds for capital returns.
    const fitsCapitalReturnLimit = fitsCaps(
      plan.fitsCapitalReturnLimit,
      plan.capitalReturns,
      await readCapitalReturnCounts(manager, owner),
      CAPITAL_RETURN_LIMITS.activeReturns,
      CAPITAL_RETURN_LIMITS.versions,
    );
    if (!fitsCapitalReturnLimit) problems.push(listed('too-many-capital-returns', []));
    if ((journal?.currentRevision ?? 0) + entries.length > 10000)
      problems.push(listed('too-many-entries', []));
    // Past a cap the replay cannot run; that cap is already listed as the problem.
    if (plan.fitsTradeLimit && fitsRewardLimit && fitsCapitalReturnLimit && entries.length > 0) {
      const replayed = {
        accountId: account,
        coverageFrom,
        trades: entries.flatMap((entry) => (entry.trade ? [entry.trade] : [])),
        rewards: entries.flatMap((entry) => (entry.reward ? [entry.reward] : [])),
        capitalReturns: entries.flatMap((entry) =>
          entry.capitalReturn ? [entry.capitalReturn] : [],
        ),
        initialLots: openingLots,
      };
      checkReplay(
        replayed,
        replaySplits,
        { positions: reported, entries, instruments, available },
        { problems, cashGaps },
      );
    }
    // The hash pins what the owner reviewed: the plan, the amounts it becomes at the rates stored
    // then, the saved instrument each linked UID or asset resolves to (new ones aside, since the
    // preview only names the ones it would create) and what stood in the way, so a rate or link
    // that arrives later cannot slip an unreviewed entry in.
    const previewHash = createHash('sha256')
      .update(
        JSON.stringify([
          'tbank-import-v4',
          opening ?? null,
          splits,
          hashedOperations(history.operations),
          hashedPositions(reported),
          instruments.linked,
          account,
          plan.grouping,
          plan.entries,
          entries.map(derivedAmounts),
          problems,
        ]),
      )
      .digest('hex');
    return {
      declaredSplits,
      openingLots,
      openingPositions: positions,
      plan: { ...plan, fitsRewardLimit, fitsCapitalReturnLimit },
      accountHasEntries,
      entries,
      problems,
      previewHash,
      canImport:
        !accountHasEntries && plan.fitsTradeLimit && problems.length === 0 && entries.length > 0,
      cashGaps,
    };
  }

  /**
   * Whether the account holds any history an import would add to: a standing trade, reward,
   * swap or capital return, a transfer in or out, an opening snapshot, a carried-in journal or any revision. A
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
        OR EXISTS (SELECT 1 FROM account_capital_return_versions v ${capitalReturnHeadJoin}
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
    created: Set<string>,
    opening?: BrokerOpening,
    available: ReturnType<typeof openingAssets> = [],
    identities: readonly (TBankOperation | TBankPosition)[] = [],
  ) {
    const cash = await cashInstruments(manager, owner, plan, write, opening);
    const securities = new Map<string, ImportInstrument>();
    const wanted = wantedSecurities(plan, opening, available);
    if (wanted.size === 0) return { cash, securities, linked: [] };
    // Canonical trading modes may change between imports; resolve every verified original UID,
    // and the asset, which joins one fund's venue UIDs across accounts.
    const facts = instrumentFacts(wanted.keys(), identities);
    if (!facts) throw conflict();
    const saved: SavedLink[] = await manager.query(
      `SELECT l."providerInstrumentId" AS uid, l."assetUid", l."instrumentType", i.id, i.name,
          i.symbol
        FROM broker_instrument_links l JOIN accounting_instruments i
          ON i."ownerId" = l."ownerId" AND i.id = l."instrumentId"
        WHERE l."ownerId" = $1 AND l.provider = 'tbank'
          AND (l."providerInstrumentId" = ANY($2::text[]) OR l."assetUid" = ANY($3::uuid[]))`,
      [
        owner,
        [...facts.values()].flatMap((fact) => [...fact.uids]),
        [...facts.values()].flatMap((fact) => (fact.assetUid ? [fact.assetUid] : [])),
      ],
    );
    const resolved = resolveLinks(facts, saved);
    if (!resolved) throw conflict();
    for (const [uid, row] of resolved) {
      securities.set(uid, { id: row.id, name: row.name, symbol: row.symbol });
      if (write) await learnLinkFacts(manager, owner, row, facts.get(uid)!);
    }
    const linked = [...resolved]
      .filter(([uid]) => !created.has(uid))
      .map(([uid, row]) => [uid, row.id])
      .sort();
    for (const [uid, entry] of wanted) {
      if (securities.has(uid)) continue;
      securities.set(
        uid,
        write
          ? await createSecurity(manager, owner, uid, entry, facts, created)
          : { id: `new-${uid}`, ...securityName(uid, entry) },
      );
    }
    return { cash, securities, linked };
  }
}

/** SPLIT: saves the splits declared with an import for every account of the owner. */
async function saveDeclaredSplits(
  manager: EntityManager,
  owner: string,
  requestId: string,
  declaredSplits: Review['declaredSplits'],
) {
  for (const split of declaredSplits)
    await manager.query(
      `INSERT INTO instrument_splits
              (id, "ownerId", "instrumentId", "effectiveAt", ratio, "requestId", "canonicalPayload")
              VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        owner,
        split.instrumentId,
        split.effectiveAt,
        split.ratio,
        randomUUID(),
        JSON.stringify({ importRequestId: requestId, ...split }),
      ],
    );
}

/** Writes one journal entry at its revision; the id of the trade, reward or return it became. */
async function writeEntry(
  manager: EntityManager,
  owner: string,
  account: string,
  entry: JournalEntry,
  revision: number,
) {
  let tradeId: string | null = null;
  let rewardId: string | null = null;
  let capitalReturnId: string | null = null;
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
  } else if (entry.capitalReturn) {
    capitalReturnId = randomUUID();
    const { capitalReturnId: _, version, ...fields } = entry.capitalReturn;
    const requestId = randomUUID();
    await appendCapitalReturnVersion(manager, owner, {
      ...fields,
      capitalReturnId,
      version,
      accountId: account,
      kind: 'create',
      requestId,
      journalRevision: revision,
      rate: entry.rate,
      canonicalPayload: capitalReturnPayload('create', {
        expectedJournalRevision: revision - 1,
        instrumentId: fields.instrumentId,
        cashInstrumentId: fields.cashInstrumentId,
        occurredAt: fields.occurredAt,
        orderWithinTimestamp: fields.orderWithinTimestamp,
        amount: fields.amount,
        amountUsd: fields.amountUsd,
        paidCurrency: fields.paidCurrency,
        rate: entry.rate,
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
  return { tradeId, rewardId, capitalReturnId };
}

/** The cash asset of each currency the opening or the plan moves; one not used is not read. */
async function cashInstruments(
  manager: EntityManager,
  owner: string,
  plan: readonly PlanEntry[],
  write: boolean,
  opening?: BrokerOpening,
) {
  const cash = {} as Record<CashCurrency, ImportInstrument>;
  for (const code of ['RUB', 'USD', 'EUR'] as const) {
    const asset = cashAsset[code];
    const used =
      opening?.lots.some((lot) => lot.asset === `cash:${code}`) ||
      plan.some(
        (entry) =>
          cashCurrency[entry.currency] === code ||
          (entry.cash !== undefined && cashCurrency[entry.cash] === code),
      );
    const found = used ? await findOrCreateInstrument(manager, owner, asset, write) : null;
    cash[code] = found ?? { id: `new-cash-${code}`, name: asset.name, symbol: asset.symbol };
  }
  return cash;
}

/**
 * The securities the import needs an instrument for, by UID: those of the opening holdings this
 * history holds, then those the plan trades.
 */
function wantedSecurities(
  plan: readonly PlanEntry[],
  opening: BrokerOpening | undefined,
  available: ReturnType<typeof openingAssets>,
) {
  const wanted = new Map<string, Pick<PlanEntry, 'ticker' | 'currency'>>();
  for (const asset of available)
    if (!asset.asset.startsWith('cash:') && opening?.lots.some((lot) => lot.asset === asset.asset))
      wanted.set(asset.asset, {
        ticker: asset.label === asset.asset ? '' : asset.label,
        currency: asset.currency,
      });
  for (const entry of plan)
    if (
      entry.record === 'trade' &&
      entry.instrumentUid &&
      !entry.cash &&
      !wanted.has(entry.instrumentUid)
    )
      wanted.set(entry.instrumentUid, entry);
  return wanted;
}

/** A link saved before asset UIDs were kept learns them from the import that names it. */
async function learnLinkFacts(
  manager: EntityManager,
  owner: string,
  row: SavedLink,
  fact: InstrumentFacts,
) {
  if ((!row.assetUid && fact.assetUid) || (!row.instrumentType && fact.instrumentType))
    await manager.query(
      `UPDATE broker_instrument_links
            SET "assetUid" = COALESCE("assetUid", $3), "instrumentType" = COALESCE("instrumentType", $4)
            WHERE "ownerId" = $1 AND provider = 'tbank' AND "providerInstrumentId" = $2`,
      [owner, row.uid, fact.assetUid ?? null, fact.instrumentType ?? null],
    );
}

/** A new security's asset is named by its ticker, else by its UID. */
const securityName = (uid: string, entry: Pick<PlanEntry, 'ticker'>) => ({
  name: entry.ticker || `T-Bank ${uid}`,
  symbol: entry.ticker || null,
});

/** A new asset priced by hand in the security's trade currency, linked to its UID. */
async function createSecurity(
  manager: EntityManager,
  owner: string,
  uid: string,
  entry: Pick<PlanEntry, 'ticker' | 'currency'>,
  facts: ReadonlyMap<string, InstrumentFacts>,
  created: Set<string>,
): Promise<ImportInstrument> {
  const { name, symbol } = securityName(uid, entry);
  const value = {
    requestId: randomUUID(),
    name,
    symbol,
    assetType: 'manual' as const,
    valuationCurrency: cashCurrency[entry.currency],
  };
  const classification = classifyAsset(value);
  const [instrument]: ImportInstrument[] = await manager.query(
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
  const fact = facts.get(uid)!;
  await manager.query(
    `INSERT INTO broker_instrument_links ("ownerId", provider, "providerInstrumentId",
            "instrumentId", "assetUid", "instrumentType")
          VALUES ($1, 'tbank', $2, $3, $4, $5)`,
    [owner, uid, instrument.id, fact.assetUid ?? null, fact.instrumentType ?? null],
  );
  created.add(uid);
  return instrument;
}

/** A problem with the operations it names; the first 50 are enough to find them. */
function listed(reason: ImportProblem['reason'], operationIds: string[]): ImportProblem {
  return { reason, occurredAt: null, ticker: '', operationIds: operationIds.slice(0, 50) };
}

function problemOf(reason: ImportProblem['reason'], entry: JournalEntry): ImportProblem {
  return {
    reason,
    occurredAt: recordOf(entry).occurredAt,
    ticker: entry.source.ticker,
    operationIds: entry.source.operationIds,
  };
}

/** The instrument of an asset key: `cash:<code>` names cash, any other key a security's UID. */
const instrumentOf = (instruments: ImportInstruments, key: string) =>
  key.startsWith('cash:')
    ? instruments.cash[key.slice(5) as CashCurrency]
    : instruments.securities.get(key);

/** Refuses opening holdings and splits of assets this history does not hold. */
function assertInHistory(
  opening: BrokerOpening | undefined,
  splits: readonly BrokerSplit[],
  available: ReturnType<typeof openingAssets>,
) {
  if (opening?.lots.some((lot) => !available.some((asset) => asset.asset === lot.asset)))
    throw new BadRequestException('An opening holding is not in this broker history');
  if (
    splits.some(
      (split) => !available.some((asset) => asset.asset === split.asset && splittable(asset)),
    )
  )
    throw new BadRequestException('A split security is not a share or fund in this broker history');
}

/** The declared splits by their accounting instrument; one already saved is refused. */
function declaredSplitsOf(
  splits: readonly BrokerSplit[],
  instruments: ImportInstruments,
  saved: readonly FifoSplit[],
) {
  return splits.map((split) => {
    const instrument = instruments.securities.get(split.asset);
    if (!instrument)
      throw new BadRequestException('A split security is not in this broker history');
    if (
      saved.some(
        (row) => row.instrumentId === instrument.id && row.effectiveAt === split.effectiveAt,
      )
    )
      throw new BadRequestException('This split is already recorded');
    return { instrumentId: instrument.id, effectiveAt: split.effectiveAt, ratio: split.ratio };
  });
}

/** The opening holdings as the carried-in lots the import saves. */
function openingLotsOf(
  opening: BrokerOpening | undefined,
  instruments: ImportInstruments,
): FifoCarryInInput[] {
  return (opening?.lots ?? []).map((lot, index): FifoCarryInInput => {
    const instrument = instrumentOf(instruments, lot.asset);
    if (!instrument) throw new BadRequestException('Opening instrument is unavailable');
    return {
      lotId: `opening-${index}`,
      openingRevision: 1,
      ordinal: index + 1,
      instrumentId: instrument.id,
      instrumentName: instrument.name,
      instrumentSymbol: instrument.symbol,
      acquiredAt: lot.acquiredAt,
      orderWithinTimestamp: index,
      originalQuantity: lot.quantity,
      originalCostUsd: lot.costUsd,
      carriedQuantity: lot.quantity,
    };
  });
}

/** Whether a journal still keeps the plan's `added` entries under its caps across the owner. */
const fitsCaps = (
  planFits: boolean,
  added: number,
  counts: { activeCount: number; versionCount: number },
  active: number,
  versions: number,
) => planFits && counts.activeCount + added <= active && counts.versionCount + added <= versions;

/** The units each instrument holds after the replay. */
function replayedQuantities(lots: readonly { instrumentId: string; remainingQuantity: string }[]) {
  const actual = new Map<string, bigint>();
  for (const lot of lots)
    actual.set(
      lot.instrumentId,
      (actual.get(lot.instrumentId) ?? 0n) + canonicalDecimalToAtoms(lot.remainingQuantity),
    );
  return actual;
}

/**
 * The units T-Bank reports for each security UID or `cash:<code>`; a negative quantity or one of
 * a kind the import does not keep makes the holding invalid.
 */
function reportedQuantities(positions: readonly TBankPosition[]) {
  const reported = new Map<string, { quantity: bigint; invalid: boolean }>();
  for (const position of positions) {
    if (position.virtual) continue;
    const code = cashPositionCurrency(position);
    const key = code ? `cash:${code}` : position.instrumentUid;
    const invalid =
      position.quantity.startsWith('-') ||
      (position.quantity !== '0' &&
        !['share', 'bond', 'etf'].includes(position.instrumentType) &&
        !(position.instrumentType === 'currency' && position.currencyCode));
    const before = reported.get(key);
    reported.set(key, {
      quantity:
        (before?.quantity ?? 0n) + (invalid ? 0n : canonicalDecimalToAtoms(position.quantity)),
      invalid: invalid || (before?.invalid ?? false),
    });
  }
  return reported;
}

/**
 * The replayed holdings against what T-Bank reports, in both directions and including cash:
 * opening lots cannot invent a current balance. Each that differs is a problem; cash above what
 * T-Bank reports is also a BROKER-CASH-GAP, by lower-case currency code.
 */
function compareHoldings(
  lots: readonly { instrumentId: string; remainingQuantity: string }[],
  positions: readonly TBankPosition[],
  instruments: ImportInstruments,
  available: ReturnType<typeof openingAssets>,
  found: { problems: ImportProblem[]; cashGaps: Map<string, string> },
) {
  const actual = replayedQuantities(lots);
  const reported = reportedQuantities(positions);
  const keys = new Set([
    ...instruments.securities.keys(),
    'cash:USD',
    'cash:EUR',
    'cash:RUB',
    ...reported.keys(),
  ]);
  for (const key of keys) {
    const instrument = instrumentOf(instruments, key);
    const quantity = instrument ? (actual.get(instrument.id) ?? 0n) : 0n;
    const expected = reported.get(key);
    if (noneEitherWay(quantity, expected)) continue;
    // Only cash T-Bank names an amount for: an absent position is not a reported zero.
    if (
      key.startsWith('cash:') &&
      instrument &&
      expected &&
      !expected.invalid &&
      quantity > expected.quantity
    )
      found.cashGaps.set(key.slice(5).toLowerCase(), formatAtoms(quantity - expected.quantity));
    if (!instrument || expected?.invalid || quantity !== (expected?.quantity ?? 0n))
      found.problems.push({
        reason: 'opening-holding',
        occurredAt: null,
        ticker: available.find((asset) => asset.asset === key)?.label ?? key,
        operationIds: [],
      });
  }
}

/** Neither the replay nor T-Bank holds any of it, and T-Bank reports nothing invalid. */
const noneEitherWay = (quantity: bigint, expected?: { quantity: bigint; invalid: boolean }) =>
  quantity === 0n && (!expected || expected.quantity === 0n) && !expected?.invalid;

/**
 * Replays the account as its journal will. A holding that then differs from what T-Bank reports,
 * cash above it, or else the first entry that spends more than is held goes to `found`.
 */
function checkReplay(
  replayed: OwnedAccountInput,
  replaySplits: readonly FifoSplit[],
  review: {
    positions: readonly TBankPosition[];
    entries: readonly JournalEntry[];
    instruments: ImportInstruments;
    available: ReturnType<typeof openingAssets>;
  },
  found: { problems: ImportProblem[]; cashGaps: Map<string, string> },
) {
  const account = replayed.accountId;
  try {
    const result = calculateOwnedTransfers([replayed], [], undefined, replaySplits).accounts.get(
      account,
    )!;
    compareHoldings(result.lots, review.positions, review.instruments, review.available, found);
  } catch (error) {
    if (error instanceof OwnedTransferCapacityError || !(error instanceof FifoHistoryError))
      throw error;
    found.problems.push(
      shortfallProblem(account, replayed, replaySplits, review.entries, review.instruments),
    );
  }
}

/**
 * The first entry that spends more than the account holds then, such as a sale of shares that
 * came in by a transfer the import leaves out.
 */
function shortfallProblem(
  account: string,
  replayed: OwnedAccountInput,
  replaySplits: readonly FifoSplit[],
  entries: readonly JournalEntry[],
  instruments: ImportInstruments,
): ImportProblem {
  const shortfall = firstShortfall({
    accounts: new Map([[account, replayed]]),
    transfers: [],
    splits: replaySplits,
  });
  const id = shortfall?.operationId.replace(/^(trade|reward|capital-return):/, '');
  const entry = entries.find(
    (item) =>
      (item.trade?.tradeId ?? item.reward?.rewardId ?? item.capitalReturn?.capitalReturnId) === id,
  );
  const deficient =
    shortfall &&
    [...Object.values(instruments.cash), ...instruments.securities.values()].find(
      (instrument) => instrument.id === shortfall.instrumentId,
    );
  return entry && shortfall
    ? {
        ...problemOf('not-held', entry),
        ticker: deficient?.symbol ?? deficient?.name ?? entry.source.ticker,
        availableQuantity: shortfall.availableQuantity,
        requiredQuantity: shortfall.requiredQuantity,
        missingQuantity: shortfall.missingQuantity,
      }
    : { reason: 'not-held', occurredAt: null, ticker: '', operationIds: [] };
}

/** The amounts an entry becomes at the rates stored now, as the preview hash pins them. */
function derivedAmounts(entry: JournalEntry) {
  const { trade, reward, capitalReturn } = entry;
  if (trade)
    return [
      trade.side,
      trade.quantity,
      trade.grossUsd,
      trade.feeUsd,
      trade.paid ?? null,
      trade.purpose ?? null,
      trade.settlement?.quantity ?? null,
    ];
  if (capitalReturn)
    return [
      'capital-return',
      capitalReturn.amount,
      capitalReturn.amountUsd,
      capitalReturn.paidCurrency,
      entry.rate,
    ];
  return [reward.quantity, reward.acquisitionBasisUsd, reward.incomeValueUsd];
}

/** Each operation's identities, as the preview hash pins them. */
const hashedOperations = (operations: readonly TBankOperation[]) =>
  operations
    .map((operation) => [
      operation.id,
      operation.instrumentUid,
      operation.positionUid ?? '',
      operation.providerInstrumentUid ?? operation.instrumentUid,
      operation.assetUid ?? '',
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));

/** Each held position's identities and holding, as the preview hash pins them. */
const hashedPositions = (positions: readonly TBankPosition[]) =>
  positions
    .filter((position) => !position.virtual)
    .map((position) => [
      position.instrumentUid,
      position.positionUid ?? '',
      position.providerInstrumentUid ?? position.instrumentUid,
      position.instrumentType,
      position.quantity,
      position.currentPriceCurrency,
      position.averagePriceCurrency,
      position.currencyCode ?? '',
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));

/**
 * Saved splits of the securities earlier imports linked, by this history's own UIDs, for the
 * planner: a link matches an operation by any of its provider UIDs or by its asset UID, since
 * another account may hold the security under another trading mode or venue.
 */
async function readLinkedSplits(
  manager: EntityManager,
  owner: string,
  operations: readonly TBankOperation[],
): Promise<{ uid: string; effectiveAt: string; ratio: bigint }[]> {
  const rows: { providerUid: string; assetUid: string | null; effectiveAt: Date; ratio: number }[] =
    await manager.query(
      `SELECT l."providerInstrumentId" AS "providerUid", l."assetUid", s."effectiveAt", s.ratio
        FROM instrument_splits s
        JOIN broker_instrument_links l
          ON l."ownerId" = s."ownerId" AND l."instrumentId" = s."instrumentId" AND l.provider = 'tbank'
        WHERE s."ownerId" = $1 AND s."removedAt" IS NULL
        ORDER BY s."effectiveAt", l."providerInstrumentId"`,
      [owner],
    );
  const found = new Map<string, { uid: string; effectiveAt: string; ratio: bigint }>();
  for (const row of rows)
    for (const operation of operations) {
      if (!operation.instrumentUid) continue;
      const same =
        operation.instrumentUid === row.providerUid ||
        operation.providerInstrumentUid === row.providerUid ||
        (row.assetUid !== null && operation.assetUid === row.assetUid);
      if (!same) continue;
      const effectiveAt = row.effectiveAt.toISOString();
      found.set(`${operation.instrumentUid} ${effectiveAt}`, {
        uid: operation.instrumentUid,
        effectiveAt,
        ratio: BigInt(row.ratio),
      });
    }
  return [...found.values()];
}

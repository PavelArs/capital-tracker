import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import {
  appendRewardVersion,
  projectRewardVersion,
  REWARD_LIMITS,
  type RewardKind,
  type RewardVersionRow,
  readRewardCounts,
  readRewardHead,
  readRewardReplay,
  rewardHeadJoin,
  rewardReceipt,
  rewardVersionSelect,
} from './asset-reward.store';
import {
  parseRewardCorrection,
  parseRewardCreate,
  parseRewardHistoryQuery,
  parseRewardListQuery,
  parseRewardVoid,
  type RewardCorrectionInput,
  type RewardCreateInput,
  type RewardVoidInput,
  rewardPayload,
} from './asset-reward-input';
import type { FifoReward } from './asset-reward-types';
import { refuseProducedEntry } from './chain-produced';
import {
  advanceConnectedJournals,
  assertRevisionCapacity,
  notCovered,
  projectConnectedLedger,
  readConnectedLedger,
  rethrowAccountingHistory,
} from './connected-accounting.store';
import { parseUuid } from './input';
import { readJournal, readOwnedAccount, startEmptyJournal } from './trade-journal.store';
import { automaticOrder } from './trade-order';

const conflict = () => new ConflictException('Reward request conflicts with saved state');
type RewardFields = Omit<
  FifoReward,
  'rewardId' | 'version' | 'instrumentName' | 'instrumentSymbol' | 'orderWithinTimestamp'
> & { orderWithinTimestamp: number | null };
function fields(value: RewardFields): RewardFields {
  return {
    instrumentId: value.instrumentId,
    category: value.category,
    occurredAt: value.occurredAt,
    orderWithinTimestamp: value.orderWithinTimestamp,
    quantity: value.quantity,
    acquisitionBasisUsd: value.acquisitionBasisUsd,
    incomeValueUsd: value.incomeValueUsd,
  };
}

@Injectable()
export class AssetRewardService {
  constructor(private readonly source: DataSource) {}

  async create(owner: string, account: string, raw: unknown) {
    return this.mutate(parseUuid(owner), parseUuid(account), 'create', parseRewardCreate(raw));
  }
  async correct(owner: string, account: string, id: string, raw: unknown) {
    return this.mutate(
      parseUuid(owner),
      parseUuid(account),
      'correct',
      parseRewardCorrection(raw),
      parseUuid(id),
    );
  }
  async void(owner: string, account: string, id: string, raw: unknown) {
    return this.mutate(
      parseUuid(owner),
      parseUuid(account),
      'void',
      parseRewardVoid(raw),
      parseUuid(id),
    );
  }

  private async mutate(
    owner: string,
    accountId: string,
    kind: RewardKind,
    input: RewardCreateInput | RewardCorrectionInput | RewardVoidInput,
    target?: string,
  ) {
    try {
      return await this.source.transaction(async (manager) => {
        if (target !== undefined) await refuseProducedEntry(manager, owner, 'rewardId', target);
        return this.mutateWithin(manager, owner, accountId, kind, input, target);
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
  }

  /**
   * One create, correction or void inside the caller's transaction, under the owner's
   * accounting lock (M12 classification). The caller rethrows history errors.
   */
  async mutateWithin(
    manager: EntityManager,
    owner: string,
    accountId: string,
    kind: RewardKind,
    input: RewardCreateInput | RewardCorrectionInput | RewardVoidInput,
    target?: string,
  ) {
    const canonicalPayload = rewardPayload(kind, input, target);
    await lockAccountingOwner(manager, owner);
    const replay = await readRewardReplay(manager, owner, accountId, input.requestId);
    if (replay) {
      if (replay.canonicalPayload !== canonicalPayload) throw conflict();
      return { created: false, value: rewardReceipt(replay) };
    }
    const owned = await readOwnedAccount(manager, owner, accountId);
    // The first operation of an account starts its journal (M9, OPS-ADD-BUY).
    if (kind === 'create' && input.expectedJournalRevision === 0)
      await startEmptyJournal(manager, owner, owned, input.requestId);
    const row =
      target === undefined ? undefined : await readRewardHead(manager, owner, accountId, target);
    if (target !== undefined && !row) throw new NotFoundException();
    const current = row ? projectRewardVersion(row) : undefined;
    if (
      'expectedVersion' in input &&
      (current?.kind === 'void' || current?.version !== input.expectedVersion)
    )
      throw conflict();
    const values = 'quantity' in input ? fields(input) : current && fields(current);
    if (!values) throw new Error('Reward fields required');
    const [instrument]: { name: string; symbol: string | null }[] = await manager.query(
      'SELECT name,symbol FROM accounting_instruments WHERE "ownerId"=$1 AND id=$2',
      [owner, values.instrumentId],
    );
    if (!instrument) throw new NotFoundException();
    const ownerCounts = await readRewardCounts(manager, owner);
    const accountCounts = await readRewardCounts(manager, owner, accountId);
    for (const counts of [ownerCounts, accountCounts]) {
      if (
        counts.versionCount >= REWARD_LIMITS.versions ||
        (kind === 'create' && counts.activeCount >= REWARD_LIMITS.activeRewards)
      )
        throw conflict();
    }
    const ledger = await readConnectedLedger(manager, owner, [accountId], { lock: true });
    const account = ledger.accounts.get(accountId)!;
    if (account.journal.currentRevision !== input.expectedJournalRevision) throw conflict();
    if (kind !== 'void' && values.occurredAt < account.coverageFrom)
      throw notCovered(accountId, account.coverageFrom);
    assertRevisionCapacity(ledger);
    const rewardId = target ?? randomUUID();
    const orderWithinTimestamp =
      values.orderWithinTimestamp ??
      automaticOrder(
        {
          ...account,
          rewards: (account.rewards ?? []).filter((reward) => reward.rewardId !== rewardId),
        },
        ledger.transfers,
        values.occurredAt,
        undefined,
      );
    if (orderWithinTimestamp === null) throw conflict();
    const next = {
      ...values,
      orderWithinTimestamp,
      rewardId,
      version: (current?.version ?? 0) + 1,
      instrumentName: instrument.name,
      instrumentSymbol: instrument.symbol,
    };
    const rewards = (account.rewards ?? []).filter((reward) => reward.rewardId !== rewardId);
    if (kind !== 'void') rewards.push(next);
    projectConnectedLedger(ledger);
    projectConnectedLedger(ledger, { accountId, rewards });
    const receipt = await appendRewardVersion(manager, owner, {
      ...next,
      accountId,
      kind,
      requestId: input.requestId,
      canonicalPayload,
      journalRevision: account.journal.currentRevision + 1,
    });
    await advanceConnectedJournals(manager, owner, ledger);
    return { created: true, value: receipt };
  }

  private read<T>(work: (manager: EntityManager) => Promise<T>) {
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      try {
        return await work(manager);
      } catch (error) {
        return rethrowAccountingHistory(error);
      }
    });
  }

  async list(ownerId: string, id: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const accountId = parseUuid(id);
    const query = parseRewardListQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, accountId);
      const journal = await readJournal(manager, owner, accountId);
      if (
        !journal ||
        (query.journalRevision !== undefined && query.journalRevision !== journal.currentRevision)
      )
        throw conflict();
      const counts = await readRewardCounts(manager, owner, accountId);
      const rows: RewardVersionRow[] = await manager.query(
        `${rewardVersionSelect} ${rewardHeadJoin} WHERE v."ownerId"=$1 AND v."accountId"=$2
          ORDER BY v."rewardId" OFFSET $3 LIMIT $4`,
        [owner, accountId, query.offset, query.limit],
      );
      return {
        accountId,
        journalRevision: journal.currentRevision,
        activeCount: counts.activeCount,
        versionCount: counts.versionCount,
        limits: REWARD_LIMITS,
        items: rows.map(projectRewardVersion),
        nextOffset:
          query.offset + rows.length < counts.headCount ? query.offset + rows.length : null,
      };
    });
  }

  async listVersions(ownerId: string, id: string, rewardId: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const accountId = parseUuid(id);
    const target = parseUuid(rewardId);
    const query = parseRewardHistoryQuery(raw);
    return this.read(async (manager) => {
      await readOwnedAccount(manager, owner, accountId);
      if (!(await readRewardHead(manager, owner, accountId, target))) throw new NotFoundException();
      const rows: RewardVersionRow[] = await manager.query(
        `${rewardVersionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."rewardId"=$3 AND v.version<$4
          ORDER BY v.version DESC LIMIT $5`,
        [owner, accountId, target, query.beforeVersion ?? 10001, query.limit + 1],
      );
      const items = rows.slice(0, query.limit).map(projectRewardVersion);
      return {
        items,
        nextBeforeVersion: rows.length > query.limit ? items[items.length - 1].version : null,
      };
    });
  }
}

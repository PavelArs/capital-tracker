import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { lockAccountingOwner } from './accounting-lock';
import { AssetRewardService } from './asset-reward.service';
import { projectRewardVersion, readRewardHead } from './asset-reward.store';
import { parseRewardCreate, parseRewardVoid } from './asset-reward-input';
import {
  type ChainLeg,
  type ClassificationInput,
  chainCoins,
  classificationPayload,
  type PlannedOperation,
  parseClassification,
  planOperation,
} from './chain-classification';
import { rethrowAccountingHistory } from './connected-accounting.store';
import { parseUuid } from './input';
import { findOrCreateInstrument, TradeService } from './trade.service';
import { parseTradeCreate, parseTradeVoid } from './trade-input';
import { readJournal } from './trade-journal.store';

interface LegRow {
  network: 'bitcoin';
  accountId: string | null;
  blockTime: Date;
  receivedUnits: string;
  sentUnits: string;
}
export interface ClassificationRow {
  addressId: string;
  txid: string;
  version: number;
  requestId: string;
  canonicalPayload: string;
  status: 'unclassified' | 'classified' | 'hidden';
  type: string | null;
  details: ClassificationInput['classification'];
  comment: string | null;
  accountId: string | null;
  tradeId: string | null;
  rewardId: string | null;
  createdAt: Date;
}

const versionColumns = `v."addressId", v.txid, v.version, v."requestId", v."canonicalPayload",
  v.status, v.type, v.details, v.comment, v."accountId", v."tradeId", v."rewardId", v."createdAt"`;
const conflict = () => new ConflictException('Classification request conflicts with saved state');

/** The receipt: the classification as stored now and the journal entry it produced. */
export function classificationView(row: ClassificationRow) {
  return {
    addressId: row.addressId,
    txid: row.txid,
    version: row.version,
    status: row.status,
    type: row.type,
    classification: row.details,
    comment: row.comment,
    operation: row.tradeId
      ? { kind: 'trade' as const, accountId: row.accountId, id: row.tradeId }
      : row.rewardId
        ? { kind: 'reward' as const, accountId: row.accountId, id: row.rewardId }
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const leg = (row: LegRow): ChainLeg => ({
  network: row.network,
  blockTime: row.blockTime.toISOString(),
  receivedUnits: row.receivedUnits,
  sentUnits: row.sentUnits,
});

/** What decides the produced entry: same answer, same account, same note keep it as it is. */
const operationKey = (
  accountId: string | null,
  value: ClassificationInput['classification'],
  comment: string | null,
) => JSON.stringify({ accountId, value, comment });

@Injectable()
export class ChainClassificationService {
  constructor(
    private readonly source: DataSource,
    private readonly trades: TradeService,
    private readonly rewards: AssetRewardService,
  ) {}

  /**
   * CLS-BUY, CLS-HIDE, CLS-RECLASSIFY: records the owner's answer as a new version and keeps
   * the one journal entry it stands for in step, in one transaction. A changed answer adds the
   * new entry before voiding the old one, so sales that spent the coins stay covered.
   */
  async classify(ownerId: string, addressId: string, txid: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const address = parseUuid(addressId);
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new NotFoundException();
    const input = parseClassification(raw);
    const payload = classificationPayload(address, txid, input);
    // Raw rows are never updated, so the entry can be checked before the write starts: a
    // malformed amount is a 400 here, not a conflict inside the journal.
    const before = await this.readLeg(this.source.manager, owner, address, txid);
    const planned =
      input.classification && !input.hidden
        ? planOperation(leg(before), input.classification, input.comment)
        : null;
    if (planned) this.check(planned);
    try {
      return await this.source.transaction(async (manager) => {
        await lockAccountingOwner(manager, owner);
        const [replay]: ClassificationRow[] = await manager.query(
          `SELECT ${versionColumns} FROM chain_transaction_classification_versions v
            WHERE v."ownerId"=$1 AND v."requestId"=$2`,
          [owner, input.requestId],
        );
        if (replay) {
          if (replay.canonicalPayload !== payload) throw conflict();
          return { created: false, value: classificationView(replay) };
        }
        const row = await this.readLeg(manager, owner, address, txid);
        const [head]: { currentVersion: number }[] = await manager.query(
          `SELECT "currentVersion" FROM chain_transaction_classifications
            WHERE "addressId"=$1 AND txid=$2 FOR UPDATE`,
          [address, txid],
        );
        if ((head?.currentVersion ?? 0) !== input.expectedVersion) throw conflict();
        const current = head
          ? await this.version(manager, address, txid, head.currentVersion)
          : null;
        const live = current && (await this.active(manager, owner, current)) ? current : null;
        const comment = input.comment ?? null;
        if (planned && row.accountId === null)
          throw new UnprocessableEntityException('Choose the account of this wallet first');
        const keep =
          live !== null &&
          planned !== null &&
          operationKey(live.accountId, live.details, live.comment) ===
            operationKey(row.accountId, input.classification, comment);
        let produced = keep
          ? { accountId: live.accountId, tradeId: live.tradeId, rewardId: live.rewardId }
          : { accountId: null, tradeId: null, rewardId: null };
        if (!keep && planned && row.accountId)
          produced = await this.produce(
            manager,
            owner,
            { ...row, accountId: row.accountId },
            planned,
          );
        if (!keep && live) await this.retire(manager, owner, live);
        const version = (head?.currentVersion ?? 0) + 1;
        if (head)
          await manager.query(
            `UPDATE chain_transaction_classifications SET "currentVersion"=$3
              WHERE "addressId"=$1 AND txid=$2`,
            [address, txid, version],
          );
        else
          await manager.query(
            `INSERT INTO chain_transaction_classifications ("ownerId","addressId",txid,"currentVersion")
              VALUES ($1,$2,$3,$4)`,
            [owner, address, txid, version],
          );
        const status = input.hidden
          ? 'hidden'
          : input.classification
            ? 'classified'
            : 'unclassified';
        const [saved]: ClassificationRow[] = await manager.query(
          `INSERT INTO chain_transaction_classification_versions AS v
            ("ownerId","addressId",txid,version,"requestId","canonicalPayload",status,type,details,
             comment,"accountId","tradeId","rewardId")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) RETURNING ${versionColumns}`,
          [
            owner,
            address,
            txid,
            version,
            input.requestId,
            payload,
            status,
            input.classification?.type ?? null,
            input.classification === null ? null : JSON.stringify(input.classification),
            comment,
            produced.accountId,
            produced.tradeId,
            produced.rewardId,
          ],
        );
        return { created: true, value: classificationView(saved) };
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
  }

  /** CLS-COUNT: chain transactions nobody has classified or hidden. */
  async needsClassificationCount(ownerId: string): Promise<{ count: number }> {
    const owner = parseUuid(ownerId);
    const [{ count }]: { count: number }[] = await this.source.query(
      `SELECT count(*)::int AS count FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE t."ownerId"=$1 AND (v.status IS NULL OR v.status='unclassified')`,
      [owner],
    );
    return { count };
  }

  /** The planned entry must parse as its journal takes it, with placeholder pins. */
  private check(planned: PlannedOperation) {
    const pins = {
      requestId: randomUUID(),
      expectedJournalRevision: 0,
      instrumentId: randomUUID(),
    };
    if (planned.journal === 'trade') parseTradeCreate({ ...planned.fields, ...pins });
    else parseRewardCreate({ ...planned.fields, ...pins });
  }

  private async readLeg(manager: EntityManager, owner: string, address: string, txid: string) {
    const [row]: LegRow[] = await manager.query(
      `SELECT w.network, w."accountId", t."blockTime", t."receivedUnits"::text AS "receivedUnits",
          t."sentUnits"::text AS "sentUnits"
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        WHERE t."ownerId"=$1 AND t."addressId"=$2 AND t.txid=$3`,
      [owner, address, txid],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  private async version(manager: EntityManager, address: string, txid: string, version: number) {
    const [row]: ClassificationRow[] = await manager.query(
      `SELECT ${versionColumns} FROM chain_transaction_classification_versions v
        WHERE v."addressId"=$1 AND v.txid=$2 AND v.version=$3`,
      [address, txid, version],
    );
    if (!row) throw new Error('Missing classification version');
    return row;
  }

  /** Whether the entry a version produced still counts; one voided elsewhere does not. */
  private async active(manager: EntityManager, owner: string, row: ClassificationRow) {
    if (row.accountId === null) return false;
    if (row.tradeId) {
      const [head]: { kind: string }[] = await manager.query(
        `SELECT v.kind FROM account_trades t
          JOIN account_trade_versions v ON v."ownerId"=t."ownerId" AND v."accountId"=t."accountId"
            AND v."tradeId"=t.id AND v.version=t."currentVersion"
          WHERE t."ownerId"=$1 AND t."accountId"=$2 AND t.id=$3`,
        [owner, row.accountId, row.tradeId],
      );
      return head !== undefined && head.kind !== 'void';
    }
    if (row.rewardId) {
      const head = await readRewardHead(manager, owner, row.accountId, row.rewardId);
      return head !== undefined && projectRewardVersion(head).kind !== 'void';
    }
    return false;
  }

  private async revision(manager: EntityManager, owner: string, accountId: string) {
    return (await readJournal(manager, owner, accountId))?.currentRevision ?? 0;
  }

  private async produce(
    manager: EntityManager,
    owner: string,
    row: LegRow & { accountId: string },
    planned: PlannedOperation,
  ) {
    const coin = await findOrCreateInstrument(manager, owner, chainCoins[row.network], true);
    if (!coin) throw new Error('Chain coin was not created');
    const pins = {
      requestId: randomUUID(),
      expectedJournalRevision: await this.revision(manager, owner, row.accountId),
      instrumentId: coin.id,
    };
    if (planned.journal === 'trade') {
      const { value } = await this.trades.mutateWithin(
        manager,
        owner,
        row.accountId,
        'create',
        undefined,
        parseTradeCreate({ ...planned.fields, ...pins }),
      );
      return { accountId: row.accountId, tradeId: value.trade.tradeId, rewardId: null };
    }
    const { value } = await this.rewards.mutateWithin(
      manager,
      owner,
      row.accountId,
      'create',
      parseRewardCreate({ ...planned.fields, ...pins }),
    );
    return { accountId: row.accountId, tradeId: null, rewardId: value.reward.rewardId };
  }

  /** Voids the entry an earlier answer produced; its versions stay (CLS-RECLASSIFY). */
  private async retire(manager: EntityManager, owner: string, row: ClassificationRow) {
    const accountId = row.accountId!;
    const expectedJournalRevision = await this.revision(manager, owner, accountId);
    if (row.tradeId) {
      await this.trades.mutateWithin(
        manager,
        owner,
        accountId,
        'void',
        row.tradeId,
        parseTradeVoid({ requestId: randomUUID(), expectedJournalRevision }),
      );
      return;
    }
    const head = await readRewardHead(manager, owner, accountId, row.rewardId!);
    if (!head) throw new Error('Missing produced reward');
    await this.rewards.mutateWithin(
      manager,
      owner,
      accountId,
      'void',
      parseRewardVoid({
        requestId: randomUUID(),
        expectedJournalRevision,
        expectedVersion: projectRewardVersion(head).version,
      }),
      row.rewardId!,
    );
  }
}

import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { readDustThreshold } from '../owner-settings/owner-settings.service';
import { latestMarketPrices } from '../prices/market-price.store';
import { lockAccountingOwner } from './accounting-lock';
import { AssetRewardService } from './asset-reward.service';
import { projectRewardVersion, readRewardHead } from './asset-reward.store';
import { parseRewardCreate, parseRewardVoid } from './asset-reward-input';
import {
  type ChainLeg,
  type ClassificationInput,
  chainCoin,
  classificationPayload,
  fitsDirection,
  legMovement,
  type PlannedOperation,
  parseClassification,
  planOperation,
  unfit,
} from './chain-classification';
import { isDust } from './chain-dust';
import {
  type OwnLeg,
  ownTransferPairs,
  type PlannedTransfer,
  planTransfer,
} from './chain-transfer';
import { rethrowAccountingHistory } from './connected-accounting.store';
import { FifoHistoryError } from './fifo';
import { parseUuid } from './input';
import { estimate } from './operation-list';
import { OwnedTransferService } from './owned-transfer.service';
import { readTransferHead } from './owned-transfer.store';
import { parseTransferCreate, parseTransferVoid } from './owned-transfer-input';
import { ensureChainCoins } from './portfolio-valuation.service';
import { findOrCreateInstrument, TradeService } from './trade.service';
import { parseTradeCreate, parseTradeVoid } from './trade-input';
import { readJournal } from './trade-journal.store';

interface LegRow {
  network: ChainLeg['network'];
  asset: string | null;
  accountId: string | null;
  blockTime: Date;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
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
  transferId: string | null;
  /** The owner's other address in the same transaction, for a transfer between them (M13). */
  linkedAddressId: string | null;
  /** Linked by the app without asking (D7); null for every answer before M13. */
  automatic: boolean | null;
  createdAt: Date;
}
/** One chain transaction of one address, with the version its answer has now (0: none). */
interface Leg {
  address: string;
  txid: string;
  row: LegRow;
  version: number;
}
/** The other side of a transfer in the owner's own addresses, with its current answer. */
interface Partner extends Leg {
  current: ClassificationRow | null;
  live: ClassificationRow | null;
}
interface Produced {
  accountId: string | null;
  tradeId: string | null;
  rewardId: string | null;
  transferId: string | null;
}
interface MatchRow extends OwnLeg {
  txid: string;
  status: 'unclassified' | 'classified' | 'hidden' | null;
}

const versionColumns = `v."addressId", v.txid, v.version, v."requestId", v."canonicalPayload",
  v.status, v.type, v.details, v.comment, v."accountId", v."tradeId", v."rewardId",
  v."transferId", v."linkedAddressId", v.automatic, v."createdAt"`;
const legColumns = `w.network, t.asset, w."accountId", t."blockTime", t."receivedUnits"::text AS "receivedUnits",
  t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits"`;
const conflict = () => new ConflictException('Classification request conflicts with saved state');
const nothing: Produced = { accountId: null, tradeId: null, rewardId: null, transferId: null };

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
        : row.transferId
          ? { kind: 'transfer' as const, accountId: row.accountId, id: row.transferId }
          : null,
    linkedAddressId: row.linkedAddressId,
    automatic: row.automatic === true,
    createdAt: row.createdAt.toISOString(),
  };
}

const leg = (row: LegRow): ChainLeg => ({
  network: row.network,
  asset: row.asset,
  blockTime: row.blockTime.toISOString(),
  receivedUnits: row.receivedUnits,
  sentUnits: row.sentUnits,
});
const own = (address: string, row: LegRow): OwnLeg => ({
  addressId: address,
  accountId: row.accountId,
  network: row.network,
  asset: row.asset,
  receivedUnits: row.receivedUnits,
  sentUnits: row.sentUnits,
  feeUnits: row.feeUnits,
});
const inbound = (row: LegRow) => legMovement(leg(row)).inbound;
const sameEntry = (left: Produced, right: Produced) =>
  left.tradeId === right.tradeId &&
  left.rewardId === right.rewardId &&
  left.transferId === right.transferId;

/**
 * What decides the produced entry: same answer, same account, same note keep it as it is. A
 * transfer carries no note of its own, so its comment changes nothing.
 */
const operationKey = (
  accountId: string | null,
  value: ClassificationInput['classification'],
  comment: string | null,
) => JSON.stringify({ accountId, value, comment: value?.type === 'transfer' ? null : comment });

@Injectable()
export class ChainClassificationService {
  private readonly logger = new Logger(ChainClassificationService.name);

  constructor(
    private readonly source: DataSource,
    private readonly trades: TradeService,
    private readonly rewards: AssetRewardService,
    private readonly transfers: OwnedTransferService,
  ) {}

  /**
   * CLS-BUY, CLS-HIDE, CLS-RECLASSIFY, XFER-MANUAL: records the owner's answer as a new
   * version and keeps the one journal entry it stands for in step, in one transaction. A
   * changed answer adds the new entry before voiding the old one where the old one added coins,
   * and voids first where it spent them, so later sales stay covered either way.
   */
  async classify(ownerId: string, addressId: string, txid: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const address = parseUuid(addressId);
    // A hex hash (Bitcoin, Ethereum) or a base58 signature (Solana, M15); a token leg adds
    // its number (M14).
    if (!/^([0-9a-f]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})(-[0-9]{1,9})?$/.test(txid))
      throw new NotFoundException();
    const input = parseClassification(raw);
    const payload = classificationPayload(address, txid, input);
    // Raw rows are never updated, so the entry can be checked before the write starts: a
    // malformed amount is a 400 here, not a conflict inside the journal.
    const before = await this.readLeg(this.source.manager, owner, address, txid);
    const value = input.hidden ? null : input.classification;
    if (value?.type === 'transfer') {
      if (!fitsDirection(leg(before), 'transfer')) throw unfit();
    } else if (value) this.check(planOperation(leg(before), value, input.comment));
    let result: { created: boolean; value: ReturnType<typeof classificationView> };
    try {
      result = await this.source.transaction(async (manager) => {
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
        const version = await this.lockHead(manager, address, txid);
        if (version !== input.expectedVersion) throw conflict();
        const saved = await this.record(
          manager,
          owner,
          { address, txid, row, version },
          input,
          payload,
          false,
        );
        return { created: true, value: classificationView(saved) };
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
    // An answer can make an earlier transfer possible: the sender now holds the coins.
    if (result.created) await this.linkQuietly(owner);
    return result;
  }

  /**
   * Automatic linking never fails the write that triggered it; the next one tries again. The
   * assets of what the wallets moved are created first, so unanswered movements count (D1).
   */
  async linkQuietly(ownerId: string): Promise<void> {
    try {
      const owner = parseUuid(ownerId);
      await this.source.transaction('READ COMMITTED', async (manager) => {
        await lockAccountingOwner(manager, owner);
        await ensureChainCoins(manager, owner);
      });
      await this.linkOwnTransfers(ownerId);
    } catch {
      this.logger.warn('Own transfers could not be linked now');
    }
  }

  /**
   * D7, XFER-AUTO: records every certain transfer between two of the owner's accounts as one
   * Transfer without asking, each pair in its own transaction. A pair the books cannot take
   * yet, because the sending account did not hold the coins then, stays to classify and is
   * tried again after the next sync or answer.
   */
  async linkOwnTransfers(ownerId: string): Promise<{ linked: number }> {
    const owner = parseUuid(ownerId);
    const legs: MatchRow[] = await this.source.query(
      `SELECT t.txid, t."addressId", w.network, t.asset, w."accountId", t."receivedUnits"::text AS "receivedUnits",
          t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits", v.status
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE t."ownerId"=$1 AND t.txid IN (SELECT txid FROM wallet_address_transactions
          WHERE "ownerId"=$1 GROUP BY txid HAVING count(*) > 1)
        ORDER BY t.txid, t."addressId"`,
      [owner],
    );
    let linked = 0;
    for (const { outgoing, incoming } of ownTransferPairs(legs)) {
      try {
        const done = await this.source.transaction(async (manager) => {
          await lockAccountingOwner(manager, owner);
          const row = await this.readLeg(manager, owner, outgoing.addressId, outgoing.txid);
          const arrival = await this.readLeg(manager, owner, incoming.addressId, incoming.txid);
          const version = await this.lockHead(manager, outgoing.addressId, outgoing.txid);
          const other = await this.lockHead(manager, incoming.addressId, incoming.txid);
          // Answered or moved to another account meanwhile: the owner's word stands.
          const unanswered = async (address: string, at: number) =>
            at === 0 ||
            (await this.version(manager, address, outgoing.txid, at)).status === 'unclassified';
          if (row.accountId !== outgoing.accountId || arrival.accountId !== incoming.accountId)
            return false;
          if (incoming.accountId === null) return false;
          if (!(await unanswered(outgoing.addressId, version))) return false;
          if (!(await unanswered(incoming.addressId, other))) return false;
          const input: ClassificationInput = {
            requestId: randomUUID(),
            expectedVersion: version,
            hidden: false,
            classification: { type: 'transfer', accountId: incoming.accountId },
          };
          const payload = JSON.stringify({
            automatic: true,
            ...JSON.parse(classificationPayload(outgoing.addressId, outgoing.txid, input)),
          });
          await this.record(
            manager,
            owner,
            { address: outgoing.addressId, txid: outgoing.txid, row, version },
            input,
            payload,
            true,
          );
          return true;
        });
        if (done) linked += 1;
      } catch (error) {
        // The usual reason is a sending account that did not hold the coins then.
        if (!(error instanceof HttpException || error instanceof FifoHistoryError))
          this.logger.warn('An own transfer could not be recorded; it stays to classify');
      }
    }
    return { linked };
  }

  /**
   * CLS-COUNT: chain transactions nobody has classified or hidden, less the receipts worth
   * less than the owner's dust threshold at the latest stored price (CLS-DUST); a stake move
   * needs none.
   */
  async needsClassificationCount(ownerId: string, now = new Date()): Promise<{ count: number }> {
    const owner = parseUuid(ownerId);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const rows: (ChainLeg & { direction: 'in' | 'out' | 'self' })[] = await manager.query(
        `SELECT w.network, t.asset, t.direction, t."blockTime"::text AS "blockTime",
            t."receivedUnits"::text AS "receivedUnits", t."sentUnits"::text AS "sentUnits"
          FROM wallet_address_transactions t
          JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
          LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
          LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
            AND v.txid=h.txid AND v.version=h."currentVersion"
          WHERE t."ownerId"=$1 AND (v.status IS NULL OR v.status='unclassified')
            AND NOT EXISTS (SELECT 1 FROM wallet_stake_moves m WHERE t.asset IS NULL
              AND m."addressId"=t."addressId" AND m.signature=t.txid)`,
        [owner],
      );
      const threshold = await readDustThreshold(manager, owner);
      if (threshold === null || rows.length === 0) return { count: rows.length };
      const symbols = [...new Set(rows.map((row) => chainCoin(row).symbol))];
      const prices = new Map(
        (await latestMarketPrices(manager, symbols, now)).map((row) => [
          row.asset,
          { priceUsd: row.price, observedAt: row.observedAt, source: row.source },
        ]),
      );
      const dust = rows.filter((row) =>
        isDust(
          row.direction,
          estimate(legMovement(row).quantity, prices.get(chainCoin(row).symbol)),
          threshold,
        ),
      );
      return { count: rows.length - dust.length };
    });
  }

  /**
   * Appends the answer for one leg and keeps the entry it stands for in step. A transfer to or
   * from an account where the other side of the same transaction is one of the owner's
   * addresses links that leg too: both name the one transfer and each other (XFER-AUTO).
   */
  private async record(
    manager: EntityManager,
    owner: string,
    target: Leg,
    input: ClassificationInput,
    payload: string,
    automatic: boolean,
  ): Promise<ClassificationRow> {
    const { address, txid, row } = target;
    const current = target.version
      ? await this.version(manager, address, txid, target.version)
      : null;
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    const comment = input.comment ?? null;
    const value = input.hidden ? null : input.classification;
    const accountId = row.accountId;
    if (value && accountId === null)
      throw new UnprocessableEntityException('Choose the account of this wallet first');
    const transfer = value?.type === 'transfer' ? value : null;
    const partner = transfer
      ? await this.partner(manager, owner, target, transfer.accountId)
      : null;
    const planned =
      value && value.type !== 'transfer' ? planOperation(leg(row), value, input.comment) : null;
    const movement =
      transfer && accountId
        ? planTransfer(
            { ...own(address, row), accountId },
            transfer.accountId,
            partner && own(partner.address, partner.row),
          )
        : null;
    const linked = partner?.address ?? null;
    const keep =
      live !== null &&
      value !== null &&
      operationKey(live.accountId, live.details, live.comment) ===
        operationKey(accountId, value, comment) &&
      live.linkedAddressId === linked &&
      (partner === null ||
        (partner.current?.status === 'classified' &&
          partner.current.transferId === live.transferId));
    let produced: Produced = keep && live ? live : nothing;
    if (!keep) {
      // Spent coins are freed before the new entry and added coins removed after it.
      const retireOwn = async () => {
        if (live) await this.retire(manager, owner, live, [address, linked]);
      };
      const retirePartner = async () => {
        if (partner?.live && !(live && sameEntry(live, partner.live)))
          await this.retire(manager, owner, partner.live, [address, partner.address]);
      };
      const spends = !inbound(row);
      await (spends ? retireOwn() : retirePartner());
      if (planned && accountId)
        produced = await this.produce(manager, owner, row, accountId, planned);
      if (movement && accountId)
        produced = await this.move(manager, owner, row, accountId, movement);
      await (spends ? retirePartner() : retireOwn());
    }
    const saved = await this.append(manager, owner, {
      address,
      txid,
      previous: target.version,
      requestId: input.requestId,
      payload,
      status: input.hidden ? 'hidden' : input.classification ? 'classified' : 'unclassified',
      details: input.classification,
      comment,
      produced: {
        accountId: produced.accountId,
        tradeId: produced.tradeId,
        rewardId: produced.rewardId,
        transferId: produced.transferId,
      },
      linkedAddressId: produced.transferId ? linked : null,
      // A note added to a recognised transfer leaves it recognised.
      automatic: produced.transferId ? (keep && live?.automatic) || automatic : null,
    });
    if (partner && !keep && produced.transferId && accountId)
      await this.append(manager, owner, {
        address: partner.address,
        txid,
        previous: partner.version,
        requestId: randomUUID(),
        payload: JSON.stringify({ linkedTo: { addressId: address, txid }, ...produced }),
        status: 'classified',
        details: { type: 'transfer', accountId },
        comment: null,
        produced: { ...nothing, accountId: partner.row.accountId, transferId: produced.transferId },
        linkedAddressId: address,
        automatic,
      });
    return saved;
  }

  /** The planned entry must parse as its journal takes it, with placeholder pins. */
  private check(planned: PlannedOperation) {
    const pins = {
      requestId: randomUUID(),
      expectedJournalRevision: 0,
      instrumentId: randomUUID(),
    };
    if (planned.journal === 'trade') parseTradeCreate({ ...planned.fields, ...pins });
    else if (planned.journal === 'reward') parseRewardCreate({ ...planned.fields, ...pins });
  }

  private async readLeg(manager: EntityManager, owner: string, address: string, txid: string) {
    const [row]: LegRow[] = await manager.query(
      `SELECT ${legColumns}
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        WHERE t."ownerId"=$1 AND t."addressId"=$2 AND t.txid=$3`,
      [owner, address, txid],
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /** The current version of a leg's answer, locked for this write; 0 before the first. */
  private async lockHead(manager: EntityManager, address: string, txid: string) {
    const [head]: { currentVersion: number }[] = await manager.query(
      `SELECT "currentVersion" FROM chain_transaction_classifications
        WHERE "addressId"=$1 AND txid=$2 FOR UPDATE`,
      [address, txid],
    );
    return head?.currentVersion ?? 0;
  }

  /**
   * The owner's other address in the same transaction, in the account the coins went to or
   * came from, moving the other way; null when that side is not a tracked address.
   */
  private async partner(
    manager: EntityManager,
    owner: string,
    target: Leg,
    accountId: string,
  ): Promise<Partner | null> {
    const rows: (LegRow & { addressId: string })[] = await manager.query(
      `SELECT t."addressId", ${legColumns}
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        WHERE t."ownerId"=$1 AND t.txid=$2 AND t."addressId"<>$3 AND w."accountId"=$4
        ORDER BY t."addressId"`,
      [owner, target.txid, target.address, accountId],
    );
    const sends = !inbound(target.row);
    const opposite = rows.filter(
      (row) => legMovement(leg(row)).quantity !== '0' && inbound(row) === sends,
    );
    if (opposite.length === 0) return null;
    if (opposite.length > 1)
      throw new UnprocessableEntityException(
        'Several addresses of that account took part in this transaction',
      );
    const [found] = opposite;
    const version = await this.lockHead(manager, found.addressId, target.txid);
    const current = version
      ? await this.version(manager, found.addressId, target.txid, version)
      : null;
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    return { address: found.addressId, txid: target.txid, row: found, version, current, live };
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
    if (row.transferId) {
      const head = await readTransferHead(manager, owner, row.transferId);
      return head !== undefined && head.kind !== 'void';
    }
    // An outgoing Other produced no entry: the answer itself is what counts (D1).
    return row.status === 'classified' && row.type === 'other';
  }

  private async revision(manager: EntityManager, owner: string, accountId: string) {
    return (await readJournal(manager, owner, accountId))?.currentRevision ?? 0;
  }

  private async produce(
    manager: EntityManager,
    owner: string,
    row: LegRow,
    accountId: string,
    planned: PlannedOperation,
  ): Promise<Produced> {
    if (planned.journal === 'none') return { ...nothing, accountId };
    const coin = await findOrCreateInstrument(manager, owner, chainCoin(row), true);
    if (!coin) throw new Error('Chain coin was not created');
    const pins = {
      requestId: randomUUID(),
      expectedJournalRevision: await this.revision(manager, owner, accountId),
      instrumentId: coin.id,
    };
    if (planned.journal === 'trade') {
      const { value } = await this.trades.mutateWithin(
        manager,
        owner,
        accountId,
        'create',
        undefined,
        parseTradeCreate({ ...planned.fields, ...pins }),
      );
      return { ...nothing, accountId, tradeId: value.trade.tradeId };
    }
    const { value } = await this.rewards.mutateWithin(
      manager,
      owner,
      accountId,
      'create',
      parseRewardCreate({ ...planned.fields, ...pins }),
    );
    return { ...nothing, accountId, rewardId: value.reward.rewardId };
  }

  /** XFER-*: the owned transfer, which carries the cost basis across and spends the fee. */
  private async move(
    manager: EntityManager,
    owner: string,
    row: LegRow,
    accountId: string,
    plan: PlannedTransfer,
  ): Promise<Produced> {
    const coin = await findOrCreateInstrument(manager, owner, chainCoin(row), true);
    if (!coin) throw new Error('Chain coin was not created');
    const { value } = await this.transfers.mutateWithin(
      manager,
      owner,
      'create',
      parseTransferCreate({
        requestId: randomUUID(),
        expectedFromJournalRevision: await this.revision(manager, owner, plan.fromAccountId),
        expectedToJournalRevision: await this.revision(manager, owner, plan.toAccountId),
        fromAccountId: plan.fromAccountId,
        toAccountId: plan.toAccountId,
        assertInternal: true,
        instrumentId: coin.id,
        occurredAt: row.blockTime.toISOString(),
        quantity: plan.quantity,
        feeInstrumentId: plan.feeQuantity === '0' ? null : coin.id,
        feeQuantity: plan.feeQuantity,
      }),
    );
    return { ...nothing, accountId, transferId: value.transfer.transferId };
  }

  /**
   * Voids the entry an earlier answer produced; its versions stay (CLS-RECLASSIFY). The other
   * leg of a voided transfer goes back to "Needs classification" unless it is written now.
   */
  private async retire(
    manager: EntityManager,
    owner: string,
    row: ClassificationRow,
    written: (string | null)[],
  ) {
    if (row.transferId) {
      const head = await readTransferHead(manager, owner, row.transferId);
      if (!head) throw new Error('Missing produced transfer');
      await this.transfers.mutateWithin(
        manager,
        owner,
        'void',
        parseTransferVoid({
          requestId: randomUUID(),
          expectedVersion: head.version,
          expectedFromJournalRevision: await this.revision(manager, owner, head.fromAccountId),
          expectedToJournalRevision: await this.revision(manager, owner, head.toAccountId),
        }),
        row.transferId,
      );
      if (row.linkedAddressId && !written.includes(row.linkedAddressId))
        await this.unlink(manager, owner, row.linkedAddressId, row.txid, row.transferId);
      return;
    }
    // An outgoing Other produced nothing to void.
    if (!row.tradeId && !row.rewardId) return;
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

  /** The other leg of a voided transfer has no answer of its own any more. */
  private async unlink(
    manager: EntityManager,
    owner: string,
    address: string,
    txid: string,
    transferId: string,
  ) {
    const version = await this.lockHead(manager, address, txid);
    if (!version) return;
    const current = await this.version(manager, address, txid, version);
    if (current.status !== 'classified' || current.transferId !== transferId) return;
    await this.append(manager, owner, {
      address,
      txid,
      previous: version,
      requestId: randomUUID(),
      payload: JSON.stringify({ unlinkedFrom: transferId, addressId: address, txid }),
      status: 'unclassified',
      details: null,
      comment: null,
      produced: nothing,
      linkedAddressId: null,
      automatic: null,
    });
  }

  private async append(
    manager: EntityManager,
    owner: string,
    entry: {
      address: string;
      txid: string;
      previous: number;
      requestId: string;
      payload: string;
      status: ClassificationRow['status'];
      details: ClassificationInput['classification'];
      comment: string | null;
      produced: Produced;
      linkedAddressId: string | null;
      automatic: boolean | null;
    },
  ): Promise<ClassificationRow> {
    const version = entry.previous + 1;
    if (entry.previous)
      await manager.query(
        `UPDATE chain_transaction_classifications SET "currentVersion"=$3
          WHERE "addressId"=$1 AND txid=$2`,
        [entry.address, entry.txid, version],
      );
    else
      await manager.query(
        `INSERT INTO chain_transaction_classifications ("ownerId","addressId",txid,"currentVersion")
          VALUES ($1,$2,$3,$4)`,
        [owner, entry.address, entry.txid, version],
      );
    const [saved]: ClassificationRow[] = await manager.query(
      `INSERT INTO chain_transaction_classification_versions AS v
        ("ownerId","addressId",txid,version,"requestId","canonicalPayload",status,type,details,
         comment,"accountId","tradeId","rewardId","transferId","linkedAddressId",automatic)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
        RETURNING ${versionColumns}`,
      [
        owner,
        entry.address,
        entry.txid,
        version,
        entry.requestId,
        entry.payload,
        entry.status,
        entry.details?.type ?? null,
        entry.details === null ? null : JSON.stringify(entry.details),
        entry.comment,
        entry.produced.accountId,
        entry.produced.tradeId,
        entry.produced.rewardId,
        entry.produced.transferId,
        entry.linkedAddressId,
        entry.automatic,
      ],
    );
    return saved;
  }
}

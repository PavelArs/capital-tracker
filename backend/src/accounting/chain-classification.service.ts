import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { readDustThreshold } from '../owner-settings/owner-settings.service';
import { marketPricesAt, priceAt, storedPricesAt } from '../prices/market-price.store';
import { isExchange } from '../wallet-addresses/chain-assets';
import { stakeMoves } from '../wallet-addresses/stake-tables';
import { leftOutTokens } from '../wallet-addresses/token-left-out';
import { tokenKey } from '../wallet-addresses/token-visibility';
import { TRON_REWARD_CONTRACT } from '../wallet-addresses/tron-legs';
import { lockAccountingOwner } from './accounting-lock';
import { AssetRewardService } from './asset-reward.service';
import { projectRewardVersion, readRewardHead } from './asset-reward.store';
import { parseRewardCreate, parseRewardVoid } from './asset-reward-input';
import { AssetSwapService } from './asset-swap.service';
import { projectSwapVersion, readSwapHead } from './asset-swap.store';
import { type ChainSwapCreateInput, parseSwapCreate, parseSwapVoid } from './asset-swap-input';
import { availableQuantity } from './available-quantity';
import {
  type ChainLeg,
  type Classification,
  type ClassificationInput,
  chainCoin,
  chainTxid,
  classificationPayload,
  countedGapTxid,
  exchangeTrade,
  fitsDirection,
  legMovement,
  type PlannedOperation,
  type PoolWithdrawalClassification,
  parseClassification,
  parseRemoval,
  planOperation,
  type RecordedClassification,
  type SwapClassification,
  unfit,
} from './chain-classification';
import {
  DUPLICATE_AMOUNT_PERCENT,
  DUPLICATE_WINDOW_HOURS,
  duplicateFits,
  proposeDuplicates,
} from './chain-duplicate';
import { type OwnRecord, readOwnRecords } from './chain-duplicate.store';
import { isDust } from './chain-dust';
import {
  byPoolOrder,
  checkPoolWithdrawal,
  type PoolLeg,
  planPoolWithdrawal,
  poolDepositUnits,
  poolGainValueUsd,
  storedValueUsd,
} from './chain-pool';
import {
  carryTime,
  type PurchaseRecord,
  purchaseTotal,
  recordGone,
  recordMoves,
  swapCoins,
  tradeCoins,
  unpaidFor,
} from './chain-recorded';
import { type PlannedSwap, planSwap, type SwapSide, swapValueUsd } from './chain-swap';
import {
  coinOf,
  type OwnLeg,
  ownTransferPairs,
  PAIR_FEE_PERCENT,
  PAIR_WINDOW_HOURS,
  type PlannedTransfer,
  pairAmounts,
  pairFits,
  planTransfer,
  proposeTransferPairs,
  sameTransaction,
  type TimedLeg,
} from './chain-transfer';
import { readConnectedLedger, rethrowAccountingHistory } from './connected-accounting.store';
import { FifoHistoryError } from './fifo';
import { parseUuid } from './input';
import { canonicalDecimalToAtoms } from './money';
import { estimate } from './operation-list';
import { OwnedTransferService } from './owned-transfer.service';
import { readTransferHead } from './owned-transfer.store';
import { parseTransferCreate, parseTransferVoid } from './owned-transfer-input';
import { ensureChainCoins } from './portfolio-valuation.service';
import { findOrCreateInstrument, TradeService } from './trade.service';
import { parseTradeCreate, parseTradeVoid } from './trade-input';
import { readJournal } from './trade-journal.store';
import { cashAsset, type SettlementCurrency } from './trade-settlement';

interface LegRow {
  network: ChainLeg['network'];
  asset: string | null;
  accountId: string | null;
  blockTime: Date;
  receivedUnits: string;
  sentUnits: string;
  feeUnits: string;
  /** The quote coin a Bybit fill spent or received (M22); null for every other leg. */
  quoteAsset?: string | null;
}
export interface ClassificationRow {
  addressId: string;
  txid: string;
  version: number;
  requestId: string;
  canonicalPayload: string;
  status: 'unclassified' | 'classified' | 'hidden' | 'deleted';
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
  /** CLS-SWAP: the swap both sides name, in the account the bought coins arrived in. */
  swapAccountId: string | null;
  swapId: string | null;
  /** CLS-SWAP: the owner's raw transaction on the other side of the swap. */
  pairedAddressId: string | null;
  pairedTxid: string | null;
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
/** CLS-PAID: the purchase in another account that the coins of a transaction paid for. */
interface Pays {
  accountId: string;
  tradeId: string;
  /** When the purchase was made. */
  at: Date;
}
interface Produced {
  accountId: string | null;
  tradeId: string | null;
  rewardId: string | null;
  /** An own transfer (M13), or the one that carried a swap's paid coins over (CLS-SWAP). */
  transferId: string | null;
  swapAccountId: string | null;
  swapId: string | null;
}
interface ProposalRow extends TimedLeg {
  accountName: string;
  address: string;
  label: string | null;
  /** The head version of the answer, 0 before the first. */
  version: number;
}
/** A proposal row as the screen shows it: which transaction, in which account and wallet. */
const placed = (row: ProposalRow) => ({
  addressId: row.addressId,
  txid: row.txid,
  version: row.version,
  accountId: row.accountId,
  accountName: row.accountName,
  wallet: { network: row.network, address: row.address, label: row.label },
  occurredAt: row.blockTime.toISOString(),
});
interface MatchRow extends OwnLeg {
  txid: string;
  status: 'unclassified' | 'classified' | 'hidden' | null;
}

const versionColumns = `v."addressId", v.txid, v.version, v."requestId", v."canonicalPayload",
  v.status, v.type, v.details, v.comment, v."accountId", v."tradeId", v."rewardId",
  v."transferId", v."linkedAddressId", v.automatic, v."swapAccountId", v."swapId",
  v."pairedAddressId", v."pairedTxid", v."createdAt"`;
const legColumns = `w.network, t.asset, w."accountId", t."blockTime", t."receivedUnits"::text AS "receivedUnits",
  t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits",
  t.raw->>'quoteAsset' AS "quoteAsset"`;
const conflict = () => new ConflictException('Classification request conflicts with saved state');
const nothing: Produced = {
  accountId: null,
  tradeId: null,
  rewardId: null,
  transferId: null,
  swapAccountId: null,
  swapId: null,
};
/** One raw transaction of one address. */
const key = (address: string, txid: string) => `${address}:${txid}`;
/** A write the journals refused: the books would not hold the coins then. */
const refused = (error: unknown) =>
  error instanceof FifoHistoryError ||
  (error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT);

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
    operation: row.swapId
      ? { kind: 'swap' as const, accountId: row.swapAccountId, id: row.swapId }
      : row.tradeId
        ? { kind: 'trade' as const, accountId: row.accountId, id: row.tradeId }
        : row.rewardId
          ? { kind: 'reward' as const, accountId: row.accountId, id: row.rewardId }
          : row.transferId
            ? { kind: 'transfer' as const, accountId: row.accountId, id: row.transferId }
            : null,
    linkedAddressId: row.linkedAddressId,
    automatic: row.automatic === true,
    paired:
      row.pairedAddressId && row.pairedTxid
        ? { addressId: row.pairedAddressId, txid: row.pairedTxid }
        : null,
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
const side = (address: string, txid: string, row: LegRow): SwapSide => ({
  ...own(address, row),
  txid,
  blockTime: row.blockTime.toISOString(),
});
const poolLeg = (address: string, txid: string, row: LegRow): PoolLeg => side(address, txid, row);
/** Where a leg stands among the withdrawals of a deposit (POOL-PARTIAL). */
const at = (leg: Leg) => ({ blockTime: leg.row.blockTime, txid: leg.txid });
/** POOL-UNDO: a deposit cannot change while a withdrawal returns it. */
const namedDeposit = () =>
  new UnprocessableEntityException(
    'A pool withdrawal names this deposit; change the withdrawal first',
  );
/**
 * TOKEN-FEE: the leg `t` only paid the network fee of a token send from the same address in the
 * same transaction; the operations list shows it as that send's fee (gasOnly there).
 */
const tokenSendGas = `t.asset IS NULL AND w.network<>'bybit' AND t."receivedUnits"=0
  AND t."feeUnits">0 AND t."sentUnits"=t."feeUnits"
  AND EXISTS (SELECT 1 FROM wallet_address_transactions k WHERE k."ownerId"=t."ownerId"
    AND k."addressId"=t."addressId" AND k.asset IS NOT NULL AND k.txid<>t.txid
    AND split_part(k.txid, '-', 1)=t.txid AND k."sentUnits">k."receivedUnits")`;
const inbound = (row: LegRow) => legMovement(leg(row)).inbound;
const sameEntry = (left: Produced, right: Produced) =>
  left.tradeId === right.tradeId &&
  left.rewardId === right.rewardId &&
  left.transferId === right.transferId &&
  left.swapId === right.swapId;
/** quantity × price in USD, half up to whole cents (TRON-REWARD). */
export function centsOf(quantity: string, priceUsd: string): string {
  // Both carry 30 decimals: the product carries 60, a cent is 10^58 of it.
  const product = canonicalDecimalToAtoms(quantity) * canonicalDecimalToAtoms(priceUsd);
  const cents = (product + 5n * 10n ** 57n) / 10n ** 58n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * What decides the produced entry: same answer, same account, same note keep it as it is. A
 * transfer or a swap carries no note of its own, so its comment changes nothing.
 */
const operationKey = (
  accountId: string | null,
  value: ClassificationInput['classification'],
  comment: string | null,
) =>
  JSON.stringify({
    accountId,
    value,
    comment: value?.type === 'transfer' || value?.type === 'swap' ? null : comment,
  });

@Injectable()
export class ChainClassificationService {
  private readonly logger = new Logger(ChainClassificationService.name);

  constructor(
    private readonly source: DataSource,
    private readonly trades: TradeService,
    private readonly rewards: AssetRewardService,
    private readonly transfers: OwnedTransferService,
    private readonly swaps: AssetSwapService,
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
    if (!chainTxid.test(txid)) throw new NotFoundException();
    const input = parseClassification(raw);
    // CLS-DUPLICATE: the record is replaced by an answer, not by hiding or clearing one.
    if (input.replaces && (input.hidden || input.classification === null))
      throw new BadRequestException('Invalid accounting input');
    const payload = classificationPayload(address, txid, input);
    // Raw rows are never updated, so the entry can be checked before the write starts: a
    // malformed amount is a 400 here, not a conflict inside the journal.
    const before = await this.readLeg(this.source.manager, owner, address, txid);
    const value = input.hidden ? null : input.classification;
    if (value?.type === 'transfer' || value?.type === 'swap' || value?.type === 'pool-withdrawal') {
      if (!fitsDirection(leg(before), value.type)) throw unfit();
    } else if (value)
      this.check(
        planOperation(
          leg(before),
          await this.priced(this.source.manager, before, value),
          input.comment,
        ),
      );
    // POOL-DEPOSIT: a leg that moved only its network fee put nothing into a pool.
    if (value?.type === 'pool-deposit' && poolDepositUnits(own(address, before)) <= 0n)
      throw unfit();
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
        // BYBIT-GAP-DELETE: a deleted record is gone for every answer.
        if (
          version > 0 &&
          (await this.version(manager, address, txid, version)).status === 'deleted'
        )
          throw new NotFoundException();
        // BYBIT-TRADES: a Buy paid in the fill's own quote coin needs the records to hold that
        // coin, as for the automatic answer. Otherwise the shortfall would be entered as new
        // money while the unanswered receipts that supplied the coin still count (D1).
        if (
          value?.type === 'buy' &&
          row.network === 'bybit' &&
          row.quoteAsset === value.currency &&
          !(await this.journalHolds(manager, owner, row, value))
        )
          throw new ConflictException(
            `The account's records do not hold the ${value.currency} this trade paid with yet; answer the ${value.currency} deposit or transfer first`,
          );
        // CLS-DUPLICATE: a record the answer replaces goes in the same transaction. A priced
        // entry settles in the account's cash, which the record has spent, so it goes first;
        // otherwise coins are added before the record goes and spent ones are freed first.
        const replaced = input.replaces
          ? await this.replacedRecord(manager, owner, { address, txid, row, version }, input)
          : null;
        const priced = replaced?.answer.type === 'buy' || replaced?.answer.type === 'sell';
        const voidFirst = replaced !== null && (priced || !inbound(row));
        if (replaced && voidFirst) await this.voidRecord(manager, owner, replaced);
        const saved = await this.record(
          manager,
          owner,
          { address, txid, row, version },
          input,
          payload,
          false,
        );
        if (replaced && !voidFirst) await this.voidRecord(manager, owner, replaced);
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
   * CLS-DUPLICATE: the record an answer replaces, checked as it stands now: still counting, not
   * tied to a transaction, at the version the owner saw, the same movement as this transaction,
   * and said again by the answer exactly (nothing is taken from the client's word).
   */
  private async replacedRecord(
    manager: EntityManager,
    owner: string,
    target: Leg,
    input: ClassificationInput,
  ): Promise<OwnRecord> {
    const { row } = target;
    const named = input.replaces;
    const answer = input.classification;
    if (!named || !answer || row.accountId === null)
      throw new BadRequestException('Invalid accounting input');
    if (
      target.version > 0 &&
      (await this.version(manager, target.address, target.txid, target.version)).status !==
        'unclassified'
    )
      throw conflict();
    const found = (await readOwnRecords(manager, owner, [row.accountId])).find(
      (record) => record.kind === named.kind && record.id === named.id,
    );
    if (!found || found.version !== named.version)
      throw new ConflictException('That record changed; reload and try again');
    const move = legMovement({ ...row, blockTime: row.blockTime.toISOString() });
    const same = duplicateFits(
      {
        accountId: row.accountId,
        coin: chainCoin(row).symbol.toUpperCase(),
        inbound: move.inbound,
        atoms: canonicalDecimalToAtoms(move.quantity),
        at: row.blockTime,
      },
      found,
    );
    if (!same)
      throw new UnprocessableEntityException(
        'That record is not the same movement as this transaction',
      );
    if (
      operationKey(row.accountId, found.answer, found.comment) !==
      operationKey(row.accountId, answer, input.comment ?? null)
    )
      throw new ConflictException('That record changed; reload and try again');
    return found;
  }

  /** CLS-DUPLICATE: voids the record an answer replaces; its versions stay in the history. */
  private async voidRecord(manager: EntityManager, owner: string, record: OwnRecord) {
    const expectedJournalRevision = await this.revision(manager, owner, record.accountId);
    try {
      if (record.kind === 'trade') {
        await this.trades.mutateWithin(
          manager,
          owner,
          record.accountId,
          'void',
          record.id,
          parseTradeVoid({ requestId: randomUUID(), expectedJournalRevision }),
        );
        return;
      }
      const head = await readRewardHead(manager, owner, record.accountId, record.id);
      if (!head) throw new ConflictException('That record changed; reload and try again');
      await this.rewards.mutateWithin(
        manager,
        owner,
        record.accountId,
        'void',
        parseRewardVoid({
          requestId: randomUUID(),
          expectedJournalRevision,
          expectedVersion: projectRewardVersion(head).version,
        }),
        record.id,
      );
    } catch (error) {
      if (!refused(error)) throw error;
      throw new UnprocessableEntityException(
        'The books would not hold the coins without that record; change the entries that depend on it first',
      );
    }
  }

  /**
   * BYBIT-GAP-DELETE: deletes a record the app made when the owner counted a Bybit balance
   * difference. The raw leg stays and a last version says it was deleted, so the history keeps
   * who deleted what; the record leaves the lists and the books, and the balance notice shows
   * the difference again. Only a record nobody answered, or one hidden, can go: an answer that
   * produced an entry is changed first.
   */
  async removeCounted(ownerId: string, addressId: string, txid: string, raw: unknown) {
    const owner = parseUuid(ownerId);
    const address = parseUuid(addressId);
    if (!countedGapTxid.test(txid)) throw new NotFoundException();
    const input = parseRemoval(raw);
    const payload = JSON.stringify({ addressId: address, txid, removal: input.expectedVersion });
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
          return classificationView(replay);
        }
        await this.readLeg(manager, owner, address, txid);
        const version = await this.lockHead(manager, address, txid);
        if (version !== input.expectedVersion) throw conflict();
        const current = version > 0 ? await this.version(manager, address, txid, version) : null;
        if (current?.status === 'deleted') throw new NotFoundException();
        if (current?.status === 'classified')
          throw new UnprocessableEntityException(
            'This record has an answer; change it to "Needs classification" first',
          );
        const saved = await this.append(manager, owner, {
          address,
          txid,
          previous: version,
          requestId: input.requestId,
          payload,
          status: 'deleted',
          details: null,
          comment: null,
          produced: nothing,
          linkedAddressId: null,
          automatic: null,
          paired: null,
        });
        return classificationView(saved);
      });
    } catch (error) {
      return rethrowAccountingHistory(error);
    }
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
      // A transfer into Bybit can pay for a trade there, and a trade can provide the coins a
      // withdrawal sends on: each round may make the next one possible (M22).
      for (let round = 0; round < 3; round++) {
        const { linked } = await this.linkOwnTransfers(ownerId);
        const { recognized } = await this.recognizeExchangeTrades(ownerId);
        if (linked + recognized === 0) break;
      }
      // A claimed reward needs no coins the books must hold first: one pass records them all.
      await this.recognizeStakingRewards(ownerId);
    } catch {
      this.logger.warn('Own transfers could not be linked now');
    }
  }

  /**
   * BYBIT-TRADES (M22): records every Bybit spot fill that is certainly a Buy or Sell as one,
   * without asking, oldest first, each in its own transaction. A buy waits until the account's
   * records hold the USDT or USDC it spent (a transfer in, an answered deposit, a P2P purchase
   * entered by hand), so it is paid from them rather than counted as new money; a sale waits
   * for the coins it sold. Until then the fill counts provisionally (D1) and stays to
   * classify. A fill the owner has answered is never touched.
   */
  async recognizeExchangeTrades(ownerId: string): Promise<{ recognized: number }> {
    const owner = parseUuid(ownerId);
    const fills: { addressId: string; txid: string; raw: unknown }[] = await this.source.query(
      `SELECT t."addressId", t.txid, t.raw
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        WHERE t."ownerId"=$1 AND w.network='bybit' AND w."accountId" IS NOT NULL
          AND t.raw->>'kind'='trade' AND h.txid IS NULL
        ORDER BY t."blockTime", t.txid`,
      [owner],
    );
    let recognized = 0;
    for (const fill of fills) {
      const answer = exchangeTrade(fill.raw);
      if (!answer) continue;
      try {
        const done = await this.source.transaction(async (manager) => {
          await lockAccountingOwner(manager, owner);
          const row = await this.readLeg(manager, owner, fill.addressId, fill.txid);
          const version = await this.lockHead(manager, fill.addressId, fill.txid);
          if (version !== 0 || row.accountId === null || !fitsDirection(leg(row), answer.type))
            return false;
          if (!(await this.journalHolds(manager, owner, row, answer))) return false;
          const input: ClassificationInput = {
            requestId: randomUUID(),
            expectedVersion: 0,
            hidden: false,
            classification: answer,
          };
          const payload = JSON.stringify({
            automatic: true,
            ...JSON.parse(classificationPayload(fill.addressId, fill.txid, input)),
          });
          await this.record(
            manager,
            owner,
            { address: fill.addressId, txid: fill.txid, row, version },
            input,
            payload,
            true,
          );
          return true;
        });
        if (done) recognized += 1;
      } catch (error) {
        if (!(error instanceof HttpException || error instanceof FifoHistoryError))
          this.logger.warn('A Bybit trade could not be recorded; it stays to classify');
      }
    }
    return { recognized };
  }

  /**
   * Whether the account's records already hold what a Bybit fill spent: the quote coin plus fee
   * for a buy, the coins sold for a sale. False when the account has no journal.
   */
  private async journalHolds(
    manager: EntityManager,
    owner: string,
    row: LegRow,
    answer: ClassificationInput['classification'] & { type: 'buy' | 'sell' },
  ): Promise<boolean> {
    if (row.accountId === null) return false;
    const { quantity } = legMovement(leg(row));
    const needed =
      answer.type === 'buy'
        ? canonicalDecimalToAtoms(answer.amount) + canonicalDecimalToAtoms(answer.fee ?? '0')
        : canonicalDecimalToAtoms(quantity);
    const paidWith = answer.type === 'buy' ? cashAsset[answer.currency] : chainCoin(row);
    const instrument = await findOrCreateInstrument(manager, owner, paidWith, false);
    const journal = await readJournal(manager, owner, row.accountId);
    if (!instrument || !journal) return false;
    const ledger = await readConnectedLedger(manager, owner, [row.accountId]);
    const held = availableQuantity(
      ledger,
      row.accountId,
      instrument.id,
      row.blockTime.toISOString(),
    );
    return canonicalDecimalToAtoms(held) >= needed;
  }

  /**
   * TRON-REWARD, BYBIT-EARN: records every Tron vote reward claim (a WithdrawBalance the wallet
   * signed) and every Earn yield Bybit paid as a Staking reward without asking, valued at the
   * stored price of its coin at its time when there is one, each in its own transaction. It
   * needs the wallet's account; a reward the owner has answered is never touched.
   */
  async recognizeStakingRewards(ownerId: string): Promise<{ recognized: number }> {
    const owner = parseUuid(ownerId);
    const claims: { addressId: string; txid: string }[] = await this.source.query(
      `SELECT t."addressId", t.txid
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        WHERE t."ownerId"=$1 AND w."accountId" IS NOT NULL AND h.txid IS NULL
          AND ((w.network='tron' AND t.asset IS NULL AND t.raw->>'contractType'=$2)
            OR (w.network='bybit' AND t.raw->>'kind'='earn'))
        ORDER BY t."blockTime", t.txid`,
      [owner, TRON_REWARD_CONTRACT],
    );
    let recognized = 0;
    for (const claim of claims) {
      try {
        const done = await this.source.transaction(async (manager) => {
          await lockAccountingOwner(manager, owner);
          const row = await this.readLeg(manager, owner, claim.addressId, claim.txid);
          const version = await this.lockHead(manager, claim.addressId, claim.txid);
          if (version !== 0 || row.accountId === null || !fitsDirection(leg(row), 'staking-reward'))
            return false;
          const { quantity } = legMovement(leg(row));
          const occurredAt = row.blockTime.toISOString();
          const price = await this.storedPrice(manager, chainCoin(row).symbol, occurredAt);
          const input: ClassificationInput = {
            requestId: randomUUID(),
            expectedVersion: 0,
            hidden: false,
            classification: {
              type: 'staking-reward',
              valueUsd: price === null ? null : centsOf(quantity, price),
            },
          };
          const payload = JSON.stringify({
            automatic: true,
            ...JSON.parse(classificationPayload(claim.addressId, claim.txid, input)),
          });
          await this.record(
            manager,
            owner,
            { address: claim.addressId, txid: claim.txid, row, version },
            input,
            payload,
            true,
          );
          return true;
        });
        if (done) recognized += 1;
      } catch (error) {
        if (!(error instanceof HttpException || error instanceof FifoHistoryError))
          this.logger.warn('A staking reward could not be recorded; it stays to classify');
      }
    }
    return { recognized };
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
        WHERE t."ownerId"=$1 AND (t.txid IN (SELECT txid FROM wallet_address_transactions
            WHERE "ownerId"=$1 GROUP BY txid HAVING count(*) > 1)
          -- BYBIT-DEPOSIT: a wallet's leg and a Bybit record that names its hash alone.
          OR split_part(t.txid, '-', 1) IN (SELECT x.txid FROM wallet_address_transactions x
            JOIN wallet_addresses y ON y."ownerId"=x."ownerId" AND y.id=x."addressId"
            WHERE x."ownerId"=$1 AND y.network='bybit')
          OR (w.network='bybit' AND t.txid IN (SELECT split_part(x.txid, '-', 1)
            FROM wallet_address_transactions x
            JOIN wallet_addresses y ON y."ownerId"=x."ownerId" AND y.id=x."addressId"
            WHERE x."ownerId"=$1 AND y.network<>'bybit')))
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
          const unanswered = async (address: string, txid: string, at: number) =>
            at === 0 || (await this.version(manager, address, txid, at)).status === 'unclassified';
          if (row.accountId !== outgoing.accountId || arrival.accountId !== incoming.accountId)
            return false;
          if (incoming.accountId === null) return false;
          if (!(await unanswered(outgoing.addressId, outgoing.txid, version))) return false;
          if (!(await unanswered(incoming.addressId, incoming.txid, other))) return false;
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
   * XFER-PROPOSED: withdrawals and receipts of one coin in two of the owner's accounts that look
   * like the two sides of one transfer but name different transactions, so the app does not link
   * them by itself. Nothing is changed here; accepting one answers the withdrawal as a transfer
   * naming the receipt (the same classify call as any other answer).
   */
  async transferProposals(ownerId: string) {
    const owner = parseUuid(ownerId);
    const rows = await this.openLegs(this.source.manager, owner);
    return {
      windowHours: PAIR_WINDOW_HOURS,
      feePercent: Number(PAIR_FEE_PERCENT),
      proposals: proposeTransferPairs(rows).map((proposal) => ({
        ...pairAmounts(proposal),
        outgoing: placed(proposal.outgoing),
        incoming: placed(proposal.incoming),
      })),
    };
  }

  /**
   * CLS-DUPLICATE: a record the owner added by hand or from CSV and a transaction of a wallet in
   * the same account that look like the same movement. Nothing is changed here; accepting one
   * answers the transaction as the record said and voids the record (the same classify call as
   * any other answer, naming what it replaces).
   */
  async duplicateProposals(ownerId: string) {
    const owner = parseUuid(ownerId);
    const open = await this.openLegs(this.source.manager, owner);
    const legs = open.flatMap((row) => {
      const move = legMovement({ ...row, blockTime: row.blockTime.toISOString() });
      return row.accountId === null || move.quantity === '0'
        ? []
        : [
            {
              ...row,
              accountId: row.accountId,
              coin: chainCoin(row).symbol.toUpperCase(),
              inbound: move.inbound,
              atoms: canonicalDecimalToAtoms(move.quantity),
              at: row.blockTime,
              quantity: move.quantity,
            },
          ];
    });
    const records = await readOwnRecords(this.source.manager, owner, [
      ...new Set(legs.map((leg) => leg.accountId)),
    ]);
    return {
      windowHours: DUPLICATE_WINDOW_HOURS,
      amountPercent: Number(DUPLICATE_AMOUNT_PERCENT),
      proposals: proposeDuplicates(legs, records).map(({ leg, record }) => ({
        coin: leg.coin,
        direction: leg.inbound ? ('in' as const) : ('out' as const),
        transaction: { ...placed(leg), quantity: leg.quantity },
        record: {
          kind: record.kind,
          id: record.id,
          version: record.version,
          type: record.answer.type,
          quantity: record.quantity,
          valueUsd: record.valueUsd,
          occurredAt: record.at.toISOString(),
        },
        classification: record.answer,
        comment: record.comment,
      })),
    };
  }

  /** The synced legs of the owner's wallets in accounts that nobody has answered yet. */
  private async openLegs(manager: EntityManager, owner: string): Promise<ProposalRow[]> {
    return manager.query(
      `SELECT t.txid, t."addressId", w.network, w.address, w.label, t.asset, w."accountId",
          a.name AS "accountName", t."blockTime", t."receivedUnits"::text AS "receivedUnits",
          t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits", v.status,
          coalesce(v.version, 0) AS "version"
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        JOIN manual_accounts a ON a."ownerId"=w."ownerId" AND a.id=w."accountId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE t."ownerId"=$1 AND t."receivedUnits"<>t."sentUnits"
          AND (h.txid IS NULL OR v.status='unclassified')
          -- A Bybit fill or Earn record is a trade or yield, never a transfer.
          AND coalesce(t.raw->>'kind', '') NOT IN ('trade', 'earn-flexible', 'earn-onchain')`,
      [owner],
    );
  }

  /**
   * CLS-COUNT: chain transactions nobody has classified or hidden, less the receipts worth
   * less than the owner's dust threshold at the price stored for their time (CLS-DUST,
   * EST-AT-TIME); a stake move needs none, nor does the leg that only paid a token send's
   * fee (TOKEN-FEE).
   */
  async needsClassificationCount(ownerId: string): Promise<{ count: number }> {
    const owner = parseUuid(ownerId);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const all: (ChainLeg & { addressId: string; direction: 'in' | 'out' | 'self' })[] =
        await manager.query(
          `SELECT t."addressId", w.network, t.asset, t.direction, t."blockTime"::text AS "blockTime",
            t."receivedUnits"::text AS "receivedUnits", t."sentUnits"::text AS "sentUnits"
          FROM wallet_address_transactions t
          JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
          LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
          LEFT JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
            AND v.txid=h.txid AND v.version=h."currentVersion"
          WHERE t."ownerId"=$1 AND (v.status IS NULL OR v.status='unclassified'
              OR ${recordGone('v', 'w."accountId"')})
            AND NOT EXISTS (SELECT 1 FROM ${stakeMoves} m WHERE t.asset IS NULL
              AND m."addressId"=t."addressId" AND m.txid=t.txid)
            AND NOT (${tokenSendGas})`,
          [owner],
        );
      // TOKEN-HIDE: a leg of a token its address leaves out never asks to be classified.
      const hidden = await leftOutTokens(manager, owner);
      const rows = all.filter((row) => !hidden.has(tokenKey(row.addressId, row.asset)));
      if (rows.length === 0) return { count: 0 };
      const threshold = await readDustThreshold(manager, owner);
      if (threshold === null) return { count: rows.length };
      const prices = await storedPricesAt(
        manager,
        rows.map((row) => ({ asset: chainCoin(row).symbol, at: row.blockTime })),
      );
      const dust = rows.filter((row) =>
        isDust(
          row.direction,
          estimate(
            legMovement(row).quantity,
            priceAt(prices.get(chainCoin(row).symbol), row.blockTime),
          ),
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
    const value = input.hidden ? null : input.classification;
    const current = target.version
      ? await this.version(manager, address, txid, target.version)
      : null;
    if (
      current?.status === 'classified' &&
      current.type === 'pool-deposit' &&
      value?.type !== 'pool-deposit' &&
      (await this.withdrawalsOf(manager, owner, address, txid, null)).length > 0
    )
      throw namedDeposit();
    await this.checkWithdrawalOrder(manager, owner, target, current, value);
    if (value?.type === 'swap')
      return this.recordSwap(manager, owner, target, input, payload, value);
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    const comment = input.comment ?? null;
    const accountId = row.accountId;
    if (value && accountId === null)
      throw new UnprocessableEntityException('Choose the account of this wallet first');
    const pays =
      value?.type === 'recorded' && accountId
        ? await this.checkRecord(manager, owner, row, accountId, value)
        : null;
    const transfer = value?.type === 'transfer' ? value : null;
    const partner = transfer
      ? await this.partner(manager, owner, target, transfer.accountId, transfer.partner)
      : null;
    const withdrawal = value?.type === 'pool-withdrawal' ? value : null;
    const planned = withdrawal
      ? await this.planWithdrawal(manager, owner, target, withdrawal)
      : value && value.type !== 'transfer'
        ? planOperation(leg(row), await this.priced(manager, row, value), input.comment)
        : null;
    // XFER-PROPOSED: the link column names a leg of the same hash; a pair joined across two
    // hashes is found by the transfer both name instead.
    const crossHash = transfer?.partner !== undefined && partner !== null && partner.txid !== txid;
    const movement =
      transfer && accountId
        ? planTransfer(
            { ...own(address, row), accountId },
            transfer.accountId,
            partner && own(partner.address, partner.row),
            // XFER-ADDRESS: a leg of this very transaction fits exactly, the fee being the
            // sender's own; only a pair of two hashes has the missing part as its fee.
            crossHash,
          )
        : pays && accountId
          ? planTransfer({ ...own(address, row), accountId }, pays.accountId, null)
          : null;
    const linked = partner && !crossHash ? partner.address : null;
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
      const written = [
        key(address, txid),
        ...(partner ? [key(partner.address, partner.txid)] : []),
      ];
      const retireOwn = async () => {
        if (live) await this.retire(manager, owner, live, written);
      };
      const retirePartner = async () => {
        if (partner?.live && !(live && sameEntry(live, partner.live)))
          await this.retire(manager, owner, partner.live, written);
      };
      const spends = !inbound(row);
      await (spends ? retireOwn() : retirePartner());
      if (planned && accountId)
        produced = await this.produce(manager, owner, row, accountId, planned);
      if (movement && accountId)
        produced = await (pays
          ? this.carryToRecord(manager, owner, row, accountId, movement, pays)
          : this.move(manager, owner, row, accountId, movement));
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
      produced: { ...nothing, ...produced },
      linkedAddressId: produced.transferId ? linked : null,
      // A note added to a recognised transfer leaves it recognised; a Bybit trade (M22), a Tron
      // reward claim (TRON-REWARD) or Earn yield (BYBIT-EARN) the app recorded by itself is
      // recognised too.
      automatic: produced.transferId
        ? (keep && live?.automatic) || automatic
        : automatic && (produced.tradeId || produced.rewardId)
          ? true
          : null,
      paired: withdrawal?.deposit ?? null,
    });
    if (partner && !keep && produced.transferId && accountId)
      await this.append(manager, owner, {
        address: partner.address,
        txid: partner.txid,
        previous: partner.version,
        requestId: randomUUID(),
        payload: JSON.stringify({ linkedTo: { addressId: address, txid }, ...produced }),
        status: 'classified',
        details: { type: 'transfer', accountId },
        comment: null,
        produced: { ...nothing, accountId: partner.row.accountId, transferId: produced.transferId },
        linkedAddressId: crossHash ? null : address,
        automatic,
        paired: null,
      });
    return saved;
  }

  /**
   * CLS-SWAP-SAME, CLS-SWAP-CROSS: pairs the leg with the owner's raw transaction on the other
   * side as one swap; both sides name it and each other. Whatever either side recorded before
   * is voided. The paying side's entry goes first, as it held the paid coins; the receiving
   * side's entry may have spent them too (a Buy paid in USDT) or may be spent later, so it is
   * voided before the swap where the books allow that, and after it otherwise.
   */
  private async recordSwap(
    manager: EntityManager,
    owner: string,
    target: Leg,
    input: ClassificationInput,
    payload: string,
    value: SwapClassification,
  ): Promise<ClassificationRow> {
    const { address, txid, row } = target;
    const current = target.version
      ? await this.version(manager, address, txid, target.version)
      : null;
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    const other = value.with;
    const otherRow = await this.readLeg(manager, owner, other.addressId, other.txid);
    const otherVersion = await this.lockHead(manager, other.addressId, other.txid);
    const otherCurrent = otherVersion
      ? await this.version(manager, other.addressId, other.txid, otherVersion)
      : null;
    const otherLive =
      otherCurrent && (await this.active(manager, owner, otherCurrent)) ? otherCurrent : null;
    const plan = planSwap(side(address, txid, row), side(other.addressId, other.txid, otherRow));
    const comment = input.comment ?? null;
    const keep =
      live !== null &&
      operationKey(live.accountId, live.details, live.comment) ===
        operationKey(row.accountId, value, comment) &&
      live.pairedAddressId === other.addressId &&
      live.pairedTxid === other.txid &&
      otherCurrent?.status === 'classified' &&
      otherCurrent.swapId === live.swapId;
    let produced: Produced = keep && live ? live : nothing;
    if (!keep) {
      const paying = plan.paying.addressId === address && plan.paying.txid === txid;
      const [payingLive, receivingLive] = paying ? [live, otherLive] : [otherLive, live];
      const written = [key(address, txid), key(other.addressId, other.txid)];
      if (payingLive) await this.retire(manager, owner, payingLive, written);
      const receivingRetires =
        receivingLive && !(payingLive && sameEntry(payingLive, receivingLive))
          ? receivingLive
          : null;
      if (!receivingRetires) produced = await this.swap(manager, owner, plan, value.valueUsd);
      else {
        await manager.query('SAVEPOINT chain_swap');
        try {
          await this.retire(manager, owner, receivingRetires, written);
          produced = await this.swap(manager, owner, plan, value.valueUsd);
          await manager.query('RELEASE SAVEPOINT chain_swap');
        } catch (error) {
          if (!refused(error)) throw error;
          await manager.query('ROLLBACK TO SAVEPOINT chain_swap');
          produced = await this.swap(manager, owner, plan, value.valueUsd);
          await this.retire(manager, owner, receivingRetires, written);
        }
      }
    }
    const saved = await this.append(manager, owner, {
      address,
      txid,
      previous: target.version,
      requestId: input.requestId,
      payload,
      status: 'classified',
      details: input.classification,
      comment,
      produced: { ...produced, accountId: row.accountId },
      linkedAddressId: null,
      automatic: null,
      paired: other,
    });
    if (!keep)
      await this.append(manager, owner, {
        address: other.addressId,
        txid: other.txid,
        previous: otherVersion,
        requestId: randomUUID(),
        payload: JSON.stringify({
          pairedWith: { addressId: address, txid },
          swapId: produced.swapId,
        }),
        status: 'classified',
        details: { type: 'swap', with: { addressId: address, txid }, valueUsd: value.valueUsd },
        comment: null,
        produced: { ...produced, accountId: otherRow.accountId },
        linkedAddressId: null,
        automatic: null,
        paired: { addressId: address, txid },
      });
    return saved;
  }

  /**
   * The swap a plan stands for, in the account the bought coins arrived in; paid from another
   * account, the owned transfer that brings the coins there first (CLS-SWAP-CROSS).
   */
  private async swap(
    manager: EntityManager,
    owner: string,
    plan: PlannedSwap,
    valueUsd: string | null,
  ): Promise<Produced> {
    const paid = await findOrCreateInstrument(manager, owner, chainCoin(plan.paying), true);
    const bought = await findOrCreateInstrument(manager, owner, chainCoin(plan.receiving), true);
    if (!paid || !bought) throw new Error('Chain coin was not created');
    let transferId: string | null = null;
    if (plan.carry) {
      const carry = plan.carry;
      const { value } = await this.transfers.mutateWithin(
        manager,
        owner,
        'create',
        parseTransferCreate({
          requestId: randomUUID(),
          expectedFromJournalRevision: await this.revision(manager, owner, carry.fromAccountId),
          expectedToJournalRevision: await this.revision(manager, owner, carry.toAccountId),
          fromAccountId: carry.fromAccountId,
          toAccountId: carry.toAccountId,
          assertInternal: true,
          instrumentId: paid.id,
          occurredAt: carry.occurredAt,
          quantity: carry.quantity,
          feeInstrumentId: carry.feeQuantity === '0' ? null : paid.id,
          feeQuantity: carry.feeQuantity,
        }),
      );
      transferId = value.transfer.transferId;
    }
    const considerationUsd = swapValueUsd(
      valueUsd,
      plan,
      valueUsd === null ? await this.storedPrice(manager, paid.symbol, plan.occurredAt) : null,
    );
    const fee = plan.feeQuantity !== '0';
    const input: ChainSwapCreateInput = {
      ...parseSwapCreate({
        requestId: randomUUID(),
        expectedJournalRevision: await this.revision(manager, owner, plan.accountId),
        assertExecuted: true,
        outgoingInstrumentId: paid.id,
        incomingInstrumentId: bought.id,
        occurredAt: plan.occurredAt,
        orderWithinTimestamp: 0,
        outgoingQuantity: plan.paid,
        incomingQuantity: plan.received,
        considerationUsd,
        feeSource: fee ? 'held' : null,
        feeInstrumentId: fee ? paid.id : null,
        feeQuantity: plan.feeQuantity,
      }),
      orderWithinTimestamp: null,
    };
    const { value } = await this.swaps.mutateWithin(
      manager,
      owner,
      plan.accountId,
      'create',
      input,
    );
    return {
      ...nothing,
      transferId,
      swapAccountId: plan.accountId,
      swapId: value.swap.swapId,
    };
  }

  /**
   * FEE-VALUE: a fee answered without a value is worth what its coins were at the block time:
   * USDT and USDC 1:1, other coins at their stored price. With no price stored the owner enters
   * the value. Only the journal entry carries it; the saved answer stays empty.
   */
  private async priced<T extends Classification>(
    manager: EntityManager,
    row: LegRow,
    value: T,
  ): Promise<T> {
    if (value.type !== 'fee' || value.valueUsd !== null) return value;
    const chain = leg(row);
    const { symbol } = chainCoin(chain);
    const { quantity } = legMovement(chain);
    const valueUsd = storedValueUsd(
      symbol,
      quantity,
      await this.storedPrice(manager, symbol, chain.blockTime),
    );
    if (valueUsd === null)
      throw new UnprocessableEntityException('No stored price for this coin at that time');
    return { ...value, valueUsd };
  }

  /** CLS-SWAP-VALUE: the paid coin's stored USD price at the swap, if it is recent enough. */
  private async storedPrice(manager: EntityManager, symbol: string | null, at: string) {
    if (!symbol) return null;
    const [price] = await marketPricesAt(manager, [{ asset: symbol.toUpperCase(), at }]);
    return price?.price ?? null;
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
    named?: { addressId: string; txid: string },
  ): Promise<Partner | null> {
    if (named) return this.namedPartner(manager, owner, target, accountId, named);
    // The same transaction identity, or (M22) a Bybit record and a wallet leg of one hash.
    const rows: (LegRow & { addressId: string; txid: string })[] = await manager.query(
      `SELECT t."addressId", t.txid, ${legColumns}
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        WHERE t."ownerId"=$1 AND (t.txid=$2 OR split_part(t.txid, '-', 1)=$2
            OR t.txid=split_part($2, '-', 1))
          AND t."addressId"<>$3 AND w."accountId"=$4
        ORDER BY t."addressId", t.txid`,
      [owner, target.txid, target.address, accountId],
    );
    const sends = !inbound(target.row);
    const opposite = rows.filter(
      (row) =>
        sameTransaction({ network: target.row.network, txid: target.txid }, row) &&
        // With Bybit on one side, only the leg of the same coin is the other side.
        ((!isExchange(row.network) && !isExchange(target.row.network)) ||
          coinOf(row) === coinOf(target.row)) &&
        legMovement(leg(row)).quantity !== '0' &&
        inbound(row) === sends,
    );
    if (opposite.length === 0) return null;
    if (opposite.length > 1)
      throw new UnprocessableEntityException(
        'Several addresses of that account took part in this transaction',
      );
    return this.partnerOf(manager, owner, opposite[0]);
  }

  /** The partner with its current answer, locked. */
  private async partnerOf(
    manager: EntityManager,
    owner: string,
    found: LegRow & { addressId: string; txid: string },
  ): Promise<Partner> {
    const version = await this.lockHead(manager, found.addressId, found.txid);
    const current = version
      ? await this.version(manager, found.addressId, found.txid, version)
      : null;
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    return { address: found.addressId, txid: found.txid, row: found, version, current, live };
  }

  /**
   * XFER-PROPOSED: the other side the owner named, which has another hash than this
   * transaction. It must be a withdrawal for a receipt (or the reverse) of the same coin in the
   * account of the transfer, and fit as a pair; otherwise the answer is refused.
   */
  private async namedPartner(
    manager: EntityManager,
    owner: string,
    target: Leg,
    accountId: string,
    named: { addressId: string; txid: string },
  ): Promise<Partner> {
    const [found]: (LegRow & { addressId: string; txid: string })[] = await manager.query(
      `SELECT t."addressId", t.txid, ${legColumns}
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        WHERE t."ownerId"=$1 AND t."addressId"=$2 AND t.txid=$3 AND w."accountId"=$4`,
      [owner, named.addressId, named.txid, accountId],
    );
    const mine = own(target.address, target.row);
    const there = found && own(found.addressId, found);
    const sends = !inbound(target.row);
    const fits =
      found &&
      there &&
      found.addressId !== target.address &&
      (sends
        ? pairFits(
            { ...mine, blockTime: target.row.blockTime },
            { ...there, blockTime: found.blockTime },
          )
        : pairFits(
            { ...there, blockTime: found.blockTime },
            { ...mine, blockTime: target.row.blockTime },
          ));
    if (!fits || !found)
      throw new UnprocessableEntityException(
        'That transaction is not the other side of this one: it must move the same coin the other way, within a day and a fee of the amount',
      );
    return this.partnerOf(manager, owner, found);
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
    if (row.swapId && row.swapAccountId) {
      const head = await readSwapHead(manager, owner, row.swapAccountId, row.swapId);
      return head !== undefined && projectSwapVersion(head).kind !== 'void';
    }
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
    // An outgoing Other, a pool deposit, a withdrawal without a gain and a movement recorded
    // by hand produced no entry: the answer itself is what counts (D1, POOL-*, CLS-RECORDED).
    return (
      row.status === 'classified' &&
      (row.type === 'other' ||
        row.type === 'pool-deposit' ||
        row.type === 'pool-withdrawal' ||
        row.type === 'recorded')
    );
  }

  /**
   * CLS-RECORDED: the record must be a trade or swap the owner added by hand or from CSV, still
   * counting, in this wallet's account, that moved this coin the way the transaction did.
   * CLS-PAID: USDT or USDC sent from the wallet may instead pay for a purchase in another
   * account that has not been paid from that account's cash; the purchase is returned then.
   */
  private async checkRecord(
    manager: EntityManager,
    owner: string,
    row: LegRow,
    accountId: string,
    value: RecordedClassification,
  ): Promise<Pays | null> {
    const { id, kind } = value.operation;
    const [found]: {
      accountId: string;
      side: 'buy' | 'sell' | null;
      asset: string | null;
      cash: string | null;
      incoming: string | null;
      occurredAt: Date | null;
      cashSpent: string | null;
      gross: string | null;
      fee: string | null;
      other: boolean | null;
    }[] =
      kind === 'trade'
        ? await manager.query(
            `SELECT t."accountId", v.side, i.symbol AS asset, si.symbol AS cash, NULL AS incoming,
                v."occurredAt", s.quantity AS "cashSpent", v."grossUsd" AS gross, v."feeUsd" AS fee,
                (p."tradeId" IS NOT NULL OR u.purpose IS NOT NULL) AS other
              FROM account_trades t
              JOIN account_trade_versions v ON v."ownerId"=t."ownerId"
                AND v."accountId"=t."accountId" AND v."tradeId"=t.id
                AND v.version=t."currentVersion"
              JOIN accounting_instruments i ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"
              LEFT JOIN account_trade_version_settlements s ON s."ownerId"=v."ownerId"
                AND s."accountId"=v."accountId" AND s."tradeId"=v."tradeId"
                AND s.version=v.version
              LEFT JOIN accounting_instruments si ON si."ownerId"=s."ownerId"
                AND si.id=s."instrumentId"
              LEFT JOIN account_trade_version_payments p ON p."ownerId"=v."ownerId"
                AND p."accountId"=v."accountId" AND p."tradeId"=v."tradeId"
                AND p.version=v.version
              LEFT JOIN account_trade_version_purposes u ON u."ownerId"=v."ownerId"
                AND u."accountId"=v."accountId" AND u."tradeId"=v."tradeId"
                AND u.version=v.version
              WHERE t."ownerId"=$1 AND t.id=$2 AND v.kind<>'void'
                AND NOT EXISTS (SELECT 1 FROM chain_transaction_classification_versions x
                  WHERE x."ownerId"=t."ownerId" AND x."tradeId"=t.id)`,
            [owner, id],
          )
        : await manager.query(
            `SELECT s."accountId", NULL AS side, o.symbol AS asset, NULL AS cash,
                n.symbol AS incoming, NULL AS "occurredAt", NULL AS "cashSpent", NULL AS gross,
                NULL AS fee, NULL AS other
              FROM account_swaps s
              JOIN account_swap_versions v ON v."ownerId"=s."ownerId"
                AND v."accountId"=s."accountId" AND v."swapId"=s.id
                AND v.version=s."currentVersion"
              JOIN accounting_instruments o ON o."ownerId"=v."ownerId"
                AND o.id=v."outgoingInstrumentId"
              JOIN accounting_instruments n ON n."ownerId"=v."ownerId"
                AND n.id=v."incomingInstrumentId"
              WHERE s."ownerId"=$1 AND s.id=$2 AND v.kind<>'void'
                AND NOT EXISTS (SELECT 1 FROM chain_transaction_classification_versions x
                  WHERE x."ownerId"=s."ownerId" AND x."swapId"=s.id)`,
            [owner, id],
          );
    if (!found) throw new UnprocessableEntityException('Choose an operation you added or imported');
    if (found.accountId !== accountId) {
      // CLS-PAID: only coins sent out can pay for a purchase made in another account.
      if (kind !== 'trade' || inbound(row) || found.side !== 'buy' || !found.occurredAt)
        throw new UnprocessableEntityException('Choose an operation of this wallet');
      const purchase: PurchaseRecord = {
        side: found.side,
        asset: found.asset,
        cash: found.cash,
        cashSpent: canonicalDecimalToAtoms(found.cashSpent ?? '0'),
        total: purchaseTotal(found.gross ?? '0', found.fee ?? '0'),
        other: found.other === true,
      };
      unpaidFor(purchase, chainCoin(row).symbol);
      return { accountId: found.accountId, tradeId: id, at: found.occurredAt };
    }
    const coins =
      kind === 'trade'
        ? tradeCoins(found.side ?? 'buy', found.asset, found.cash)
        : swapCoins(found.asset, found.incoming);
    if (!recordMoves(coins, chainCoin(row).symbol, inbound(row)))
      throw new UnprocessableEntityException('That operation did not move this coin this way');
    return null;
  }

  /**
   * CLS-PAID: the coins of the transaction reach the purchase's account just before the
   * purchase, and the purchase is settled anew, so it spends them rather than counting as money
   * from outside.
   */
  private async carryToRecord(
    manager: EntityManager,
    owner: string,
    row: LegRow,
    accountId: string,
    plan: PlannedTransfer,
    pays: Pays,
  ): Promise<Produced> {
    let produced: Produced;
    try {
      produced = await this.move(
        manager,
        owner,
        row,
        accountId,
        plan,
        carryTime(row.blockTime, pays.at),
      );
    } catch (error) {
      if (!refused(error)) throw error;
      throw new UnprocessableEntityException(
        'The wallet did not hold these coins yet when that purchase was made; check the purchase date',
      );
    }
    await this.trades.settleWithin(
      manager,
      owner,
      pays.accountId,
      pays.tradeId,
      chainCoin(row).symbol as SettlementCurrency,
    );
    return produced;
  }

  /**
   * CLS-PAID: before the coins that paid for a purchase go back, the purchase is settled again
   * without them, so it does not spend what is no longer there.
   */
  private async releaseRecord(manager: EntityManager, owner: string, row: ClassificationRow) {
    const named = row.details?.type === 'recorded' ? row.details.operation : null;
    if (named?.kind !== 'trade' || !row.transferId) return;
    const [trade]: { accountId: string }[] = await manager.query(
      `SELECT "accountId" FROM account_trades WHERE "ownerId"=$1 AND id=$2`,
      [owner, named.id],
    );
    if (!trade) return;
    const leg = await this.readLeg(manager, owner, row.addressId, row.txid);
    await this.trades.settleWithin(
      manager,
      owner,
      trade.accountId,
      named.id,
      chainCoin(leg).symbol as SettlementCurrency,
      row.transferId,
    );
  }

  /**
   * POOL-WITHDRAW, POOL-PARTIAL, POOL-INVALID: the gain a withdrawal records over what its
   * deposit still had in the pool, as pool income at the time it came back; a loss or no
   * difference records nothing. The deposit must be answered as one, and no earlier withdrawal
   * may have closed it.
   */
  private async planWithdrawal(
    manager: EntityManager,
    owner: string,
    target: Leg,
    value: PoolWithdrawalClassification,
  ): Promise<PlannedOperation> {
    const { addressId, txid } = value.deposit;
    const row = await this.readLeg(manager, owner, addressId, txid);
    const version = await this.lockHead(manager, addressId, txid);
    const answer = version ? await this.version(manager, addressId, txid, version) : null;
    if (answer?.status !== 'classified' || answer.type !== 'pool-deposit')
      throw new UnprocessableEntityException('Choose a pool deposit');
    const mine = poolLeg(target.address, target.txid, target.row);
    const deposit = poolLeg(addressId, txid, row);
    checkPoolWithdrawal(mine, deposit);
    // The earlier withdrawals of the deposit; a later one only waits for this one's answer.
    const earlier = (await this.withdrawalsOf(manager, owner, addressId, txid, target))
      .filter((item) => byPoolOrder(item, at(target)) < 0)
      .map((item) => ({
        leg: poolLeg(item.address, item.txid, item.row),
        partial: item.partial,
      }));
    if (earlier.some((item) => !item.partial))
      throw new UnprocessableEntityException('That pool deposit was already withdrawn');
    const plan = planPoolWithdrawal(mine, deposit, { partial: value.partial === true, earlier });
    if (plan.gain === '0') return { journal: 'none' };
    const { symbol } = chainCoin(target.row);
    const valueUsd = poolGainValueUsd(
      value.valueUsd,
      symbol,
      plan.gain,
      value.valueUsd === null ? await this.storedPrice(manager, symbol, plan.occurredAt) : null,
    );
    return {
      journal: 'reward',
      fields: {
        occurredAt: plan.occurredAt,
        quantity: plan.gain,
        assertReward: true,
        category: 'other',
        acquisitionBasisUsd: valueUsd,
        incomeValueUsd: valueUsd,
      },
    };
  }

  /**
   * POOL-PARTIAL: the withdrawals whose current answer names this deposit, other than `except`,
   * oldest first, each with its leg.
   */
  private async withdrawalsOf(
    manager: EntityManager,
    owner: string,
    address: string,
    txid: string,
    except: Pick<Leg, 'address' | 'txid'> | null,
  ): Promise<{ address: string; txid: string; blockTime: Date; partial: boolean; row: LegRow }[]> {
    const rows: (LegRow & { addressId: string; txid: string; partial: boolean })[] =
      await manager.query(
        `SELECT h."addressId", h.txid, coalesce((v.details->>'partial')::boolean, false) AS partial,
            ${legColumns}
          FROM chain_transaction_classifications h
          JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
            AND v.txid=h.txid AND v.version=h."currentVersion"
          JOIN wallet_address_transactions t ON t."addressId"=h."addressId" AND t.txid=h.txid
          JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
          WHERE h."ownerId"=$1 AND v.status='classified' AND v.type='pool-withdrawal'
            AND v."pairedAddressId"=$2 AND v."pairedTxid"=$3
            AND NOT (h."addressId"=$4 AND h.txid=$5)`,
        [owner, address, txid, except?.address ?? address, except?.txid ?? txid],
      );
    return rows
      .map(({ addressId, txid: id, partial, ...rest }) => ({
        address: addressId,
        txid: id,
        blockTime: rest.blockTime,
        partial,
        row: rest as LegRow,
      }))
      .sort(byPoolOrder);
  }

  /**
   * POOL-PARTIAL: the parts of a deposit are settled in the order they happened, so a withdrawal
   * cannot be added before, changed or hidden under one that comes after it on the same deposit.
   */
  private async checkWithdrawalOrder(
    manager: EntityManager,
    owner: string,
    target: Leg,
    current: ClassificationRow | null,
    value: ClassificationInput['classification'],
  ) {
    const was =
      current?.status === 'classified' && current.type === 'pool-withdrawal' ? current : null;
    const next = value?.type === 'pool-withdrawal' ? value : null;
    // A note on the same answer changes what the others settle against nothing.
    const kept = was?.details as PoolWithdrawalClassification | null | undefined;
    if (
      kept &&
      next &&
      kept.deposit.addressId === next.deposit.addressId &&
      kept.deposit.txid === next.deposit.txid &&
      kept.valueUsd === next.valueUsd &&
      (kept.partial === true) === (next.partial === true)
    )
      return;
    const named = [
      was?.pairedAddressId && was.pairedTxid
        ? { addressId: was.pairedAddressId, txid: was.pairedTxid }
        : null,
      next?.deposit ?? null,
    ];
    for (const deposit of named) {
      if (!deposit) continue;
      const later = (
        await this.withdrawalsOf(manager, owner, deposit.addressId, deposit.txid, target)
      ).some((item) => byPoolOrder(item, at(target)) > 0);
      if (later)
        throw new UnprocessableEntityException(
          'A later withdrawal already returns part of this deposit; change it first',
        );
    }
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
    at: Date = row.blockTime,
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
        occurredAt: at.toISOString(),
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
    written: string[],
  ) {
    if (row.swapId && row.swapAccountId) {
      // The swap goes first: it spends what the carrying transfer brought.
      const head = await readSwapHead(manager, owner, row.swapAccountId, row.swapId);
      if (!head) throw new Error('Missing produced swap');
      await this.swaps.mutateWithin(
        manager,
        owner,
        row.swapAccountId,
        'void',
        parseSwapVoid({
          requestId: randomUUID(),
          expectedJournalRevision: await this.revision(manager, owner, row.swapAccountId),
          expectedVersion: projectSwapVersion(head).version,
        }),
        row.swapId,
      );
      if (row.transferId) await this.voidTransfer(manager, owner, row.transferId);
      if (
        row.pairedAddressId &&
        row.pairedTxid &&
        !written.includes(key(row.pairedAddressId, row.pairedTxid))
      )
        await this.unlink(manager, owner, row.pairedAddressId, row.pairedTxid, row.swapId);
      return;
    }
    if (row.transferId) {
      // CLS-PAID: a purchase that spent the coins is settled again without them first.
      if (row.type === 'recorded') await this.releaseRecord(manager, owner, row);
      await this.voidTransfer(manager, owner, row.transferId);
      // A Bybit leg and a wallet leg of one hash can differ in identity (M22).
      const other =
        row.linkedAddressId &&
        (await this.linkedTxid(manager, owner, row.linkedAddressId, row.transferId));
      if (row.linkedAddressId && other && !written.includes(key(row.linkedAddressId, other)))
        await this.unlink(manager, owner, row.linkedAddressId, other, row.transferId);
      // XFER-PROPOSED: the other leg of a pair joined across two hashes names no address.
      if (row.type === 'transfer' && !row.linkedAddressId)
        for (const sibling of await this.siblings(manager, owner, row))
          if (!written.includes(key(sibling.addressId, sibling.txid)))
            await this.unlink(manager, owner, sibling.addressId, sibling.txid, row.transferId);
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

  /** The other leg's own identity, found by the transfer its answer names. */
  /** The other legs whose current answer is the same transfer. */
  private async siblings(manager: EntityManager, owner: string, row: ClassificationRow) {
    const found: { addressId: string; txid: string }[] = await manager.query(
      `SELECT h."addressId", h.txid FROM chain_transaction_classifications h
        JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE h."ownerId"=$1 AND v."transferId"=$2 AND v.status='classified'
          AND NOT (h."addressId"=$3 AND h.txid=$4)
        ORDER BY h."addressId", h.txid`,
      [owner, row.transferId, row.addressId, row.txid],
    );
    return found;
  }

  private async linkedTxid(
    manager: EntityManager,
    owner: string,
    address: string,
    transferId: string,
  ): Promise<string | null> {
    const [linked]: { txid: string }[] = await manager.query(
      `SELECT h.txid FROM chain_transaction_classifications h
        JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE h."ownerId"=$1 AND h."addressId"=$2 AND v."transferId"=$3
        ORDER BY h.txid LIMIT 1`,
      [owner, address, transferId],
    );
    return linked?.txid ?? null;
  }

  private async voidTransfer(manager: EntityManager, owner: string, transferId: string) {
    const head = await readTransferHead(manager, owner, transferId);
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
      transferId,
    );
  }

  /** The other leg of a voided transfer or swap has no answer of its own any more. */
  private async unlink(
    manager: EntityManager,
    owner: string,
    address: string,
    txid: string,
    entryId: string,
  ) {
    const version = await this.lockHead(manager, address, txid);
    if (!version) return;
    const current = await this.version(manager, address, txid, version);
    const named = current.swapId ? current.swapId === entryId : current.transferId === entryId;
    if (current.status !== 'classified' || !named) return;
    await this.append(manager, owner, {
      address,
      txid,
      previous: version,
      requestId: randomUUID(),
      payload: JSON.stringify({ unlinkedFrom: entryId, addressId: address, txid }),
      status: 'unclassified',
      details: null,
      comment: null,
      produced: nothing,
      linkedAddressId: null,
      automatic: null,
      paired: null,
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
      paired: { addressId: string; txid: string } | null;
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
         comment,"accountId","tradeId","rewardId","transferId","linkedAddressId",automatic,
         "swapAccountId","swapId","pairedAddressId","pairedTxid")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
        entry.produced.swapAccountId,
        entry.produced.swapId,
        entry.paired?.addressId ?? null,
        entry.paired?.txid ?? null,
      ],
    );
    return saved;
  }
}

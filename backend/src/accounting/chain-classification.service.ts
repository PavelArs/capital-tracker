import { randomUUID } from 'node:crypto';
import {
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
import { latestMarketPrices } from '../prices/market-price.store';
import { isExchange } from '../wallet-addresses/chain-assets';
import { stakeMoves } from '../wallet-addresses/stake-tables';
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
  exchangeTrade,
  fitsDirection,
  legMovement,
  type PlannedOperation,
  type PoolWithdrawalClassification,
  parseClassification,
  planOperation,
  type SwapClassification,
  unfit,
} from './chain-classification';
import { isDust } from './chain-dust';
import {
  type PoolLeg,
  planPoolWithdrawal,
  poolDepositUnits,
  poolGainValueUsd,
  storedValueUsd,
} from './chain-pool';
import { type PlannedSwap, planSwap, type SwapSide, swapValueUsd } from './chain-swap';
import {
  coinOf,
  type OwnLeg,
  ownTransferPairs,
  type PlannedTransfer,
  planTransfer,
  sameTransaction,
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
import { cashAsset } from './trade-settlement';

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
interface Produced {
  accountId: string | null;
  tradeId: string | null;
  rewardId: string | null;
  /** An own transfer (M13), or the one that carried a swap's paid coins over (CLS-SWAP). */
  transferId: string | null;
  swapAccountId: string | null;
  swapId: string | null;
}
interface MatchRow extends OwnLeg {
  txid: string;
  status: 'unclassified' | 'classified' | 'hidden' | null;
}

const versionColumns = `v."addressId", v.txid, v.version, v."requestId", v."canonicalPayload",
  v.status, v.type, v.details, v.comment, v."accountId", v."tradeId", v."rewardId",
  v."transferId", v."linkedAddressId", v.automatic, v."swapAccountId", v."swapId",
  v."pairedAddressId", v."pairedTxid", v."createdAt"`;
const legColumns = `w.network, t.asset, w."accountId", t."blockTime", t."receivedUnits"::text AS "receivedUnits",
  t."sentUnits"::text AS "sentUnits", t."feeUnits"::text AS "feeUnits"`;
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
/** POOL-UNDO: a deposit cannot change while a withdrawal returns it. */
const namedDeposit = () =>
  new UnprocessableEntityException(
    'A pool withdrawal names this deposit; change the withdrawal first',
  );
const inbound = (row: LegRow) => legMovement(leg(row)).inbound;
const sameEntry = (left: Produced, right: Produced) =>
  left.tradeId === right.tradeId &&
  left.rewardId === right.rewardId &&
  left.transferId === right.transferId &&
  left.swapId === right.swapId;
/** The stored price of a coin counts for a swap only if it is at most two days older. */
const PRICE_AGE_MS = 2 * 24 * 60 * 60 * 1000;

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
          if (canonicalDecimalToAtoms(held) < needed) return false;
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
   * TRON-REWARD: records every Tron vote reward claim (a WithdrawBalance the wallet signed) as a
   * Staking reward without asking, valued at the stored TRX price of its time when there is
   * one, each in its own transaction. It needs the wallet's account; a claim the owner has
   * answered is never touched.
   */
  async recognizeStakingRewards(ownerId: string): Promise<{ recognized: number }> {
    const owner = parseUuid(ownerId);
    const claims: { addressId: string; txid: string }[] = await this.source.query(
      `SELECT t."addressId", t.txid
        FROM wallet_address_transactions t
        JOIN wallet_addresses w ON w."ownerId"=t."ownerId" AND w.id=t."addressId"
        LEFT JOIN chain_transaction_classifications h ON h."addressId"=t."addressId" AND h.txid=t.txid
        WHERE t."ownerId"=$1 AND w.network='tron' AND w."accountId" IS NOT NULL
          AND t.asset IS NULL AND t.raw->>'contractType'=$2 AND h.txid IS NULL
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
          this.logger.warn('A Tron reward could not be recorded; it stays to classify');
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
            AND NOT EXISTS (SELECT 1 FROM ${stakeMoves} m WHERE t.asset IS NULL
              AND m."addressId"=t."addressId" AND m.txid=t.txid)`,
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
    const value = input.hidden ? null : input.classification;
    const current = target.version
      ? await this.version(manager, address, txid, target.version)
      : null;
    if (
      current?.status === 'classified' &&
      current.type === 'pool-deposit' &&
      value?.type !== 'pool-deposit' &&
      (await this.withdrawalOf(manager, owner, address, txid, null))
    )
      throw namedDeposit();
    if (value?.type === 'swap')
      return this.recordSwap(manager, owner, target, input, payload, value);
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    const comment = input.comment ?? null;
    const accountId = row.accountId;
    if (value && accountId === null)
      throw new UnprocessableEntityException('Choose the account of this wallet first');
    const transfer = value?.type === 'transfer' ? value : null;
    const partner = transfer
      ? await this.partner(manager, owner, target, transfer.accountId)
      : null;
    const withdrawal = value?.type === 'pool-withdrawal' ? value : null;
    const planned = withdrawal
      ? await this.planWithdrawal(manager, owner, target, withdrawal)
      : value && value.type !== 'transfer'
        ? planOperation(leg(row), await this.priced(manager, row, value), input.comment)
        : null;
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
      produced: { ...nothing, ...produced },
      linkedAddressId: produced.transferId ? linked : null,
      // A note added to a recognised transfer leaves it recognised; a Bybit trade (M22) or a
      // Tron reward claim (TRON-REWARD) the app recorded by itself is recognised too.
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
        linkedAddressId: address,
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
    const [price] = await latestMarketPrices(manager, [symbol.toUpperCase()], new Date(at));
    return price && Date.parse(at) - Date.parse(price.observedAt) <= PRICE_AGE_MS
      ? price.price
      : null;
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
    const [found] = opposite;
    const version = await this.lockHead(manager, found.addressId, found.txid);
    const current = version
      ? await this.version(manager, found.addressId, found.txid, version)
      : null;
    const live = current && (await this.active(manager, owner, current)) ? current : null;
    return { address: found.addressId, txid: found.txid, row: found, version, current, live };
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
    // An outgoing Other, a pool deposit and a withdrawal without a gain produced no entry: the
    // answer itself is what counts (D1, POOL-*).
    return (
      row.status === 'classified' &&
      (row.type === 'other' || row.type === 'pool-deposit' || row.type === 'pool-withdrawal')
    );
  }

  /**
   * POOL-WITHDRAW, POOL-INVALID: the gain a withdrawal records over the deposit it names, as pool
   * income at the time it came back; a loss or no difference records nothing. The deposit must
   * be answered as one, and no other withdrawal may name it.
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
    const plan = planPoolWithdrawal(
      poolLeg(target.address, target.txid, target.row),
      poolLeg(addressId, txid, row),
    );
    if (await this.withdrawalOf(manager, owner, addressId, txid, target))
      throw new UnprocessableEntityException('That pool deposit was already withdrawn');
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

  /** The withdrawal whose current answer names this deposit, other than `except`; if any. */
  private async withdrawalOf(
    manager: EntityManager,
    owner: string,
    address: string,
    txid: string,
    except: Pick<Leg, 'address' | 'txid'> | null,
  ): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM chain_transaction_classifications h
        JOIN chain_transaction_classification_versions v ON v."addressId"=h."addressId"
          AND v.txid=h.txid AND v.version=h."currentVersion"
        WHERE h."ownerId"=$1 AND v.status='classified' AND v.type='pool-withdrawal'
          AND v."pairedAddressId"=$2 AND v."pairedTxid"=$3
          AND NOT (h."addressId"=$4 AND h.txid=$5)
        LIMIT 1`,
      [owner, address, txid, except?.address ?? address, except?.txid ?? txid],
    );
    return rows.length > 0;
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
      await this.voidTransfer(manager, owner, row.transferId);
      // A Bybit leg and a wallet leg of one hash can differ in identity (M22).
      const other =
        row.linkedAddressId &&
        (await this.linkedTxid(manager, owner, row.linkedAddressId, row.transferId));
      if (row.linkedAddressId && other && !written.includes(key(row.linkedAddressId, other)))
        await this.unlink(manager, owner, row.linkedAddressId, other, row.transferId);
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

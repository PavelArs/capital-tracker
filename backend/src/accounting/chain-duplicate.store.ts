import type { EntityManager } from 'typeorm';
import {
  projectRewardVersion,
  type RewardVersionRow,
  rewardHeadJoin,
  rewardVersionSelect,
} from './asset-reward.store';
import type { Classification } from './chain-classification';
import { type Movement, rewardAnswer, tradeAnswer } from './chain-duplicate';
import { canonicalDecimalToAtoms } from './money';
import { projectTradeVersion, type VersionRow, versionSelect } from './trade-journal.store';

/** A trade or reward the owner added by hand or from CSV, as an answer to a transaction. */
export interface OwnRecord extends Movement {
  kind: 'trade' | 'reward';
  id: string;
  /** The version of the record now. */
  version: number;
  /** What the owner's record says, as the answer to a transaction. */
  answer: Classification;
  comment: string | null;
  /** The record's value in USD, when it has one. */
  valueUsd: string | null;
  /** The record's amount of the coin, as a decimal. */
  quantity: string;
}

/**
 * SQL: no transaction's current answer names the entry `column` of `v`, nor, for a trade, a
 * record it stands for (CLS-RECORDED): such a record is already tied to the chain.
 */
const unnamed = (column: 'tradeId' | 'rewardId') => `NOT EXISTS (
    SELECT 1 FROM chain_transaction_classifications h
      JOIN chain_transaction_classification_versions x ON x."addressId"=h."addressId"
        AND x.txid=h.txid AND x.version=h."currentVersion"
      WHERE x."ownerId"=v."ownerId" AND x.status='classified'
        AND (x."${column}"=v."${column}"${
          column === 'tradeId' ? ` OR x.details->'operation'->>'id'=v."tradeId"::text` : ''
        }))`;

/**
 * CLS-DUPLICATE: the records in the given accounts that still count and that no blockchain
 * transaction produced or stands for. A record whose amounts a transaction's answer cannot
 * repeat is left out.
 */
export async function readOwnRecords(
  manager: EntityManager,
  owner: string,
  accounts: readonly string[],
): Promise<OwnRecord[]> {
  if (accounts.length === 0) return [];
  const records: OwnRecord[] = [];
  const trades: (VersionRow & { accountId: string })[] = await manager.query(
    `${versionSelect} JOIN account_trades t ON t."ownerId"=v."ownerId" AND t."accountId"=v."accountId"
      AND t.id=v."tradeId" AND t."currentVersion"=v.version
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
        AND ${unnamed('tradeId')}`,
    [owner, accounts],
  );
  for (const row of trades) {
    const trade = projectTradeVersion(row);
    const coin = trade.instrumentSymbol?.toUpperCase();
    const answer = tradeAnswer({
      side: trade.side,
      grossUsd: trade.grossUsd,
      feeUsd: trade.feeUsd,
      paid: trade.paid
        ? {
            currency: trade.paid.currency,
            gross: trade.paid.gross,
            fee: trade.paid.fee,
            perUsd: trade.paid.perUsd,
          }
        : undefined,
      settlementSymbol: trade.settlement?.instrumentSymbol ?? null,
      purpose: trade.purpose,
    });
    if (!coin || !answer) continue;
    records.push({
      kind: 'trade',
      id: trade.tradeId,
      version: trade.version,
      accountId: row.accountId,
      coin,
      inbound: trade.side === 'buy',
      atoms: canonicalDecimalToAtoms(trade.quantity),
      at: new Date(trade.occurredAt),
      answer,
      comment: trade.comment ?? null,
      valueUsd: trade.grossUsd,
      quantity: trade.quantity,
    });
  }
  const rewards: RewardVersionRow[] = await manager.query(
    `${rewardVersionSelect} ${rewardHeadJoin}
      WHERE v."ownerId"=$1 AND v."accountId"=ANY($2::uuid[]) AND v.kind<>'void'
        AND ${unnamed('rewardId')}`,
    [owner, accounts],
  );
  for (const row of rewards) {
    const reward = projectRewardVersion(row);
    const coin = reward.instrumentSymbol?.toUpperCase();
    const answer = rewardAnswer(reward);
    if (!coin || !answer) continue;
    records.push({
      kind: 'reward',
      id: reward.rewardId,
      version: reward.version,
      accountId: row.accountId,
      coin,
      inbound: true,
      atoms: canonicalDecimalToAtoms(reward.quantity),
      at: new Date(reward.occurredAt),
      answer,
      comment: null,
      valueUsd: reward.incomeValueUsd,
      quantity: reward.quantity,
    });
  }
  return records;
}

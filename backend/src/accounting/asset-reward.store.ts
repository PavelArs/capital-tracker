import type { EntityManager } from 'typeorm';
import type { FifoReward } from './asset-reward-types';
import { parseDecimal } from './input';

export const REWARD_LIMITS = { activeRewards: 1000, versions: 10000 } as const;
export type RewardKind = 'create' | 'correct' | 'void';
export interface RewardVersion extends FifoReward {
  accountId: string;
  journalRevision: number;
  requestId: string;
  kind: RewardKind;
  createdAt: string;
}
export interface RewardVersionRow extends Omit<RewardVersion, 'occurredAt' | 'createdAt'> {
  occurredAt: Date;
  createdAt: Date;
  canonicalPayload: string;
}
export const rewardVersionSelect = `SELECT v.*,i.name AS "instrumentName",i.symbol AS "instrumentSymbol"
  FROM account_reward_versions v JOIN accounting_instruments i
    ON i."ownerId"=v."ownerId" AND i.id=v."instrumentId"`;
export const rewardHeadJoin = `JOIN account_rewards r ON r."ownerId"=v."ownerId"
  AND r."accountId"=v."accountId" AND r.id=v."rewardId" AND r."currentVersion"=v.version`;

export function projectRewardVersion(row: RewardVersionRow): RewardVersion {
  return {
    accountId: row.accountId,
    rewardId: row.rewardId,
    version: row.version,
    journalRevision: row.journalRevision,
    requestId: row.requestId,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    instrumentSymbol: row.instrumentSymbol,
    category: row.category,
    occurredAt: row.occurredAt.toISOString(),
    orderWithinTimestamp: row.orderWithinTimestamp,
    quantity: parseDecimal(row.quantity, true),
    acquisitionBasisUsd:
      row.acquisitionBasisUsd === null ? null : parseDecimal(row.acquisitionBasisUsd, false),
    incomeValueUsd: row.incomeValueUsd === null ? null : parseDecimal(row.incomeValueUsd, false),
  };
}
export function rewardReceipt(row: RewardVersionRow) {
  return {
    accountId: row.accountId,
    journalRevision: row.journalRevision,
    reward: projectRewardVersion(row),
  };
}
export async function readRewardReplay(
  manager: EntityManager,
  owner: string,
  account: string,
  request: string,
): Promise<RewardVersionRow | undefined> {
  const [row]: RewardVersionRow[] = await manager.query(
    `${rewardVersionSelect} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."requestId"=$3`,
    [owner, account, request],
  );
  return row;
}
export async function readRewardHead(
  manager: EntityManager,
  owner: string,
  account: string,
  id: string,
): Promise<RewardVersionRow | undefined> {
  const [row]: RewardVersionRow[] = await manager.query(
    `${rewardVersionSelect} ${rewardHeadJoin} WHERE v."ownerId"=$1 AND v."accountId"=$2 AND v."rewardId"=$3`,
    [owner, account, id],
  );
  return row;
}
export async function readRewardCounts(manager: EntityManager, owner: string, account?: string) {
  const parameters = account === undefined ? [owner] : [owner, account];
  const accountFilter = account === undefined ? '' : ' AND v."accountId"=$2';
  const [versions]: { count: number }[] = await manager.query(
    `SELECT count(*)::int AS count FROM account_reward_versions v WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  const [heads]: { active: number; count: number }[] = await manager.query(
    `SELECT count(*)::int AS count,count(*) FILTER(WHERE v.kind<>'void')::int AS active
      FROM account_reward_versions v ${rewardHeadJoin} WHERE v."ownerId"=$1${accountFilter}`,
    parameters,
  );
  return { versionCount: versions.count, activeCount: heads.active, headCount: heads.count };
}
export async function appendRewardVersion(
  manager: EntityManager,
  owner: string,
  value: Omit<RewardVersion, 'createdAt'> & { canonicalPayload: string },
) {
  if (value.kind === 'create') {
    await manager.query(
      'INSERT INTO account_rewards(id,"ownerId","accountId","currentVersion") VALUES($1,$2,$3,1)',
      [value.rewardId, owner, value.accountId],
    );
  }
  const [row]: RewardVersionRow[] = await manager.query(
    `INSERT INTO account_reward_versions
    ("ownerId","accountId","rewardId",version,"journalRevision","requestId","canonicalPayload",kind,
     "instrumentId",category,"occurredAt","orderWithinTimestamp",quantity,"acquisitionBasisUsd","incomeValueUsd")
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      owner,
      value.accountId,
      value.rewardId,
      value.version,
      value.journalRevision,
      value.requestId,
      value.canonicalPayload,
      value.kind,
      value.instrumentId,
      value.category,
      value.occurredAt,
      value.orderWithinTimestamp,
      value.quantity,
      value.acquisitionBasisUsd,
      value.incomeValueUsd,
    ],
  );
  if (value.kind !== 'create') {
    await manager.query(
      'UPDATE account_rewards SET "currentVersion"=$4 WHERE "ownerId"=$1 AND "accountId"=$2 AND id=$3',
      [owner, value.accountId, value.rewardId, value.version],
    );
  }
  return rewardReceipt({
    ...row,
    instrumentName: value.instrumentName,
    instrumentSymbol: value.instrumentSymbol,
  });
}

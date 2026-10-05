import apiClient from './client';

export type RewardCategory = 'staking' | 'airdrop' | 'other' | 'unclassified';

export interface RewardVersion {
  rewardId: string;
  version: number;
  journalRevision: number;
  requestId: string;
  kind: 'create' | 'correct' | 'void';
  createdAt: string;
  instrumentId: string;
  instrumentName: string;
  instrumentSymbol: string | null;
  category: RewardCategory;
  occurredAt: string;
  orderWithinTimestamp: number;
  quantity: string;
  acquisitionBasisUsd: string | null;
  incomeValueUsd: string | null;
}

export interface RewardReceipt {
  accountId: string;
  journalRevision: number;
  reward: RewardVersion;
}

export interface RewardCommand {
  requestId: string;
  expectedJournalRevision: number;
  assertReward: true;
  instrumentId: string;
  category: RewardCategory;
  occurredAt: string;
  /** Without an order the server places the reward after every operation at its instant. */
  orderWithinTimestamp?: number;
  quantity: string;
  acquisitionBasisUsd: string | null;
  incomeValueUsd: string | null;
}

export interface RewardCreateCommand extends RewardCommand {}
export interface RewardCorrectionCommand extends RewardCommand {
  expectedVersion: number;
}
export interface RewardVoidCommand {
  requestId: string;
  expectedJournalRevision: number;
  expectedVersion: number;
}

export interface RewardPage {
  accountId: string;
  journalRevision: number;
  activeCount: number;
  versionCount: number;
  limits: { activeRewards: number; versions: number };
  items: RewardVersion[];
  nextOffset: number | null;
}

export interface RewardVersions {
  items: RewardVersion[];
  nextBeforeVersion: number | null;
}

const accountPath = (accountId: string) =>
  `/accounting/accounts/${encodeURIComponent(accountId)}/rewards`;
const rewardPath = (accountId: string, rewardId: string) =>
  `${accountPath(accountId)}/${encodeURIComponent(rewardId)}`;

export const assetRewardsApi = {
  create: async (accountId: string, input: RewardCreateCommand): Promise<RewardReceipt> =>
    (await apiClient.post<RewardReceipt>(accountPath(accountId), input)).data,
  correct: async (
    accountId: string,
    rewardId: string,
    input: RewardCorrectionCommand,
  ): Promise<RewardReceipt> =>
    (await apiClient.post<RewardReceipt>(`${rewardPath(accountId, rewardId)}/correct`, input)).data,
  void: async (
    accountId: string,
    rewardId: string,
    input: RewardVoidCommand,
  ): Promise<RewardReceipt> =>
    (await apiClient.post<RewardReceipt>(`${rewardPath(accountId, rewardId)}/void`, input)).data,
  list: async (accountId: string, journalRevision: number, offset = 0): Promise<RewardPage> =>
    (
      await apiClient.get<RewardPage>(accountPath(accountId), {
        params: { journalRevision, offset, limit: 50 },
      })
    ).data,
  versions: async (
    accountId: string,
    rewardId: string,
    beforeVersion?: number,
  ): Promise<RewardVersions> =>
    (
      await apiClient.get<RewardVersions>(`${rewardPath(accountId, rewardId)}/versions`, {
        params: {
          limit: 10,
          ...(beforeVersion === undefined ? {} : { beforeVersion }),
        },
      })
    ).data,
};

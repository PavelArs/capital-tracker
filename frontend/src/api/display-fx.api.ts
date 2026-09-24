import apiClient from './client';

export type DisplayFxOutcome =
  | 'idle'
  | 'running'
  | 'ok'
  | 'provider-error'
  | 'rate-limited'
  | 'invalid-data'
  | 'interrupted';

export interface DisplayFxReport {
  amountUsd: string;
  enabled: boolean;
  source: 'exchangerate-api-open';
  kind: 'indicative-daily';
  basis: 'latest-stored-observation';
  status: 'unavailable' | 'fresh' | 'stale';
  observation: null | {
    observedAt: string;
    fetchedAt: string;
    nextUpdateAt: string;
    endOfLifeAt: string | null;
    eurRate: string;
    rubRate: string;
    eurAmount: string;
    rubAmount: string;
  };
  collection: {
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextAttemptAt: string | null;
    outcome: DisplayFxOutcome;
    inProgress: boolean;
  };
}

export type DisplayFxRefreshOutcome =
  | 'collected'
  | 'cooldown'
  | 'in-progress'
  | 'disabled'
  | 'failed'
  | 'rate-limited'
  | 'superseded';

export const displayFxApi = {
  read: async (amountUsd: string): Promise<DisplayFxReport> =>
    (await apiClient.get<DisplayFxReport>('/reporting/usd-display', { params: { amountUsd } }))
      .data,
  refresh: async (): Promise<{ outcome: DisplayFxRefreshOutcome }> =>
    (
      await apiClient.post<{ outcome: DisplayFxRefreshOutcome }>(
        '/reporting/usd-display/refresh',
        {},
      )
    ).data,
};

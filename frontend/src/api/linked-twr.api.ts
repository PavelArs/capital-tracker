import apiClient from './client';
import type { ProfitPreview, ProfitPreviewInput } from './period-profit.api';

export interface TwrBoundaryPlan {
  from: string;
  to: string;
  coverageFrom: string;
  journalRevision: number;
  basis: 'owner-declared-usd-flows';
  completeness: 'unreconciled';
  boundaryLimit: 32;
  netFlowAtStartUsd: string;
  interiorNetFlowDateCount: number;
  status: 'ready' | 'unavailable';
  reason: null | 'too-many-boundaries';
  boundaries: { at: string; netFlowUsd: string }[];
}

export interface LinkedTwrInput extends ProfitPreviewInput {
  expectedJournalRevision: number;
  boundaryValuations: { at: string; valueBeforeUsd: string }[];
}

type LinkedTwrUnavailableReason =
  | 'too-many-boundaries'
  | 'missing-flow-boundary-valuations'
  | 'nonpositive-opening-capital'
  | 'nonpositive-subperiod-capital';

export interface LinkedTwrBoundary {
  at: string;
  netFlowUsd: string;
  valueBeforeUsd: string | null;
  valueAfterUsd: string | null;
}

interface LinkedTwrMetadata {
  method: 'geometrically-linked-UTC-ms';
  rateRoundingBound: '0.0000000000005';
  boundaryLimit: 32;
  netFlowAtStartUsd: string;
  startingCapitalUsd: string;
  interiorNetFlowDateCount: number;
  boundaries: LinkedTwrBoundary[];
}

export type LinkedTwrResult = LinkedTwrMetadata &
  (
    | { status: 'available'; reason: null; periodRate: string; periodPercent: string }
    | {
        status: 'unavailable';
        reason: LinkedTwrUnavailableReason;
        periodRate: null;
        periodPercent: null;
      }
  );

export interface LinkedTwrPreview extends ProfitPreview {
  linkedTwr: LinkedTwrResult;
}

export const linkedTwrApi = {
  boundaries: async (from: string, to: string): Promise<TwrBoundaryPlan> =>
    (
      await apiClient.get<TwrBoundaryPlan>('/accounting/portfolio/twr-boundaries', {
        params: { from, to },
      })
    ).data,
  preview: async (input: LinkedTwrInput): Promise<LinkedTwrPreview> =>
    (await apiClient.post<LinkedTwrPreview>('/accounting/portfolio/linked-twr-preview', input))
      .data,
};

import apiClient from './client';
import type { ProfitPreview, ProfitPreviewInput } from './period-profit.api';

export type TwrUnavailableReason =
  | 'missing-flow-boundary-valuations'
  | 'nonpositive-opening-capital';

interface TwrMetadata {
  method: 'endpoint-ratio-UTC-ms';
  rateRoundingBound: '0.0000000000005';
  netFlowAtStartUsd: string;
  startingCapitalUsd: string;
  interiorNetFlowDateCount: number;
}

export type TwrResult = TwrMetadata &
  (
    | { status: 'available'; reason: null; periodRate: string; periodPercent: string }
    | {
        status: 'unavailable';
        reason: TwrUnavailableReason;
        periodRate: null;
        periodPercent: null;
      }
  );

export interface TwrPreview extends ProfitPreview {
  twr: TwrResult;
}

export const twrPreviewApi = {
  preview: async (input: ProfitPreviewInput): Promise<TwrPreview> =>
    (await apiClient.post<TwrPreview>('/accounting/portfolio/twr-preview', input)).data,
};

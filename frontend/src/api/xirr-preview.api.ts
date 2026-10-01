import apiClient from './client';
import type { ProfitPreview, ProfitPreviewInput } from './period-profit.api';

export type XirrUnavailableReason =
  | 'insufficient-cash-flows'
  | 'one-sided-cash-flows'
  | 'unsupported-pattern'
  | 'too-many-cash-flow-dates'
  | 'outside-supported-range'
  | 'numerical-failure';

interface XirrMetadata {
  convention: 'ACT/365F-UTC-ms';
  rateTolerance: '0.0000000001';
  cashFlowDateCount: number;
  shortPeriod: boolean;
}

export type XirrResult = XirrMetadata &
  (
    | { status: 'available'; annualRate: string; annualPercent: string; reason: null }
    | {
        status: 'unavailable';
        annualRate: null;
        annualPercent: null;
        reason: XirrUnavailableReason;
      }
  );

export interface XirrPreview extends ProfitPreview {
  xirr: XirrResult;
}

export const xirrPreviewApi = {
  preview: async (input: ProfitPreviewInput): Promise<XirrPreview> =>
    (await apiClient.post<XirrPreview>('/accounting/portfolio/xirr-preview', input)).data,
};

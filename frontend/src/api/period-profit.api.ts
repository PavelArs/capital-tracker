import apiClient from './client';

export interface ProfitPreviewInput {
  from: string;
  to: string;
  openingValueUsd: string;
  closingValueUsd: string;
  assertReviewed: true;
}

export interface ProfitPreview {
  from: string;
  to: string;
  coverageFrom: string;
  journalRevision: number;
  basis: 'manual-usd-valuations';
  flowBasis: 'owner-declared-usd-flows';
  completeness: 'unreconciled';
  openingValueUsd: string;
  closingValueUsd: string;
  flows: {
    contributionsUsd: string;
    withdrawalsUsd: string;
    netContributionsUsd: string;
    flowCount: number;
  };
  profitUsd: string;
}

export const periodProfitApi = {
  preview: async (input: ProfitPreviewInput): Promise<ProfitPreview> =>
    (await apiClient.post<ProfitPreview>('/accounting/portfolio/profit-preview', input)).data,
};

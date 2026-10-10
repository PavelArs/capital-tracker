import type { BasisCoverage } from './trades.api';
export interface SwapTotals {
  considerationUsd: string | null;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  realizedUsd: string | null;
  coverage: {
    consideration: BasisCoverage;
    principal: BasisCoverage;
    fee: BasisCoverage;
    realized: BasisCoverage;
  };
}
export interface SwapSummary extends SwapTotals {
  activeCount: number;
}

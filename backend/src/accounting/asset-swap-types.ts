import type { BasisCoverage, TransferAllocationItem } from './owned-transfer-types';

/** Current-effective head after immutable versions have been resolved. */
export interface FifoSwap {
  swapId: string;
  version: number;
  outgoingInstrumentId: string;
  outgoingInstrumentName: string;
  outgoingInstrumentSymbol: string | null;
  incomingInstrumentId: string;
  incomingInstrumentName: string;
  incomingInstrumentSymbol: string | null;
  occurredAt: string;
  orderWithinTimestamp: number;
  outgoingQuantity: string;
  incomingQuantity: string;
  considerationUsd: string | null;
  feeSource: 'held' | 'incoming' | null;
  feeInstrumentId: string | null;
  feeQuantity: string;
}

export interface SwapCoverage {
  consideration: BasisCoverage;
  principal: BasisCoverage;
  fee: BasisCoverage;
  realized: BasisCoverage;
}

export interface SwapAllocation {
  swapId: string;
  considerationUsd: string | null;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  realizedUsd: string | null;
  coverage: SwapCoverage;
  items: TransferAllocationItem[];
}

export interface SwapSummary {
  activeCount: number;
  considerationUsd: string | null;
  principalBasisUsd: string | null;
  feeConsumedBasisUsd: string | null;
  realizedUsd: string | null;
  coverage: SwapCoverage;
}

export function emptySwapSummary(): SwapSummary {
  const zero = () => ({ knownSubtotalUsd: '0', unknownCount: 0 });
  return {
    activeCount: 0,
    considerationUsd: '0',
    principalBasisUsd: '0',
    feeConsumedBasisUsd: '0',
    realizedUsd: '0',
    coverage: {
      consideration: zero(),
      principal: zero(),
      fee: zero(),
      realized: zero(),
    },
  };
}

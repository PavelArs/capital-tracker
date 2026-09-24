import type { FifoSwap } from './asset-swap-types';
import { FifoHistoryError } from './fifo-lot-interval';
import { canonicalDecimalToAtoms } from './money';

function amount(value: string): bigint {
  if (typeof value !== 'string') throw new FifoHistoryError();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,30}))?$/.exec(value);
  if (!match || match[1].length > 48) throw new FifoHistoryError();
  return canonicalDecimalToAtoms(value);
}

/** Validate the effective economic shape even when replay stops before this event. */
export function swapAtoms(swap: FifoSwap) {
  const outgoing = amount(swap.outgoingQuantity);
  const incoming = amount(swap.incomingQuantity);
  const fee = amount(swap.feeQuantity);
  const consideration = swap.considerationUsd === null ? null : amount(swap.considerationUsd);
  if (
    outgoing <= 0n ||
    incoming <= 0n ||
    fee < 0n ||
    (consideration !== null && consideration < 0n) ||
    swap.outgoingInstrumentId === swap.incomingInstrumentId ||
    (fee === 0n && (swap.feeSource !== null || swap.feeInstrumentId !== null)) ||
    (fee > 0n &&
      (swap.feeInstrumentId === null ||
        (swap.feeSource !== 'held' && swap.feeSource !== 'incoming'))) ||
    (swap.feeSource === 'incoming' &&
      (swap.feeInstrumentId !== swap.incomingInstrumentId || fee > incoming))
  )
    throw new FifoHistoryError();
  return { outgoing, incoming, fee, consideration };
}

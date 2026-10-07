import { canonicalDecimalToAtoms, formatAtoms } from './money';
import type { NativeAmount, PortfolioLot } from './portfolio-valuation';

// D1, CLS-PROVISIONAL: a blockchain transaction nobody has answered yet has already moved the
// coins, so holdings and value follow the chain before classification. What arrived counts
// without a purchase price; what left is taken from the oldest coins held then, without a sale
// price. Neither is a deposit or a withdrawal. An outgoing transaction answered "Other" stays
// such a disposal for good.

/** One unanswered (or outgoing "Other") chain movement of a wallet in an account. */
export interface ChainMove {
  instrumentId: string;
  occurredAt: string;
  inbound: boolean;
  quantity: string;
}

/** The part of `value` that `part` of `whole` carries, rounded half up like paid shares. */
const share = (value: bigint, part: bigint, whole: bigint) =>
  (value * part * 2n + whole) / (whole * 2n);

function remainder(lot: PortfolioLot, held: bigint, kept: bigint): PortfolioLot {
  const scale = (amount: string) => formatAtoms(share(canonicalDecimalToAtoms(amount), kept, held));
  const native: NativeAmount | undefined = lot.native && {
    currency: lot.native.currency,
    amount: scale(lot.native.amount),
  };
  return {
    ...lot,
    quantity: formatAtoms(kept),
    costUsd: lot.costUsd === null ? null : scale(lot.costUsd),
    ...(native ? { native } : {}),
  };
}

/**
 * The account's lots at `at` with its chain movements up to then applied in time order. A
 * receipt and a payment at the same instant count the receipt first. A payment larger than
 * what was held then takes only what there was.
 */
export function applyChainMoves(
  lots: readonly PortfolioLot[],
  moves: readonly ChainMove[],
  at: string,
): PortfolioLot[] {
  const due = moves
    .filter((move) => move.occurredAt <= at)
    .sort(
      (left, right) =>
        (left.occurredAt < right.occurredAt ? -1 : left.occurredAt > right.occurredAt ? 1 : 0) ||
        Number(right.inbound) - Number(left.inbound),
    );
  if (due.length === 0) return [...lots];
  let held = [...lots];
  for (const move of due) {
    if (move.inbound) {
      held.push({
        instrumentId: move.instrumentId,
        quantity: move.quantity,
        costUsd: null,
        acquiredAt: move.occurredAt,
      });
      continue;
    }
    let left = canonicalDecimalToAtoms(move.quantity);
    // Oldest first, as FIFO would spend them; a stable sort keeps the engine's order on ties.
    const order = held
      .map((lot, index) => ({ lot, index }))
      .filter(
        ({ lot }) => lot.instrumentId === move.instrumentId && lot.acquiredAt <= move.occurredAt,
      )
      .sort((a, b) =>
        a.lot.acquiredAt < b.lot.acquiredAt ? -1 : a.lot.acquiredAt > b.lot.acquiredAt ? 1 : 0,
      );
    const next = [...held];
    for (const { lot, index } of order) {
      if (left === 0n) break;
      const quantity = canonicalDecimalToAtoms(lot.quantity);
      const taken = quantity < left ? quantity : left;
      left -= taken;
      next[index] = remainder(lot, quantity, quantity - taken);
    }
    held = next.filter((lot) => canonicalDecimalToAtoms(lot.quantity) > 0n);
  }
  return held;
}

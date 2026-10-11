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

/** What the account's own operations held of one instrument at one instant. */
export type JournalHeld = (instrumentId: string, at: string) => bigint;

/** Without the journal's history: what of `lots` had arrived by then. */
const heldFromLots =
  (lots: readonly PortfolioLot[]): JournalHeld =>
  (instrumentId, at) =>
    lots
      .filter((lot) => lot.instrumentId === instrumentId && lot.acquiredAt <= at)
      .reduce((sum, lot) => sum + canonicalDecimalToAtoms(lot.quantity), 0n);

/**
 * The account's lots at `at` with its chain movements up to then applied in time order. A
 * receipt and a payment at the same instant count the receipt first. A payment larger than
 * what was held then takes only what there was.
 *
 * A payment takes the oldest coins that had arrived by then. When a later sale by hand already
 * spent those (FIFO gives it the oldest coins too), the coins the wallet held then are counted
 * with `journalHeld`, and what the payment could not find among them comes out of the coins
 * left at the end, oldest first, so holdings still match the wallet.
 */
export function applyChainMoves(
  lots: readonly PortfolioLot[],
  moves: readonly ChainMove[],
  at: string,
  journalHeld: JournalHeld = heldFromLots(lots),
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
  // Per instrument: what the chain movements so far added (+) or took (-), and what payments
  // still owe because the coins they took were no longer among the lots.
  const chain = new Map<string, bigint>();
  const owed = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, id: string, units: bigint) =>
    map.set(id, (map.get(id) ?? 0n) + units);
  for (const move of due) {
    if (move.inbound) {
      held.push({
        instrumentId: move.instrumentId,
        quantity: move.quantity,
        costUsd: null,
        acquiredAt: move.occurredAt,
      });
      add(chain, move.instrumentId, canonicalDecimalToAtoms(move.quantity));
      continue;
    }
    const wanted = canonicalDecimalToAtoms(move.quantity);
    const order = oldestFirst(held, move.instrumentId, move.occurredAt);
    const found = order.reduce((sum, { lot }) => sum + canonicalDecimalToAtoms(lot.quantity), 0n);
    let paid = wanted;
    if (found < wanted) {
      const then =
        journalHeld(move.instrumentId, move.occurredAt) + (chain.get(move.instrumentId) ?? 0n);
      paid = then < wanted ? (then > found ? then : found) : wanted;
    }
    held = take(held, order, paid < found ? paid : found);
    if (paid > found) add(owed, move.instrumentId, paid - found);
    add(chain, move.instrumentId, -paid);
  }
  for (const [instrumentId, units] of owed) {
    held = take(held, oldestFirst(held, instrumentId), units);
  }
  return held;
}

/** The instrument's lots that had arrived by `by`, oldest first, as FIFO would spend them. */
function oldestFirst(held: readonly PortfolioLot[], instrumentId: string, by?: string) {
  // A stable sort keeps the engine's order on ties.
  return held
    .map((lot, index) => ({ lot, index }))
    .filter(
      ({ lot }) => lot.instrumentId === instrumentId && (by === undefined || lot.acquiredAt <= by),
    )
    .sort((a, b) =>
      a.lot.acquiredAt < b.lot.acquiredAt ? -1 : a.lot.acquiredAt > b.lot.acquiredAt ? 1 : 0,
    );
}

/** `held` with `units` taken from the lots in `order`, emptied lots dropped. */
function take(
  held: readonly PortfolioLot[],
  order: readonly { lot: PortfolioLot; index: number }[],
  units: bigint,
): PortfolioLot[] {
  let left = units;
  const next = [...held];
  for (const { lot, index } of order) {
    if (left === 0n) break;
    const quantity = canonicalDecimalToAtoms(lot.quantity);
    const taken = quantity < left ? quantity : left;
    left -= taken;
    next[index] = remainder(lot, quantity, quantity - taken);
  }
  return next.filter((lot) => canonicalDecimalToAtoms(lot.quantity) > 0n);
}

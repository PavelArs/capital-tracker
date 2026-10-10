import type { Classification, PricedClassification } from './chain-classification';
import { canonicalDecimalToAtoms } from './money';
import { type SettlementCurrency, settlementCurrencies } from './trade-settlement';

// CLS-DUPLICATE: a record the owner added by hand or from CSV and the blockchain transaction
// that is the same movement in the same account. The wallet's record is the one to keep: it has
// the exact time, amount and hash. The owner's record only carries what the chain cannot know,
// the price or the purpose, and that moves over to the transaction's answer.

/** How far apart in time a record and a transaction can be and still be the same movement. */
export const DUPLICATE_WINDOW_HOURS = 48;
/** The most the two amounts may differ by, in percent of the transaction's amount. */
export const DUPLICATE_AMOUNT_PERCENT = 1n;

/** What a transaction or a record says about one movement of one coin in one account. */
export interface Movement {
  accountId: string;
  /** The coin by symbol in upper case. */
  coin: string;
  inbound: boolean;
  /** The amount in accounting atoms, never negative. */
  atoms: bigint;
  at: Date;
}

/** Whether a record and a transaction can be one movement: the same coin, way and account. */
export function duplicateFits(leg: Movement, record: Movement): boolean {
  if (leg.accountId !== record.accountId || leg.coin !== record.coin) return false;
  if (leg.inbound !== record.inbound || leg.atoms <= 0n || record.atoms <= 0n) return false;
  if (Math.abs(leg.at.getTime() - record.at.getTime()) > DUPLICATE_WINDOW_HOURS * 3_600_000)
    return false;
  const gap = leg.atoms > record.atoms ? leg.atoms - record.atoms : record.atoms - leg.atoms;
  return gap * 100n <= leg.atoms * DUPLICATE_AMOUNT_PERCENT;
}

/**
 * CLS-DUPLICATE: the unanswered transactions that are each the single closest match of one
 * record, and the other way round. The closest is the one whose amount differs least, then the
 * one nearest in time; a tie or a second equally close candidate leaves both to the owner
 * (nothing is guessed). Newest transaction first.
 */
export function proposeDuplicates<L extends Movement, R extends Movement>(
  legs: readonly L[],
  records: readonly R[],
): { leg: L; record: R }[] {
  type Edge = { leg: L; record: R; amount: bigint; time: number };
  const edges: Edge[] = [];
  const groups = new Map<string, R[]>();
  for (const record of records) {
    const key = `${record.accountId}|${record.coin}|${record.inbound}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const leg of legs)
    for (const record of groups.get(`${leg.accountId}|${leg.coin}|${leg.inbound}`) ?? [])
      if (duplicateFits(leg, record))
        edges.push({
          leg,
          record,
          amount: leg.atoms > record.atoms ? leg.atoms - record.atoms : record.atoms - leg.atoms,
          time: Math.abs(leg.at.getTime() - record.at.getTime()),
        });
  const closer = (left: Edge, right: Edge) =>
    left.amount !== right.amount ? (left.amount < right.amount ? -1 : 1) : left.time - right.time;
  const alike = (left: Edge, right: Edge) =>
    left.amount === right.amount && left.time === right.time;
  const bestOf = <K extends 'leg' | 'record'>(side: K) => {
    const grouped = new Map<Edge[K], Edge[]>();
    for (const edge of edges) grouped.set(edge[side], [...(grouped.get(edge[side]) ?? []), edge]);
    const best = new Map<Edge[K], Edge>();
    for (const [item, mine] of grouped) {
      const sorted = mine.sort(closer);
      if (sorted.length < 2 || !alike(sorted[0], sorted[1])) best.set(item, sorted[0]);
    }
    return best;
  };
  const ofLeg = bestOf('leg');
  const ofRecord = bestOf('record');
  return edges
    .filter((edge) => ofLeg.get(edge.leg) === edge && ofRecord.get(edge.record) === edge)
    .sort((left, right) => right.leg.at.getTime() - left.leg.at.getTime())
    .map(({ leg, record }) => ({ leg, record }));
}

/** A trade of the owner's as far as the answer to a transaction is concerned. */
export interface TradeRecord {
  side: 'buy' | 'sell';
  grossUsd: string;
  feeUsd: string;
  /** Stated in RUB or EUR as paid. */
  paid?: { currency: string; gross: string; fee: string; perUsd: string };
  /** The cash asset the trade was settled in; none means it was stated in USD. */
  settlementSymbol?: string | null;
  purpose?: 'income' | 'expense' | 'gift-received' | 'gift-sent' | 'fee';
}

/** A reward of the owner's, likewise. */
export interface RewardRecord {
  category: 'staking' | 'airdrop' | 'other' | 'unclassified';
  acquisitionBasisUsd: string | null;
  incomeValueUsd: string | null;
}

const zero = (amount: string) => canonicalDecimalToAtoms(amount) === 0n;
const sameAmount = (left: string | null, right: string | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    canonicalDecimalToAtoms(left) === canonicalDecimalToAtoms(right));

/**
 * The answer to a transaction that says what the owner's trade said: the same amounts, the same
 * currency, the same purpose. Null when the trade has something a transaction's answer cannot
 * say, such as a fee beside an income; such a record is never offered.
 */
export function tradeAnswer(trade: TradeRecord): Classification | null {
  switch (trade.purpose) {
    case 'income':
    case 'expense':
    case 'gift-received':
    case 'gift-sent': {
      if (!zero(trade.feeUsd)) return null;
      const type =
        trade.purpose === 'income' || trade.purpose === 'expense' ? trade.purpose : 'gift';
      return { type, valueUsd: trade.grossUsd };
    }
    case 'fee':
      return sameAmount(trade.grossUsd, trade.feeUsd)
        ? { type: 'fee', valueUsd: trade.feeUsd }
        : null;
    default: {
      const currency = trade.paid?.currency ?? trade.settlementSymbol ?? 'USD';
      const known = settlementCurrencies.find((code) => code === currency);
      if (known === undefined) return null;
      const answer: PricedClassification = {
        type: trade.side,
        currency: known as SettlementCurrency,
        amount: trade.paid?.gross ?? trade.grossUsd,
      };
      const fee = trade.paid?.fee ?? trade.feeUsd;
      if (!zero(fee)) answer.fee = fee;
      if (trade.paid) answer.perUsd = trade.paid.perUsd;
      return answer;
    }
  }
}

/** The answer a reward stands for; null when its basis and its income value disagree. */
export function rewardAnswer(reward: RewardRecord): Classification | null {
  if (reward.category === 'unclassified')
    return reward.acquisitionBasisUsd === null && reward.incomeValueUsd === null
      ? { type: 'other' }
      : null;
  if (!sameAmount(reward.acquisitionBasisUsd, reward.incomeValueUsd)) return null;
  const type =
    reward.category === 'staking'
      ? 'staking-reward'
      : reward.category === 'airdrop'
        ? 'airdrop'
        : 'reward';
  return { type, valueUsd: reward.incomeValueUsd };
}

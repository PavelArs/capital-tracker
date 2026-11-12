import { REWARD_LIMITS } from '../accounting/asset-reward.store';
import { CAPITAL_RETURN_LIMITS } from '../accounting/capital-return.store';
import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import { moscowDate } from '../fx-rates/fx-conversion';
import type { TBankOperation } from './tbank-client';
import { type OperationKind, operationKind } from './tbank-operation-kinds';

// BROKER-SYNC: what a T-Bank account's executed operations would become in the owner's records,
// before anything is written. A trade's broker fee joins its trade; money paid in or out is
// cash bought or sold from outside; dividends and coupons are rewards, not money put in; a bond
// paid back in part is a return of capital that lowers what its units cost; taxes and fees not tied
// to a trade only lower the return. Nothing here reads or writes the database.

/** Trades the app keeps active in one account (accounting/fifo.ts MAX_ACTIVE_TRADES). */
export const ACCOUNT_TRADE_LIMIT = 1000;
// Room left for the operations still to come before operations are combined.
const COMBINE_ABOVE = 900;

export type PlanAction =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'income'
  | 'return'
  | 'fee'
  | 'tax';

/** One journal entry the import would write. */
export interface PlanEntry {
  /**
   * A trade (buy or sell, a fee or tax spent from cash), a reward (income) or a capital return
   * (part of a bond's cost paid back as cash).
   */
  record: 'trade' | 'reward' | 'capital-return';
  action: PlanAction;
  /** When it happened: a trade's last fill, else the operation's own time; the latest of a group. */
  occurredAt: string;
  /** The T-Bank instrument traded; '' for money paid in, out, spent or received. */
  instrumentUid: string;
  ticker: string;
  instrumentType: string;
  /**
   * For dollars or euros bought or sold on the exchange: the currency the trade moves as cash,
   * paid for in `currency`. Such a trade holds no security.
   */
  cash?: 'usd' | 'eur';
  /** Securities sold to the owner's card, outside broker cash. */
  externalCash?: true;
  /**
   * For a reward, the T-Bank instrument that paid it; the reward itself is cash. A capital
   * return names the instrument whose cost it lowers in `instrumentUid` instead.
   */
  paidBy?: { instrumentUid: string; ticker: string; instrumentType: string };
  /** Units of the security, or the cash amount when the entry moves only cash. */
  quantity: string;
  /** What was paid or received in `currency`, before the fee; positive. */
  amount: string;
  fee: string;
  /** T-Bank's lower-case currency code, such as rub. */
  currency: string;
  /** Every T-Bank operation this entry stands for. */
  operationIds: string[];
}

export interface PlanSkip {
  operationId: string;
  type: string;
  reason:
    | 'unsupported'
    | 'transfer'
    | 'currency'
    | 'currency-exchange'
    | 'no-instrument'
    | 'sign'
    | 'not-held'
    | 'short-cover'
    | 'no-quantity'
    | 'fills'
    | 'card'
    | 'outside-dividend'
    | 'no-payment'
    | 'no-amount';
}

export interface ImportPlan {
  /** How far operations were combined to fit the account's trade limit. */
  grouping: 'operation' | 'day' | 'month';
  entries: PlanEntry[];
  skipped: PlanSkip[];
  trades: number;
  rewards: number;
  capitalReturns: number;
  /** False when the account's trades exceed the limit even combined by month. */
  fitsTradeLimit: boolean;
  /** False when the account's rewards exceed what the reward journal keeps; never combined. */
  fitsRewardLimit: boolean;
  /** False when the account's capital returns exceed what that journal keeps; never combined. */
  fitsCapitalReturnLimit: boolean;
  /** Cash T-Bank reports below what its listed history leaves, paid out by the entries here. */
  cashGaps: CashGap[];
}

/** Cash in one currency that left without an operation T-Bank lists, and when it is dated. */
export interface CashGap {
  /** T-Bank's lower-case currency code, such as rub. */
  currency: string;
  amount: string;
  occurredAt: string;
}

const atoms = (value: string) =>
  value.startsWith('-') ? -canonicalDecimalToAtoms(value.slice(1)) : canonicalDecimalToAtoms(value);
const absolute = (value: string) => (value.startsWith('-') ? value.slice(1) : value);
const sum = (values: string[]) =>
  formatAtoms(values.reduce((total, value) => total + atoms(value), 0n));
const isZero = (value: string) => value === '' || atoms(value) === 0n;
/** A count T-Bank gives as zero or less moved nothing the app can record. */
const notPositive = (value: string) => isZero(value) || value.startsWith('-');
/** The currencies the app keeps money in (USD, EUR and RUB), as T-Bank names them. */
const recordable = (currency: string) => ['rub', 'usd', 'eur'].includes(currency);
/** Money each kind moves: a buy pays, a sale receives; a tax or fee can be given back. */
const expectedSign: Partial<Record<ReturnType<typeof operationKind>, 'in' | 'out'>> = {
  buy: 'out',
  sell: 'in',
  repayment: 'in',
  income: 'in',
  deposit: 'in',
  withdrawal: 'out',
};
/**
 * Sales and dividends T-Bank settles through a card: their money never passes through the
 * broker account's cash, and whether T-Bank lists that money elsewhere is not known. A buy paid
 * by card is not here: T-Bank lists the card's money as paid in (INPUT) a moment before it, so
 * it is paid from the account's cash like any buy.
 */
const cardSettled = new Set(['OPERATION_TYPE_SELL_CARD', 'OPERATION_TYPE_DIV_EXT']);
const signOf = (payment: string) => (payment.startsWith('-') ? 'out' : 'in');
/**
 * Dollars and euros as the Moscow Exchange trades them against rubles, settled the next day or
 * the same day. The app keeps these as cash; any other currency or metal on the exchange (pounds,
 * gold) stays an asset priced by hand. Matched by ticker, since T-Bank's operations name no ISO
 * code and its instrument lookup no longer finds some delisted ones.
 */
const exchangeCash: Readonly<Record<string, 'usd' | 'eur'>> = {
  USD000UTSTOM: 'usd',
  USD000000TOD: 'usd',
  EUR_RUB__TOM: 'eur',
  EUR_RUB__TOD: 'eur',
};
/** The currency a dollar or euro trade on the exchange moves as cash, if it is one. */
export const cashOf = (item: TBankOperation) =>
  item.instrumentType === 'currency' ? exchangeCash[item.ticker] : undefined;
/**
 * Why a trade's security cannot be recorded: T-Bank names no instrument or does not say what
 * kind it is, or it buys dollars or euros with the very currency it buys.
 */
const securityProblem = (item: TBankOperation): PlanSkip['reason'] | null =>
  item.instrumentUid === '' || item.instrumentType === ''
    ? 'no-instrument'
    : cashOf(item) === item.paymentCurrency
      ? 'currency-exchange'
      : null;

interface TradePart {
  occurredAt: string;
  quantity: bigint;
  /** What the part's fills cost at their own prices; its share of the amount and fee. */
  weight: bigint;
}

/**
 * An order's fills as one part per fill time, so nothing another operation did between two
 * fills moves across them. Each part takes its share of the amount by its fills' own prices.
 * Without fills the order is one part at its own time. Null when the fills do not account for
 * the order: a fill moves no units or fewer, they miss part of its quantity, fills at two or
 * more times lack a price above zero or differ in price currency, so their dates or shares
 * would be guessed, or a part's share of the amount is less than its smallest unit.
 */
function tradeParts(operation: TBankOperation): TradePart[] | null {
  const whole = atoms(operation.quantity);
  if (operation.fills.length === 0)
    return [{ occurredAt: operation.occurredAt, quantity: whole, weight: whole }];
  const times = new Map<string, TradePart>();
  const priced = operation.fills.every(
    (fill) => !notPositive(fill.price) && fill.priceCurrency === operation.fills[0].priceCurrency,
  );
  let filled = 0n;
  for (const fill of operation.fills) {
    const quantity = atoms(fill.quantity);
    const weight = priced ? atoms(fill.price) * quantity : quantity;
    filled += quantity;
    const part = times.get(timeKey(fill.filledAt));
    if (part) {
      part.quantity += quantity;
      part.weight += weight;
    } else times.set(timeKey(fill.filledAt), { occurredAt: fill.filledAt, quantity, weight });
  }
  const counted = operation.fills.every((fill) => !notPositive(fill.quantity));
  if (!counted || filled !== whole || (times.size > 1 && !priced)) return null;
  const parts = [...times.values()].sort((a, b) =>
    timeKey(a.occurredAt).localeCompare(timeKey(b.occurredAt)),
  );
  // A part too small to cost even the smallest unit would be a lot bought for nothing.
  const amounts = split(
    absolute(operation.payment),
    parts.map((part) => part.weight),
  );
  return amounts.some(isZero) ? null : parts;
}

/**
 * A positive amount split by weight in its own smallest unit (a cent at least); the last part
 * takes what rounding leaves, so the parts add up to it exactly.
 */
function split(value: string, weights: bigint[]): string[] {
  const step = 10n ** BigInt(30 - Math.max(2, (value.split('.')[1] ?? '').length));
  const units = atoms(value) / step;
  const total = weights.reduce((all, weight) => all + weight, 0n);
  let left = units;
  return weights.map((weight, index) => {
    const part = index === weights.length - 1 ? left : (units * weight) / total;
    left -= part;
    return formatAtoms(part * step);
  });
}

/**
 * A T-Bank time (UTC, 0 to 9 fraction digits) as text that sorts in time order to the
 * nanosecond: `10:00:00Z` would sort after `10:00:00.5Z` as given, and a Date drops nanoseconds.
 */
export const timeKey = (time: string) => {
  const [seconds, fraction = ''] = time.replace('Z', '').split('.');
  return `${seconds}.${fraction.padEnd(9, '0')}`;
};

function entries(operations: readonly TBankOperation[], skipped: PlanSkip[]): PlanEntry[] {
  const executed = operations.filter((item) => item.state === 'executed');
  // Only a trade that becomes an entry can take its fee; a skipped one leaves the fee to cash.
  const tradeCurrency = new Map(
    executed
      .filter(
        (item) =>
          ['buy', 'sell'].includes(operationKind(item.type)) &&
          !cardSettled.has(item.type) &&
          recordable(item.paymentCurrency) &&
          signOf(item.payment) === expectedSign[operationKind(item.type)] &&
          securityProblem(item) === null &&
          !isZero(item.payment) &&
          !notPositive(item.quantity) &&
          tradeParts(item) !== null,
      )
      .map((item) => [item.id, item.paymentCurrency]),
  );
  // A fee paid for a listed trade in the trade's currency joins it; any other fee is spent from
  // cash, and one given back is money received.
  const joins = (item: TBankOperation) =>
    operationKind(item.type) === 'fee' &&
    signOf(item.payment) === 'out' &&
    tradeCurrency.get(item.parentId) === item.paymentCurrency;
  const feesOf = new Map<string, TBankOperation[]>();
  for (const item of executed) {
    if (!joins(item)) continue;
    const fees = feesOf.get(item.parentId);
    if (fees) fees.push(item);
    else feesOf.set(item.parentId, [item]);
  }
  const skip = (item: TBankOperation, reason: PlanSkip['reason']) => {
    skipped.push({ operationId: item.id, type: item.type, reason });
    return [];
  };
  const orSkip = (item: TBankOperation, result: PlanEntry[] | PlanSkip['reason']) =>
    typeof result === 'string' ? skip(item, result) : result;
  return executed.flatMap((item): PlanEntry[] => {
    const kind = operationKind(item.type);
    // The kind is the reason: an unsupported type or a transfer is listed, not recorded.
    if (kind === 'unsupported' || kind === 'transfer') return skip(item, kind);
    if (item.type === 'OPERATION_TYPE_DIV_EXT') return skip(item, 'outside-dividend');
    if (joins(item)) return [];
    const refused = paymentProblem(item, kind);
    if (refused) return skip(item, refused);
    if (kind === 'buy' || kind === 'sell')
      return orSkip(item, tradeEntries(item, kind, feesOf.get(item.id) ?? []));
    if (kind === 'repayment') return orSkip(item, repaymentEntries(item));
    return [moneyEntry(item, kind)];
  });
}

/** Why a payment cannot be recorded: there is none, its currency is not kept or its sign is off. */
function paymentProblem(item: TBankOperation, kind: OperationKind): PlanSkip['reason'] | null {
  // A trade or repayment that moved units for no money changed the holding, so it is listed;
  // only money of nothing moved nothing.
  if (isZero(item.payment))
    return kind === 'repayment' || ((kind === 'buy' || kind === 'sell') && !isZero(item.quantity))
      ? 'no-payment'
      : 'no-amount';
  if (!recordable(item.paymentCurrency)) return 'currency';
  const expected = expectedSign[kind];
  if (expected && signOf(item.payment) !== expected) return 'sign';
  return null;
}

/** Money paid in, paid out, spent or received. */
function moneyEntry(item: TBankOperation, kind: OperationKind): PlanEntry {
  const incoming = signOf(item.payment) === 'in';
  // A tax or fee given back is money received, like income.
  if (kind === 'income' || ((kind === 'tax' || kind === 'fee') && incoming))
    return reward(item, 'income');
  if (kind === 'tax' || kind === 'fee') return cash(item, 'trade', kind);
  if (kind === 'deposit') return cash(item, 'trade', 'deposit');
  return cash(item, 'trade', 'withdrawal');
}

const cash = (item: TBankOperation, record: PlanEntry['record'], action: PlanAction) => ({
  record,
  action,
  occurredAt: item.occurredAt,
  instrumentUid: '',
  ticker: '',
  instrumentType: '',
  quantity: absolute(item.payment),
  amount: absolute(item.payment),
  fee: '0',
  currency: item.paymentCurrency,
  operationIds: [item.id],
});

// A reward is cash received; it names the instrument that paid it, so dividends of two
// shares stay apart.
const reward = (item: TBankOperation, action: PlanAction): PlanEntry => ({
  ...cash(item, 'reward', action),
  paidBy: {
    instrumentUid: item.instrumentUid,
    ticker: item.ticker,
    instrumentType: item.instrumentType,
  },
});

/**
 * The fees a trade paid. T-Bank can list one fee twice: a row of the same type and amount as
 * another. Such a repeat is left out only when the commission the trade reports in its own
 * currency is exactly the total without it; any other mismatch keeps every row. The rows stay
 * its record.
 */
function chargedFees(item: TBankOperation, fees: readonly TBankOperation[]): bigint {
  const rows = atoms(absolute(sum(fees.map((fee) => fee.payment))));
  const distinct = new Map(
    fees.map((fee) => [`${fee.type} ${fee.paymentCurrency} ${fee.payment}`, fee.payment]),
  );
  const once = atoms(absolute(sum([...distinct.values()])));
  const commission =
    item.commission !== '' && item.commissionCurrency === item.paymentCurrency
      ? atoms(absolute(item.commission))
      : -1n;
  return once < rows && commission === once ? once : rows;
}

/** A buy or sale as one entry per fill time, with its fees, or why it is skipped. */
function tradeEntries(
  item: TBankOperation,
  kind: 'buy' | 'sell',
  fees: readonly TBankOperation[],
): PlanEntry[] | PlanSkip['reason'] {
  const security = securityProblem(item);
  if (security) return security;
  if (notPositive(item.quantity)) return 'no-quantity';
  const parts = tradeParts(item);
  if (!parts) return 'fills';
  const weights = parts.map((part) => part.weight);
  const amounts = split(absolute(item.payment), weights);
  const paidFees = split(formatAtoms(chargedFees(item, fees)), weights);
  const moved = cashOf(item);
  return parts.map((part, index) => ({
    record: 'trade',
    action: kind,
    occurredAt: part.occurredAt,
    instrumentUid: item.instrumentUid,
    ticker: item.ticker,
    instrumentType: item.instrumentType,
    ...(moved ? { cash: moved } : {}),
    ...(cardSettled.has(item.type) ? { externalCash: true as const } : {}),
    quantity: formatAtoms(part.quantity),
    amount: amounts[index],
    fee: paidFees[index],
    currency: item.paymentCurrency,
    // A later part of one order names it as `<id>#<n>`, so each entry is written once.
    operationIds:
      index === 0 ? [item.id, ...fees.map((fee) => fee.id)] : [`${item.id}#${index + 1}`],
  }));
}

/** A bond paid back in full or in part, or why it is skipped. */
function repaymentEntries(item: TBankOperation): PlanEntry[] | PlanSkip['reason'] {
  const security = securityProblem(item);
  if (security) return security;
  if (item.quantity.startsWith('-')) return 'no-quantity';
  const bond = {
    instrumentUid: item.instrumentUid,
    ticker: item.ticker,
    instrumentType: item.instrumentType,
  };
  // A bond paid back in full leaves the account; T-Bank gives no quantity for it, so
  // checkHeld takes the units held then.
  if (item.type === 'OPERATION_TYPE_BOND_REPAYMENT_FULL') {
    return [{ ...cash(item, 'trade', 'sell'), ...bond, quantity: item.quantity }];
  }
  // One paid back in part returns principal and keeps its units: it lowers what they cost,
  // and the money is not income.
  return [{ ...cash(item, 'capital-return', 'return'), ...bond }];
}

// Within one instant, money arrives before it is spent.
// A return of capital comes before a sale of the instant, which may sell the units it lowers.
const actionOrder: PlanAction[] = [
  'deposit',
  'income',
  'return',
  'sell',
  'buy',
  'fee',
  'tax',
  'withdrawal',
];

/**
 * Trades of one action, instrument and currency in one period, as one entry. Rewards do not
 * count toward the trade limit and stay apart. A buy and a sale of one share are never combined
 * across each other: a sale between buys starts a new run. A combined entry that brings money in
 * (a deposit, a sale) is dated by its first part and one that spends money by its last, so the
 * account never holds less cash or fewer shares at any time than it really did.
 */
function combine(
  list: PlanEntry[],
  period: (time: string) => string,
  hoist: boolean,
  splits: readonly PlanSplit[],
): PlanEntry[] {
  // Units before and after a split of a security differ, so they never share an entry.
  const epoch = (entry: PlanEntry) =>
    splits.filter(
      (split) =>
        split.uid === entry.instrumentUid &&
        timeKey(split.effectiveAt) <= timeKey(entry.occurredAt),
    ).length;
  const groups = new Map<string, PlanEntry[]>();
  const runs = new Map<string, { action: PlanAction; run: number }>();
  const kept: PlanEntry[] = [];
  for (const entry of ordered(list, hoist)) {
    // Dollars and euros bought are cash a later trade may spend, so each keeps its own time.
    if (entry.record !== 'trade' || entry.cash) {
      kept.push(entry);
      // A return lowers the cost of the units held at its own time, so trades of that bond
      // before it and after it are never combined across it.
      if (entry.record === 'capital-return') {
        const previous = runs.get(entry.instrumentUid);
        runs.set(entry.instrumentUid, { action: 'return', run: (previous?.run ?? 0) + 1 });
      }
      continue;
    }
    const run = nextRun(runs, entry);
    const key = [
      entry.action,
      entry.instrumentUid,
      entry.currency,
      entry.externalCash ? 'card' : 'broker',
      period(entry.occurredAt),
      epoch(entry),
      run,
    ].join('|');
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const combined = [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const times = group.map((entry) => entry.occurredAt);
    const first = group[0].action === 'deposit' || group[0].action === 'sell';
    return {
      ...group[0],
      occurredAt: first ? times[0] : times[times.length - 1],
      quantity: sum(group.map((entry) => entry.quantity)),
      amount: sum(group.map((entry) => entry.amount)),
      fee: sum(group.map((entry) => entry.fee)),
      operationIds: group.flatMap((entry) => entry.operationIds),
    };
  });
  return [...kept, ...combined];
}

/** The run of one instrument's trades a trade belongs to: a change of action starts the next. */
function nextRun(runs: Map<string, { action: PlanAction; run: number }>, entry: PlanEntry) {
  if (!entry.instrumentUid) return 0;
  const previous = runs.get(entry.instrumentUid);
  const run = previous?.action === entry.action ? previous.run : (previous?.run ?? 0) + 1;
  runs.set(entry.instrumentUid, { action: entry.action, run });
  return run;
}

/**
 * Walks each security's units in time order. A sale of more than the history holds then (the
 * units came in some way it does not show, or it opened a short) is listed as skipped rather
 * than sold from nothing, and so are the buys that may cover it, up to the units it sold.
 * A bond paid back in full sells every unit held then: payouts for bond repayment carry no
 * instrument quantity (T-Bank investAPI docs, operations_problems); one the history never shows
 * held is listed as skipped. A sale with no quantity can only be such a repayment, as any other
 * trade without one is skipped before. A bond paid back in part must be held then, or there is
 * no cost for the money to lower.
 */
/** A share split by T-Bank instrument UID: from `effectiveAt` each unit held is `ratio` units. */
export interface PlanSplit {
  uid: string;
  effectiveAt: string;
  ratio: bigint;
}

function checkHeld(
  list: PlanEntry[],
  skipped: PlanSkip[],
  typeOf: ReadonlyMap<string, string>,
  hoist: boolean,
  initialHoldings: ReadonlyMap<string, bigint>,
  splits: readonly PlanSplit[],
): PlanEntry[] {
  const held = new Map(initialHoldings);
  const due = [...splits].sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  let applied = 0;
  // Units sold that the history never showed held: a buy may cover them, or may not.
  const uncovered = new Map<string, bigint>();
  const listed = new Set<string>();
  const kept: PlanEntry[] = [];
  const refuse = (entry: PlanEntry, reason: PlanSkip['reason']) => {
    // Its fee was still paid: it stays as money spent.
    if (!isZero(entry.fee)) kept.push(feeLeft(entry));
    const operationId = entry.operationIds[0].split('#')[0];
    if (listed.has(`${operationId} ${reason}`)) return;
    listed.add(`${operationId} ${reason}`);
    skipped.push({ operationId, type: typeOf.get(operationId) ?? 'unknown', reason });
  };
  for (const entry of ordered(list, hoist)) {
    applied = applySplits(held, due, applied, entry.occurredAt);
    if (!walksUnits(entry)) {
      kept.push(entry);
      continue;
    }
    const uid = entry.instrumentUid;
    const verdict = heldVerdict(entry, held.get(uid) ?? 0n, uncovered.get(uid) ?? 0n);
    if ('refused' in verdict) {
      refuse(entry, verdict.refused);
      if (verdict.uncovered !== undefined) uncovered.set(uid, verdict.uncovered);
      continue;
    }
    if (verdict.units !== undefined) held.set(uid, verdict.units);
    kept.push(verdict.kept);
  }
  return kept;
}

/** Applies the splits due by `time` from index `applied` on; returns the index after them. */
function applySplits(
  held: Map<string, bigint>,
  due: readonly PlanSplit[],
  applied: number,
  time: string,
): number {
  let next = applied;
  // A split takes effect before anything at or after its instant.
  while (next < due.length && timeKey(due[next].effectiveAt) <= timeKey(time)) {
    const split = due[next++];
    const units = held.get(split.uid);
    if (units !== undefined) held.set(split.uid, units * split.ratio);
  }
  return next;
}

/**
 * Whether checkHeld walks the units an entry moves: a security's trade or capital return.
 * Dollars and euros are cash: the journal's own check finds a sale of more than is held.
 */
const walksUnits = (entry: PlanEntry) =>
  (entry.record === 'trade' || entry.record === 'capital-return') &&
  entry.instrumentUid !== '' &&
  !entry.cash;

/** A refused trade's fee, which was still paid, as money spent. */
const feeLeft = (entry: PlanEntry): PlanEntry => ({
  ...entry,
  action: 'fee',
  instrumentUid: '',
  ticker: '',
  instrumentType: '',
  quantity: entry.fee,
  amount: entry.fee,
  fee: '0',
  operationIds: entry.operationIds.length > 1 ? entry.operationIds.slice(1) : entry.operationIds,
});

/**
 * What the units held say of a security's entry: kept, with the units then held, or refused,
 * with the units then sold but never shown held.
 */
function heldVerdict(
  entry: PlanEntry,
  units: bigint,
  open: bigint,
): { kept: PlanEntry; units?: bigint } | { refused: PlanSkip['reason']; uncovered?: bigint } {
  // Money returned on units the history never shows held has no cost to lower.
  if (entry.record === 'capital-return')
    return units <= 0n ? { refused: 'not-held' } : { kept: entry };
  let quantity = entry.quantity;
  if (entry.action === 'sell' && isZero(quantity)) {
    if (units <= 0n) return { refused: 'no-quantity' };
    quantity = formatAtoms(units);
  }
  const moved = atoms(quantity);
  if (entry.action === 'sell' && moved > units)
    return { refused: 'not-held', uncovered: open + moved };
  // Whether this buy closes a short or starts a holding is unknown, so it is not guessed.
  if (entry.action === 'buy' && open > 0n)
    return { refused: 'short-cover', uncovered: open > moved ? open - moved : 0n };
  return {
    kept: quantity === entry.quantity ? entry : { ...entry, quantity },
    units: units + (entry.action === 'buy' ? moved : -moved),
  };
}

/** T-Bank operation numbers in numeric order: 9 before 10. */
const byNumber = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/**
 * Where an entry falls among the entries of one instant. Dollars and euros bought come after
 * the securities sold, which may have paid for them, and before the securities bought with them
 * and the dollars or euros sold, so the cash is there when it is spent.
 */
const sameInstantRank = (entry: PlanEntry) => {
  if (!entry.cash) return actionOrder.indexOf(entry.action);
  return actionOrder.indexOf('sell') + (entry.action === 'buy' ? 0.5 : 0.75);
};
// Without hoisting, the operations of one instant keep T-Bank's own order, which the ranks only
// guess at: a sale, a buy and a sale of one share in that order is valid, while the ranks put both
// sales first.
const ordered = (list: PlanEntry[], hoist: boolean) =>
  buysFirst(
    [...list].sort(
      (a, b) =>
        timeKey(a.occurredAt).localeCompare(timeKey(b.occurredAt)) ||
        (hoist ? sameInstantRank(a) - sameInstantRank(b) : 0) ||
        byNumber(a.operationIds[0], b.operationIds[0]),
    ),
    hoist,
  );

/**
 * Within one instant, money arrives before it is spent, except that a buy of a security goes
 * before a sale of the same security at that instant: the order of the two is unknown, and the
 * sale may sell what the buy brought.
 */
function buysFirst(sorted: PlanEntry[], hoist: boolean): PlanEntry[] {
  if (!hoist) return sorted;
  const result: PlanEntry[] = [];
  for (let start = 0; start < sorted.length; ) {
    const time = timeKey(sorted[start].occurredAt);
    let end = start;
    while (end < sorted.length && timeKey(sorted[end].occurredAt) === time) end += 1;
    placeInstant(result, sorted.slice(start, end));
    start = end;
  }
  return result;
}

const isSecurity = (entry: PlanEntry, action: PlanAction) =>
  entry.record === 'trade' && entry.action === action && entry.instrumentUid !== '' && !entry.cash;

// The currency a producer spends, and the currency an unplaced entry of an instant still
// brings in.
const spent = (entry: PlanEntry) => (entry.action === 'buy' ? entry.currency : entry.cash);
const brought = (entry: PlanEntry) => (entry.action === 'sell' ? entry.currency : entry.cash);

/** Each security's buys at one instant, by its instrument UID, in their order. */
function securityBuys(instant: readonly PlanEntry[]): Map<string, PlanEntry[]> {
  const buys = new Map<string, PlanEntry[]>();
  for (const entry of instant) {
    if (!isSecurity(entry, 'buy')) continue;
    const list = buys.get(entry.instrumentUid);
    if (list) list.push(entry);
    else buys.set(entry.instrumentUid, [entry]);
  }
  return buys;
}

/** The entries of one instant in buysFirst order, appended to `result`. */
function placeInstant(result: PlanEntry[], instant: readonly PlanEntry[]) {
  // Each security's buys at this instant, placed together before its first sale.
  const buys = securityBuys(instant);
  const placed = new Set<PlanEntry>();
  const place = (entry: PlanEntry) => {
    result.push(entry);
    placed.add(entry);
  };
  // Dollars or euros bought, or dollars or euros sold for rubles, that pay for a buy at this
  // instant come before it, so the buy never spends cash not yet there.
  const producers = (buy: PlanEntry) =>
    instant.filter(
      (entry) =>
        entry.cash !== undefined &&
        !placed.has(entry) &&
        ((entry.action === 'buy' && entry.cash === buy.currency) ||
          (entry.action === 'sell' && entry.currency === buy.currency)),
    );
  // A producer is pulled ahead only when no entry that brings in what it spends is still to
  // come, since that entry (a sale, or the exchange purchase of the currency it spends) may pay
  // for it.
  const stillToCome = (currency: string | undefined, except: PlanEntry) =>
    currency !== undefined &&
    instant.some((entry) => entry !== except && !placed.has(entry) && brought(entry) === currency);
  const placeBuysOf = (uid: string) => {
    for (const buy of buys.get(uid) ?? []) {
      const cash = producers(buy);
      // Left in place: the buy is placed by its own turn in the instant, after what funds it.
      if (cash.some((producer) => stillToCome(spent(producer), producer))) continue;
      for (const producer of cash) place(producer);
      place(buy);
    }
    buys.delete(uid);
  };
  for (const entry of instant) {
    if (placed.has(entry)) continue;
    if (isSecurity(entry, 'sell')) placeBuysOf(entry.instrumentUid);
    place(entry);
  }
}

/** The cash an entry moves, by T-Bank currency code, as tbank-import-entries records it. */
function cashMoves(entry: PlanEntry): [string, bigint][] {
  const amount = atoms(entry.amount);
  if (entry.record !== 'trade' || entry.action === 'deposit') return [[entry.currency, amount]];
  if (entry.action !== 'buy' && entry.action !== 'sell') return [[entry.currency, -amount]];
  const fee = atoms(entry.fee);
  const moves: [string, bigint][] = entry.externalCash
    ? []
    : [[entry.currency, entry.action === 'buy' ? -(amount + fee) : amount - fee]];
  if (entry.cash)
    moves.push([entry.cash, (entry.action === 'buy' ? 1n : -1n) * atoms(entry.quantity)]);
  return moves;
}

/**
 * The time of the last entry of the earliest instant from which the history always holds `gap`
 * of `currency`, or null when it never does.
 */
function gapInstant(
  list: PlanEntry[],
  currency: string,
  gap: bigint,
  opening: bigint,
): string | null {
  let balance = opening;
  const after = list.map((entry) => {
    for (const [code, delta] of cashMoves(entry)) if (code === currency) balance += delta;
    return balance;
  });
  let at: string | null = null;
  let lowest = balance;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (after[index] < lowest) lowest = after[index];
    if (lowest < gap) break;
    const time = timeKey(list[index].occurredAt);
    // Only after the last entry of an instant, so it never splits one.
    if (index === list.length - 1 || timeKey(list[index + 1].occurredAt) !== time)
      at = list[index].occurredAt;
  }
  return at;
}

/**
 * BROKER-CASH-GAP: cash that left without an operation T-Bank lists, paid out as money paid out
 * just after the earliest instant from which the history always holds it. Earlier, the history
 * holds less, so the money cannot have left by then as one payment, and dating it so never shows
 * more cash than the account held. A gap the history never holds is not placed.
 */
function cashGapEntries(
  list: PlanEntry[],
  gaps: ReadonlyMap<string, string>,
  initialHoldings: ReadonlyMap<string, bigint>,
): { entries: PlanEntry[]; gaps: CashGap[] } {
  const entries: PlanEntry[] = [];
  const placed: CashGap[] = [];
  for (const [currency, amount] of gaps) {
    const at = gapInstant(
      list,
      currency,
      atoms(amount),
      initialHoldings.get(`cash:${currency.toUpperCase()}`) ?? 0n,
    );
    if (at === null) continue;
    const occurredAt = new Date(Date.parse(at) + 1).toISOString();
    placed.push({ currency, amount, occurredAt });
    entries.push({
      record: 'trade',
      action: 'withdrawal',
      occurredAt,
      instrumentUid: '',
      ticker: '',
      instrumentType: '',
      quantity: amount,
      amount,
      fee: '0',
      currency,
      operationIds: [`cash-gap:${currency.toUpperCase()}`],
    });
  }
  return { entries, gaps: placed };
}

/**
 * The entries one account's operations would become. Each operation stays its own entry while
 * the account's trades leave room under the limit; otherwise entries of one kind and instrument
 * are combined by Moscow day, then by month.
 */
export function planImport(
  operations: readonly TBankOperation[],
  options: {
    hoist?: boolean;
    initialHoldings?: ReadonlyMap<string, bigint>;
    splits?: readonly PlanSplit[];
    /** By lower-case currency code: cash the history leaves above what T-Bank reports. */
    cashGaps?: ReadonlyMap<string, string>;
  } = {},
): ImportPlan {
  const hoist = options.hoist ?? true;
  const skipped: PlanSkip[] = [];
  const typeOf = new Map(operations.map((item) => [item.id, item.type]));
  const single = checkHeld(
    entries(operations, skipped),
    skipped,
    typeOf,
    hoist,
    options.initialHoldings ?? new Map(),
    options.splits ?? [],
  );
  const tradesIn = (list: PlanEntry[]) => list.filter((entry) => entry.record === 'trade').length;
  let grouping: ImportPlan['grouping'] = 'operation';
  let list = single;
  if (tradesIn(list) > COMBINE_ABOVE) {
    grouping = 'day';
    list = combine(single, moscowDate, hoist, options.splits ?? []);
  }
  if (tradesIn(list) > COMBINE_ABOVE) {
    grouping = 'month';
    list = combine(single, (time) => moscowDate(time).slice(0, 7), hoist, options.splits ?? []);
  }
  const gaps = cashGapEntries(
    ordered(list, hoist),
    options.cashGaps ?? new Map(),
    options.initialHoldings ?? new Map(),
  );
  list = [...list, ...gaps.entries];
  const trades = tradesIn(list);
  const capitalReturns = list.filter((entry) => entry.record === 'capital-return').length;
  const rewards = list.length - trades - capitalReturns;
  return {
    grouping,
    entries: ordered(list, hoist),
    skipped,
    trades,
    rewards,
    capitalReturns,
    fitsTradeLimit: trades <= ACCOUNT_TRADE_LIMIT,
    fitsRewardLimit: rewards <= REWARD_LIMITS.activeRewards,
    fitsCapitalReturnLimit: capitalReturns <= CAPITAL_RETURN_LIMITS.activeReturns,
    cashGaps: gaps.gaps,
  };
}

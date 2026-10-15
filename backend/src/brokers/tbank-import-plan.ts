import { canonicalDecimalToAtoms, formatAtoms } from '../accounting/money';
import { moscowDate } from '../fx-rates/fx-conversion';
import type { TBankOperation } from './tbank-client';
import { operationKind } from './tbank-operation-kinds';

// BROKER-SYNC: what a T-Bank account's executed operations would become in the owner's records,
// before anything is written. A trade's broker fee joins its trade; money paid in or out is
// cash bought or sold from outside; dividends and coupons are rewards, not money put in; taxes
// and fees not tied to a trade only lower the return. Nothing here reads or writes the database.

/** Trades the app keeps active in one account (accounting/fifo.ts MAX_ACTIVE_TRADES). */
export const ACCOUNT_TRADE_LIMIT = 1000;
// Room left for the operations still to come before operations are combined.
const COMBINE_ABOVE = 900;

export type PlanAction = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'income' | 'fee' | 'tax';

/** One journal entry the import would write. */
export interface PlanEntry {
  /** A trade (buy or sell, a fee or tax spent from cash) or a reward (income). */
  record: 'trade' | 'reward';
  action: PlanAction;
  /** When it happened: a trade's last fill, else the operation's own time; the latest of a group. */
  occurredAt: string;
  /** The T-Bank instrument traded; '' for money paid in, out, spent or received. */
  instrumentUid: string;
  ticker: string;
  instrumentType: string;
  /** For a reward, the T-Bank instrument that paid it; the reward itself is cash. */
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
    | 'partial-repayment'
    | 'no-quantity'
    | 'fills'
    | 'card'
    | 'no-amount';
}

export interface ImportPlan {
  /** How far operations were combined to fit the account's trade limit. */
  grouping: 'operation' | 'day' | 'month';
  entries: PlanEntry[];
  skipped: PlanSkip[];
  trades: number;
  rewards: number;
  /** False when the account's trades exceed the limit even combined by month. */
  fitsTradeLimit: boolean;
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
 * Trades and dividends T-Bank settles through a card: their money never passes through the
 * broker account's cash, and whether T-Bank lists that money elsewhere is not known.
 */
const cardSettled = new Set([
  'OPERATION_TYPE_BUY_CARD',
  'OPERATION_TYPE_SELL_CARD',
  'OPERATION_TYPE_DIV_EXT',
]);
const signOf = (payment: string) => (payment.startsWith('-') ? 'out' : 'in');
/**
 * Why a trade's security cannot be recorded: T-Bank names no instrument or does not say what
 * kind it is, or it is a currency bought or sold on the exchange, which is cash rather than a
 * security the app can hold yet.
 */
const securityProblem = (item: TBankOperation): PlanSkip['reason'] | null =>
  item.instrumentUid === '' || item.instrumentType === ''
    ? 'no-instrument'
    : item.instrumentType === 'currency'
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
 * more times lack a price or differ in price currency, so their dates or shares would be
 * guessed, or a part's share of the amount is less than its smallest unit.
 */
function tradeParts(operation: TBankOperation): TradePart[] | null {
  const whole = atoms(operation.quantity);
  if (operation.fills.length === 0)
    return [{ occurredAt: operation.occurredAt, quantity: whole, weight: whole }];
  const times = new Map<string, TradePart>();
  const priced = operation.fills.every(
    (fill) => !isZero(fill.price) && fill.priceCurrency === operation.fills[0].priceCurrency,
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
  return executed.flatMap((item): PlanEntry[] => {
    const kind = operationKind(item.type);
    if (kind === 'unsupported') return skip(item, 'unsupported');
    if (kind === 'transfer') return skip(item, 'transfer');
    if (cardSettled.has(item.type)) return skip(item, 'card');
    if (joins(item)) return [];
    if (isZero(item.payment)) return skip(item, 'no-amount');
    if (!recordable(item.paymentCurrency)) return skip(item, 'currency');
    const incoming = signOf(item.payment) === 'in';
    const expected = expectedSign[kind];
    if (expected && signOf(item.payment) !== expected) return skip(item, 'sign');
    const security = securityProblem(item);
    if (kind === 'buy' || kind === 'sell') {
      if (security) return skip(item, security);
      if (notPositive(item.quantity)) return skip(item, 'no-quantity');
      const fees = feesOf.get(item.id) ?? [];
      const parts = tradeParts(item);
      if (!parts) return skip(item, 'fills');
      const weights = parts.map((part) => part.weight);
      const amounts = split(absolute(item.payment), weights);
      const paidFees = split(absolute(sum(fees.map((fee) => fee.payment))), weights);
      return parts.map((part, index) => ({
        record: 'trade',
        action: kind,
        occurredAt: part.occurredAt,
        instrumentUid: item.instrumentUid,
        ticker: item.ticker,
        instrumentType: item.instrumentType,
        quantity: formatAtoms(part.quantity),
        amount: amounts[index],
        fee: paidFees[index],
        currency: item.paymentCurrency,
        // A later part of one order names it as `<id>#<n>`, so each entry is written once.
        operationIds:
          index === 0 ? [item.id, ...fees.map((fee) => fee.id)] : [`${item.id}#${index + 1}`],
      }));
    }
    if (kind === 'repayment') {
      // A bond paid back in full leaves the account; T-Bank gives no quantity for it, so
      // checkHeld takes the units held then. One paid back in part returns principal and keeps
      // its units; the app cannot lower a lot's cost, and the money is not income, so it is
      // listed rather than shown as a gain.
      if (item.type === 'OPERATION_TYPE_BOND_REPAYMENT_FULL') {
        if (security) return skip(item, security);
        if (item.quantity.startsWith('-')) return skip(item, 'no-quantity');
        return [
          {
            ...cash(item, 'trade', 'sell'),
            instrumentUid: item.instrumentUid,
            ticker: item.ticker,
            instrumentType: item.instrumentType,
            quantity: item.quantity,
          },
        ];
      }
      return skip(item, 'partial-repayment');
    }
    // A tax or fee given back is money received, like income.
    if (kind === 'income' || ((kind === 'tax' || kind === 'fee') && incoming))
      return [reward(item, 'income')];
    if (kind === 'tax' || kind === 'fee') return [cash(item, 'trade', kind)];
    if (kind === 'deposit') return [cash(item, 'trade', 'deposit')];
    return [cash(item, 'trade', 'withdrawal')];
  });
}

// Within one instant, money arrives before it is spent.
const actionOrder: PlanAction[] = ['deposit', 'income', 'sell', 'buy', 'fee', 'tax', 'withdrawal'];

/**
 * Trades of one action, instrument and currency in one period, as one entry. Rewards do not
 * count toward the trade limit and stay apart. A buy and a sale of one share are never combined
 * across each other: a sale between buys starts a new run. A combined entry that brings money in
 * (a deposit, a sale) is dated by its first part and one that spends money by its last, so the
 * account never holds less cash or fewer shares at any time than it really did.
 */
function combine(list: PlanEntry[], period: (time: string) => string): PlanEntry[] {
  const groups = new Map<string, PlanEntry[]>();
  const runs = new Map<string, { action: PlanAction; run: number }>();
  const kept: PlanEntry[] = [];
  for (const entry of ordered(list)) {
    if (entry.record !== 'trade') {
      kept.push(entry);
      continue;
    }
    let run = 0;
    if (entry.instrumentUid) {
      const previous = runs.get(entry.instrumentUid);
      run = previous?.action === entry.action ? previous.run : (previous?.run ?? 0) + 1;
      runs.set(entry.instrumentUid, { action: entry.action, run });
    }
    const key = [
      entry.action,
      entry.instrumentUid,
      entry.currency,
      period(entry.occurredAt),
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

/**
 * Walks each security's units in time order. A sale of more than the history holds then (the
 * units came in some way it does not show) is listed as skipped rather than sold from nothing.
 * A bond paid back in full sells every unit held then: payouts for bond repayment carry no
 * instrument quantity (T-Bank investAPI docs, operations_problems); one the history never shows
 * held is listed as skipped. A sale with no quantity can only be such a repayment, as any other
 * trade without one is skipped before.
 */
function checkHeld(
  list: PlanEntry[],
  skipped: PlanSkip[],
  typeOf: ReadonlyMap<string, string>,
): PlanEntry[] {
  const held = new Map<string, bigint>();
  const kept: PlanEntry[] = [];
  for (const entry of ordered(list)) {
    if (entry.record !== 'trade' || entry.instrumentUid === '') {
      kept.push(entry);
      continue;
    }
    const units = held.get(entry.instrumentUid) ?? 0n;
    const operationId = entry.operationIds[0].split('#')[0];
    const refuse = (reason: PlanSkip['reason']) =>
      skipped.push({ operationId, type: typeOf.get(operationId) ?? 'unknown', reason });
    let quantity = entry.quantity;
    if (entry.action === 'sell' && isZero(quantity)) {
      if (units <= 0n) {
        refuse('no-quantity');
        continue;
      }
      quantity = formatAtoms(units);
    }
    if (entry.action === 'sell' && atoms(quantity) > units) {
      refuse('not-held');
      // Its fee was still paid: it stays as money spent.
      if (!isZero(entry.fee))
        kept.push({
          ...entry,
          action: 'fee',
          instrumentUid: '',
          ticker: '',
          instrumentType: '',
          quantity: entry.fee,
          amount: entry.fee,
          fee: '0',
          operationIds:
            entry.operationIds.length > 1 ? entry.operationIds.slice(1) : entry.operationIds,
        });
      continue;
    }
    held.set(
      entry.instrumentUid,
      units + (entry.action === 'buy' ? atoms(quantity) : -atoms(quantity)),
    );
    kept.push(quantity === entry.quantity ? entry : { ...entry, quantity });
  }
  return kept;
}

/** T-Bank operation numbers in numeric order: 9 before 10. */
const byNumber = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

const ordered = (list: PlanEntry[]) =>
  buysFirst(
    [...list].sort(
      (a, b) =>
        timeKey(a.occurredAt).localeCompare(timeKey(b.occurredAt)) ||
        actionOrder.indexOf(a.action) - actionOrder.indexOf(b.action) ||
        byNumber(a.operationIds[0], b.operationIds[0]),
    ),
  );

/**
 * Within one instant, money arrives before it is spent, except that a buy of a security goes
 * before a sale of the same security at that instant: the order of the two is unknown, and the
 * sale may sell what the buy brought.
 */
function buysFirst(sorted: PlanEntry[]): PlanEntry[] {
  const result: PlanEntry[] = [];
  const isSecurity = (entry: PlanEntry, action: PlanAction) =>
    entry.record === 'trade' && entry.action === action && entry.instrumentUid !== '';
  for (let start = 0; start < sorted.length; ) {
    const time = timeKey(sorted[start].occurredAt);
    let end = start;
    while (end < sorted.length && timeKey(sorted[end].occurredAt) === time) end += 1;
    const instant = sorted.slice(start, end);
    // Each security's buys at this instant, placed together before its first sale.
    const buys = new Map<string, PlanEntry[]>();
    for (const entry of instant) {
      if (!isSecurity(entry, 'buy')) continue;
      const list = buys.get(entry.instrumentUid);
      if (list) list.push(entry);
      else buys.set(entry.instrumentUid, [entry]);
    }
    const placed = new Set<PlanEntry>();
    for (const entry of instant) {
      if (placed.has(entry)) continue;
      if (isSecurity(entry, 'sell')) {
        for (const buy of buys.get(entry.instrumentUid) ?? []) {
          result.push(buy);
          placed.add(buy);
        }
        buys.delete(entry.instrumentUid);
      }
      result.push(entry);
      placed.add(entry);
    }
    start = end;
  }
  return result;
}

/**
 * The entries one account's operations would become. Each operation stays its own entry while
 * the account's trades leave room under the limit; otherwise entries of one kind and instrument
 * are combined by Moscow day, then by month.
 */
export function planImport(operations: readonly TBankOperation[]): ImportPlan {
  const skipped: PlanSkip[] = [];
  const typeOf = new Map(operations.map((item) => [item.id, item.type]));
  const single = checkHeld(entries(operations, skipped), skipped, typeOf);
  const tradesIn = (list: PlanEntry[]) => list.filter((entry) => entry.record === 'trade').length;
  let grouping: ImportPlan['grouping'] = 'operation';
  let list = single;
  if (tradesIn(list) > COMBINE_ABOVE) {
    grouping = 'day';
    list = combine(single, moscowDate);
  }
  if (tradesIn(list) > COMBINE_ABOVE) {
    grouping = 'month';
    list = combine(single, (time) => moscowDate(time).slice(0, 7));
  }
  const trades = tradesIn(list);
  return {
    grouping,
    entries: ordered(list),
    skipped,
    trades,
    rewards: list.length - trades,
    fitsTradeLimit: trades <= ACCOUNT_TRADE_LIMIT,
  };
}

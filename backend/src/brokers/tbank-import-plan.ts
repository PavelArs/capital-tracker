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

export type PlanAction =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'income'
  | 'repayment'
  | 'fee'
  | 'tax';

/** One journal entry the import would write. */
export interface PlanEntry {
  /** A trade (buy or sell, a fee or tax spent from cash) or a reward (income). */
  record: 'trade' | 'reward';
  action: PlanAction;
  /** When it happened: a trade's last fill, else the operation's own time; the latest of a group. */
  occurredAt: string;
  /** The T-Bank instrument for a security; '' when the entry moves only cash. */
  instrumentUid: string;
  ticker: string;
  instrumentType: string;
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
  reason: 'unsupported' | 'transfer' | 'currency' | 'no-quantity' | 'no-amount';
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
/** The currencies the app keeps money in (USD, EUR and RUB), as T-Bank names them. */
const recordable = (currency: string) => ['rub', 'usd', 'eur'].includes(currency);

/** When a trade happened: its last fill, else the operation's own (order) time. */
function tradeTime(operation: TBankOperation): string {
  return operation.fills.reduce(
    (latest, fill) => (timeKey(fill.filledAt) > timeKey(latest) ? fill.filledAt : latest),
    operation.occurredAt,
  );
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
          recordable(item.paymentCurrency) &&
          !isZero(item.payment) &&
          !isZero(item.quantity),
      )
      .map((item) => [item.id, item.paymentCurrency]),
  );
  // A fee joins its listed trade when paid in the trade's currency; any other fee is spent
  // from cash.
  const joins = (item: TBankOperation) =>
    operationKind(item.type) === 'fee' && tradeCurrency.get(item.parentId) === item.paymentCurrency;
  const feesOf = new Map<string, TBankOperation[]>();
  for (const item of executed)
    if (joins(item)) feesOf.set(item.parentId, [...(feesOf.get(item.parentId) ?? []), item]);
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
  return executed.flatMap((item): PlanEntry[] => {
    const kind = operationKind(item.type);
    if (kind === 'unsupported') return skip(item, 'unsupported');
    if (kind === 'transfer') return skip(item, 'transfer');
    if (joins(item)) return [];
    if (isZero(item.payment)) return skip(item, 'no-amount');
    if (!recordable(item.paymentCurrency)) return skip(item, 'currency');
    const incoming = atoms(item.payment) > 0n;
    if (kind === 'buy' || kind === 'sell') {
      if (isZero(item.quantity)) return skip(item, 'no-quantity');
      const fees = feesOf.get(item.id) ?? [];
      return [
        {
          record: 'trade',
          action: kind,
          occurredAt: tradeTime(item),
          instrumentUid: item.instrumentUid,
          ticker: item.ticker,
          instrumentType: item.instrumentType,
          quantity: item.quantity,
          amount: absolute(item.payment),
          fee: absolute(sum(fees.map((fee) => fee.payment))),
          currency: item.paymentCurrency,
          operationIds: [item.id, ...fees.map((fee) => fee.id)],
        },
      ];
    }
    if (kind === 'repayment') {
      // A bond paid back in full leaves the account; one paid back in part keeps its units, and
      // the app has no way to lower its cost, so the money is shown as income.
      if (item.type === 'OPERATION_TYPE_BOND_REPAYMENT_FULL') {
        if (isZero(item.quantity)) return skip(item, 'no-quantity');
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
      return [{ ...cash(item, 'reward', 'repayment'), ticker: item.ticker }];
    }
    // A tax or fee given back is money received, like income.
    if (kind === 'income' || ((kind === 'tax' || kind === 'fee') && incoming))
      return [{ ...cash(item, 'reward', 'income'), ticker: item.ticker }];
    if (kind === 'tax' || kind === 'fee') return [cash(item, 'trade', kind)];
    if (kind === 'deposit') return [cash(item, 'trade', 'deposit')];
    return [cash(item, 'trade', 'withdrawal')];
  });
}

// Within one instant, money arrives before it is spent.
const actionOrder: PlanAction[] = [
  'deposit',
  'income',
  'repayment',
  'sell',
  'buy',
  'fee',
  'tax',
  'withdrawal',
];

function combine(list: PlanEntry[], period: (time: string) => string): PlanEntry[] {
  const groups = new Map<string, PlanEntry[]>();
  for (const entry of list) {
    const key = [
      entry.record,
      entry.action,
      entry.instrumentUid,
      entry.currency,
      period(entry.occurredAt),
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((group) =>
    group.length === 1
      ? group[0]
      : {
          ...group[0],
          occurredAt: group
            .map((entry) => entry.occurredAt)
            .reduce((latest, time) => (timeKey(time) > timeKey(latest) ? time : latest)),
          quantity: sum(group.map((entry) => entry.quantity)),
          amount: sum(group.map((entry) => entry.amount)),
          fee: sum(group.map((entry) => entry.fee)),
          operationIds: group.flatMap((entry) => entry.operationIds),
        },
  );
}

const ordered = (list: PlanEntry[]) =>
  [...list].sort(
    (a, b) =>
      timeKey(a.occurredAt).localeCompare(timeKey(b.occurredAt)) ||
      actionOrder.indexOf(a.action) - actionOrder.indexOf(b.action) ||
      a.operationIds[0].localeCompare(b.operationIds[0]),
  );

/**
 * The entries one account's operations would become. Each operation stays its own entry while
 * the account's trades leave room under the limit; otherwise entries of one kind and instrument
 * are combined by Moscow day, then by month.
 */
export function planImport(operations: readonly TBankOperation[]): ImportPlan {
  const skipped: PlanSkip[] = [];
  const single = entries(operations, skipped);
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

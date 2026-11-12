import { accountingApi } from '@api/accounting.api';
import { assetRewardsApi } from '@api/asset-rewards.api';
import { cachedReads } from '@api/cached-reads';
import { fxRatesApi } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import { ownedTransfersApi } from '@api/owned-transfers.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { type DependentOperation, tradesApi } from '@api/trades.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Chip, ChipGroup } from '@/ui/Chip';
import { Field } from '@/ui/Field';
import { Affix, Input, Select, Textarea } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { dayText } from '@/utils/dates';
import { exactProduct, productDown } from '@/utils/decimal';
import { newRequestId } from '../accounting/feedback';
import AssetIcon from '../shell/AssetIcon';
import { hiddenTokenSymbols } from '../wallets/WalletParts';
import { unitPrice } from './add-asset';
import {
  addDecimal,
  bankRate,
  carriesComment,
  compareDecimal,
  decimal,
  type EntryKind,
  type EntryProblem,
  entryFromOperation,
  entryKind,
  isCashOf,
  isPurposeKind,
  MAX_COMMENT_LENGTH,
  marketPriceFigure,
  needsRate,
  numberProblem,
  occurredAt,
  type PaidIn,
  paidIn,
  positive,
  priceFigure,
  problems,
  purposeTradeFromEntry,
  rateDate,
  rewardFromEntry,
  spends,
  subtractDecimal,
  type TransactionEntry,
  tradeFromEntry,
  transferFromEntry,
  usdTotal,
  valued,
  valueOptional,
  withDefaultTime,
} from './add-transaction';
import ConvertForm from './ConvertForm';
import { useFocusFirstProblem } from './focus-problem';
import { money, price, quantity } from './format';
import './portfolio.css';

export interface Account {
  id: string;
  name: string;
  /** 0 for an account without a journal yet: its first trade starts one (OPS-ADD-BUY). */
  journalRevision: number;
}

const problemText: Record<EntryProblem, string> = {
  instrument: 'Choose an asset',
  amount: 'Enter an amount greater than 0',
  date: 'Choose a date, today or earlier',
  time: 'Enter the time as HH:MM',
  total: '',
  rate: 'Enter the rate you paid',
  fee: 'Enter the fee as a number',
  comment: `Keep the comment within ${MAX_COMMENT_LENGTH} characters`,
};

/**
 * The messages of a 409 that names the change itself as the first operation left short, with
 * what the change is called: a transfer, or a trade (a sale, an expense, a gift sent, a fee).
 */
const OWN_SHORTFALL: Record<string, 'transfer' | 'transaction'> = {
  'An account does not hold enough for this transfer': 'transfer',
  'An account does not hold enough for this trade': 'transaction',
};
const ownShortfall = (message: unknown) =>
  typeof message === 'string' && Object.hasOwn(OWN_SHORTFALL, message)
    ? OWN_SHORTFALL[message]
    : null;

/** The operation a 409 names as depending on the change, if the server named one. */
export function dependentOf(error: unknown): DependentOperation | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  return isAxiosError(error) &&
    error.response?.status === 409 &&
    data?.dependent &&
    ownShortfall(data.message) === null
    ? (data.dependent as DependentOperation)
    : null;
}

/** The account a new transfer or trade would leave short, when the server named it. */
export function shortOf(
  error: unknown,
): (DependentOperation & { of: 'transfer' | 'transaction' }) | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  const of = ownShortfall(data?.message);
  return isAxiosError(error) && error.response?.status === 409 && data?.dependent && of
    ? { ...(data.dependent as DependentOperation), of }
    : null;
}

/** An account whose records start after the date of the change, when the server named it. */
export function coverageOf(
  error: unknown,
): { accountId: string; coverageFrom: string | null } | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  return isAxiosError(error) && error.response?.status === 409 && data?.coverage
    ? (data.coverage as { accountId: string; coverageFrom: string | null })
    : null;
}

/** "Wallet A does not hold enough ETH on Mar 1, 2026 for this transfer." */
export const shortText = (
  account: string,
  coin: string,
  date: string,
  of: 'transfer' | 'transaction' = 'transfer',
) => `${account} does not hold enough ${coin} on ${dayText(date)} for this ${of}.`;
/**
 * The account's records start later than the transaction, so nothing can move in or out; with no
 * start date its records have not started: it was opened with balances.
 */
export const coverageText = (account: string, from: string | null, date: string) =>
  from === null
    ? `The records of ${account} have not started: it was opened with balances, so start them on Manual accounts first.`
    : `The records of ${account} start on ${dayText(from)}, after this transaction on ${dayText(date)}.`;

function failure(
  error: unknown,
  accounts: readonly Account[] | null,
  coin: string,
  date: string,
): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  const dependent = dependentOf(error);
  const name = (id: string) => accounts?.find((item) => item.id === id)?.name ?? 'The account';
  const short = shortOf(error);
  const coverage = coverageOf(error);
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not save the transaction twice.';
  if (status === 409 && message.includes('Bank of Russia rate'))
    return 'No Bank of Russia rate is stored for this date. Enter the rate you paid.';
  if (short)
    return `${shortText(name(short.accountId), coin, short.occurredAt, short.of)} Add the receipts that bring it there first.`;
  if (coverage)
    return coverage.coverageFrom === null
      ? coverageText(name(coverage.accountId), null, date)
      : `${coverageText(name(coverage.accountId), coverage.coverageFrom, date)} Choose a later date.`;
  if (dependent)
    return `A later transaction on ${dayText(dependent.occurredAt)} spends these coins, so the account would not hold enough. Change that transaction first.`;
  if (status === 409 || status === 422)
    return 'This transaction does not fit the saved history: the account may not hold that much on this date, or it was changed elsewhere. Close this window and try again.';
  if (status === 400) return 'Check the fields and try again.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not save the transaction. Try again.';
}

const today = () => new Date().toISOString().slice(0, 10);

/** The price per unit a total and an amount imply, exact before it is shown. */
const derivedPrice = (total: string, amount: string) =>
  priceFigure(Number(unitPrice(total, amount)));

/**
 * The account that holds the most of an asset now, or null when none holds any, there is only
 * one account to choose, or any account's balance cannot be read.
 */
async function holderOf(
  accounts: readonly Account[],
  instrumentId: string | undefined,
): Promise<string | null> {
  if (!instrumentId || accounts.length < 2) return null;
  const at = new Date().toISOString();
  const held = await Promise.all(
    accounts.map((account) =>
      tradesApi
        .available(account.id, { instrumentId, at })
        .then((result) => result.quantity)
        .catch(() => null),
    ),
  );
  // One unread balance may be the largest, so a partial answer suggests no account.
  if (held.includes(null)) return null;
  let holder: string | null = null;
  let most = '0';
  for (const [index, quantity] of held.entries())
    if (quantity !== null && compareDecimal(quantity, most) > 0) {
      holder = accounts[index].id;
      most = quantity;
    }
  return holder;
}

export async function journalAccounts(): Promise<Account[]> {
  const accounts = [];
  let cursor: string | undefined;
  do {
    const page = await accountingApi.listAccounts(cursor);
    accounts.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const states = await Promise.all(accounts.map((account) => tradesApi.state(account.id)));
  // An account opened with balances needs its journal started on the legacy screen first.
  return accounts.flatMap((account, index) => {
    const { journal, eligible } = states[index];
    if (!journal && !eligible) return [];
    return [{ id: account.id, name: account.name, journalRevision: journal?.journalRevision ?? 0 }];
  });
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
  /** A recorded operation to correct (OPS-EDIT); without it the window adds one. */
  editing?: Operation;
}

/** What an asset without a ticker (a property, a painting) is counted in. */
const UNITS = 'units';

/** "0.2 BTC", "2 units", and "1 unit" for exactly one of an asset without a ticker. */
const counted = (value: string, symbol: string) => {
  const shown = quantity(value);
  return `${shown} ${symbol === UNITS && shown === '1' ? 'unit' : symbol}`;
};

/** The window's types: five in view and four under More (accepted prototype). */
const mainKinds = [
  ['buy', 'Buy'],
  ['sell', 'Sell'],
  ['transfer', 'Transfer'],
  ['income', 'Income'],
  ['expense', 'Expense'],
] as const satisfies readonly (readonly [EntryKind, string])[];
const moreKinds = [
  ['reward', 'Reward'],
  ['airdrop', 'Airdrop'],
  ['gift-received', 'Gift'],
  ['fee', 'Fee'],
  ['convert', 'Convert'],
] as const satisfies readonly (readonly [EntryKind, string])[];
const giftKinds = [
  ['gift-received', 'Received'],
  ['gift-sent', 'Sent'],
] as const satisfies readonly (readonly [EntryKind, string])[];
const kindNames = new Map<EntryKind, string>([...mainKinds, ...moreKinds, ['gift-sent', 'Gift']]);
const isMoreKind = (kind: EntryKind) =>
  kind === 'reward' ||
  kind === 'airdrop' ||
  kind === 'fee' ||
  kind === 'convert' ||
  kind.startsWith('gift');
/** Which records a type is saved as: an edit keeps to the same kind of record. */
const family = (kind: EntryKind) =>
  kind === 'transfer' ? 'transfer' : kind === 'reward' || kind === 'airdrop' ? 'reward' : 'trade';
/** An edit keeps to its kind of record, and a conversion is added only (it has no edit form yet). */
const editLocked = (editing: boolean, value: EntryKind, kind: EntryKind) =>
  editing && (family(value) !== family(kind) || value === 'convert');

/** What a value means for the capital, under the Value field. */
const valueHints: Partial<Record<EntryKind, string>> = {
  income: 'Counts as money added and becomes the cost of these coins.',
  'gift-received': 'Counts as money added and becomes the cost of these coins.',
  expense: 'Counts as money taken out of your capital.',
  'gift-sent': 'Counts as money taken out of your capital.',
  fee: 'Counts as a cost: the coins leave without money coming back.',
  reward: 'Becomes the cost of these coins and counts as a gain. Leave it empty if unknown.',
  airdrop: 'Becomes the cost of these coins and counts as a gain. Leave it empty if unknown.',
};

const blankEntry = (): TransactionEntry => ({
  side: 'buy',
  instrumentId: '',
  amount: '',
  date: today(),
  time: '',
  total: '',
  currency: 'USD',
  rate: '',
  rateEdited: false,
  fee: '',
  comment: '',
});

type Availability = { key: string; quantity: string | null };
/** A coin not yet among the assets, added with the trade (prototype "Other asset"). */
type OtherAsset = { ticker: string; name: string };
const tickerPattern = /^[A-Za-z0-9.-]{1,32}$/;

const ASSET_CHIPS = 6;

/**
 * The assets by their share of the portfolio, the largest first, so the one the owner holds most
 * of is the first choice. Assets with no share keep the order they came in.
 */
export function byAllocation(
  assets: readonly PortfolioAsset[],
  allocation: ReadonlyMap<string, number>,
): PortfolioAsset[] {
  return [...assets].sort((a, b) => (allocation.get(b.id) ?? 0) - (allocation.get(a.id) ?? 0));
}

/**
 * The asset chips are for the few coins in daily use: with more than six assets the held ones
 * and the ones with a market price come first (in the order given, which is by allocation), the
 * rest sit behind "More assets", and the chosen one is always a chip.
 */
export function splitAssets(
  assets: readonly PortfolioAsset[],
  chosen: string,
  market: ReadonlyMap<string, string>,
  held: ReadonlyMap<string, number> = new Map(),
): { shown: PortfolioAsset[]; more: PortfolioAsset[] } {
  if (assets.length <= ASSET_CHIPS) return { shown: [...assets], more: [] };
  const first = (item: PortfolioAsset) => market.has(item.id) || held.has(item.id);
  const ranked = [...assets.filter(first), ...assets.filter((item) => !first(item))];
  const shown = ranked.slice(0, ASSET_CHIPS);
  const pick = assets.find((item) => item.id === chosen);
  if (pick && !shown.includes(pick)) shown[ASSET_CHIPS - 1] = pick;
  return { shown, more: ranked.filter((item) => !shown.includes(item)) };
}

/** The problems the form shows, or the fields the owner has left. */
type Found = ReadonlySet<EntryProblem>;

/** The text a Field shows under its control once the problem is found (ids `${id}-<problem>`). */
const problemOf = (found: Found, name: EntryProblem, text = problemText[name]) =>
  found.has(name) ? text : null;
const fieldError = (id: string, found: Found, problem: EntryProblem, text = problemText[problem]) =>
  found.has(problem) && (
    <span className="ui-field__error" id={`${id}-${problem}-error`}>
      {text}
    </span>
  );
const invalid = (id: string, found: Found, problem: EntryProblem) =>
  found.has(problem) ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` } : {};

/** The date and time of an entry. */
type Moment = Pick<TransactionEntry, 'date' | 'time'>;

/** An edit keeps its recorded instant; a new entry for today without a time is now. */
function timedEntry<T extends Moment>(entry: T, editing: boolean): T {
  return editing ? entry : withDefaultTime(entry, new Date());
}

/** While the date or time is still being typed, the lookups follow the moment settled before. */
const unsettled = (settled: Moment, entry: Moment) =>
  settled.date !== entry.date || settled.time !== entry.time;

/** `EUR:2026-03-01`: the currency and date of the Bank of Russia rate a trade needs, if any. */
const rateKeyOf = (currency: PaidIn, settled: Moment, editing: boolean) =>
  needsRate(currency) ? `${currency}:${rateDate(settled, new Date(), editing)}` : null;

/** The entry as the form shows it: timed, with the prefilled rate until the owner edits it. */
function shownEntry(
  entry: TransactionEntry,
  editing: boolean,
  prefill: string | null,
): TransactionEntry {
  const timed = timedEntry(entry, editing);
  return entry.rateEdited ? timed : { ...timed, rate: prefill ?? '' };
}

/** `account|asset|instant` for a balance lookup, or null while a part is missing or half-typed. */
function balanceKey(
  wanted: boolean,
  accountId: string,
  instrumentId: string | undefined,
  settled: Moment,
  at: string,
): string | null {
  if (!wanted || !accountId || !instrumentId) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settled.date)) return null;
  if (settled.time && !/^\d{2}:\d{2}$/.test(settled.time)) return null;
  return `${accountId}|${instrumentId}|${at}`;
}

/** The Bank of Russia rate of a rate key, and whether it is still loading. */
function useBankRate(rateKey: string | null, pending: boolean) {
  const [bank, setBank] = useState<{ key: string; rate: string | null } | null>(null);
  useEffect(() => {
    if (!rateKey) return;
    const [currency, date] = rateKey.split(':') as ['EUR' | 'RUB', string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let live = true;
    fxRatesApi
      .get(date)
      .then((report) => live && setBank({ key: rateKey, rate: bankRate(currency, report) }))
      .catch(() => live && setBank({ key: rateKey, rate: null }));
    return () => {
      live = false;
    };
  }, [rateKey]);
  const stored = bank?.key === rateKey ? bank : null;
  return {
    prefill: !pending && stored ? stored.rate : null,
    rateLoading: rateKey !== null && (pending || stored === null),
  };
}

/** What the account of a balance key holds of its asset at its instant, and whether it loads. */
function useAvailable(key: string | null, editing: Operation | undefined) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  useEffect(() => {
    if (!key) return;
    const [account, instrumentId, instant] = key.split('|');
    let live = true;
    tradesApi
      .available(account, {
        instrumentId,
        at: instant,
        ...(editing ? { exclude: editing.id } : {}),
      })
      .then((result) => live && setAvailability({ key, quantity: result.quantity }))
      .catch(() => live && setAvailability({ key, quantity: null }));
    return () => {
      live = false;
    };
  }, [key, editing]);
  const current = key !== null && availability?.key === key ? availability : null;
  return { quantity: current?.quantity ?? null, loading: key !== null && current === null };
}

/** The latest market price in USD and the share of the portfolio of each asset valued. */
function valuationMaps(report: PortfolioValuation | null) {
  const prices = new Map<string, string>();
  const shares = new Map<string, number>();
  for (const item of report?.assets ?? []) {
    if (item.priceSource === 'market' && item.price)
      prices.set(item.instrumentId, item.price.value);
    const share = Number(item.allocationPercent);
    if (share > 0) shares.set(item.instrumentId, share);
  }
  return { prices, shares };
}

/**
 * Whether the window offers an asset: no cash, nor a coin of a token the wallets leave out or an
 * asset the owner hid, except the asset an edit was recorded with.
 */
const offered = (
  asset: PortfolioAsset,
  kept: string,
  hiddenSymbols: ReadonlySet<string>,
  hiddenIds: ReadonlySet<string>,
) =>
  asset.id === kept ||
  (asset.assetType !== 'fiat' &&
    !hiddenIds.has(asset.id) &&
    !(asset.assetType === 'crypto' && asset.symbol && hiddenSymbols.has(asset.symbol)));

/** The ticker of a new asset as it is saved. */
const tickerOf = (other: OtherAsset | null) => other?.ticker.trim().toUpperCase() ?? '';

/** The account's cash in the paid currency, which a buy spends first (OPS-BUY-CASH). */
function cashOf(assets: readonly PortfolioAsset[], entry: TransactionEntry, otherTicker: string) {
  // A new asset typed as the cash itself buys it, not with it.
  if (otherTicker === entry.currency) return undefined;
  return assets.find((item) => isCashOf(item, entry.currency) && item.id !== entry.instrumentId);
}

/** A transfer's fee leaves the sending account in the same coin. */
const transferFee = (transfer: boolean, fee: string) => (transfer && fee ? decimal(fee) : null);

/** Whether the amount, with a transfer's fee, is more than the account holds then. */
function overspends(amount: string | null, fee: string | null, available: string | null) {
  const spent = amount && fee ? addDecimal(amount, fee) : amount;
  return available !== null && spent !== null && compareDecimal(spent, available) > 0;
}

/** The asset chosen, unless a new one is being typed. */
const chosenAsset = (
  other: OtherAsset | null,
  assets: readonly PortfolioAsset[] | null,
  instrumentId: string,
) => (other ? undefined : assets?.find((item) => item.id === instrumentId));

/** What the amount is counted in, and the unit of its price. */
function symbolsOf(
  other: OtherAsset | null,
  otherTicker: string,
  asset: PortfolioAsset | undefined,
) {
  if (other) return { symbol: otherTicker || UNITS, unitSymbol: otherTicker || 'unit' };
  return { symbol: asset?.symbol ?? UNITS, unitSymbol: asset?.symbol ?? asset?.name ?? 'unit' };
}

/** A new asset's ticker stands in for its id until it is saved with the trade. */
const checkedEntry = (
  shown: TransactionEntry,
  other: OtherAsset | null,
  otherTicker: string,
): TransactionEntry =>
  other ? { ...shown, instrumentId: tickerPattern.test(otherTicker) ? 'other' : '' } : shown;

/** Every problem once the owner tried to save; before that, those of the fields left. */
const foundOf = (all: Set<EntryProblem>, tried: boolean, left: Found) =>
  tried ? all : new Set([...all].filter((problem) => left.has(problem)));
/** Whether a field's problem shows: once the owner tried to save or left the field. */
const shows = (tried: boolean, left: Found, problem: EntryProblem) => tried || left.has(problem);

/** The asset's latest market price in USD, for the "Market today" hints. */
const marketOf = (market: ReadonlyMap<string, string>, asset: PortfolioAsset | undefined) =>
  asset ? market.get(asset.id) : undefined;

const isPriced = (kind: EntryKind) => kind === 'buy' || kind === 'sell';

const nameOf = (accounts: readonly Account[] | null, accountId: string) =>
  accounts?.find((item) => item.id === accountId)?.name ?? 'This account';

/** A transfer needs a second account to receive it, other than the one it leaves. */
const transferChecks = (
  transfer: boolean,
  accounts: readonly Account[] | null,
  accountId: string,
  toAccountId: string,
) => ({
  sameAccount: transfer && toAccountId === accountId,
  fewAccounts: transfer && (accounts?.length ?? 0) < 2,
});

/** An edit at the same date and time keeps the operation's exact instant and place in it. */
function keptMoment(
  editing: Operation | undefined,
  shown: TransactionEntry,
  initial: TransactionEntry,
) {
  if (!editing || occurredAt(shown) !== occurredAt(initial))
    return { order: undefined, instant: {} };
  return {
    order: editing.orderWithinTimestamp,
    instant: { occurredAt: editing.occurredAt },
  };
}

/** What a save takes from the form, whatever the type. */
interface Save {
  record: TransactionEntry;
  account: Account;
  editing: Operation | undefined;
  order: number | undefined;
  instant: { occurredAt?: string };
  /** The same typed request keeps its request id, so a retry never saves it twice. */
  requestId: (body: object) => string;
}

async function saveTransfer(
  { record, account, editing, order, instant, requestId }: Save,
  receiver: Account,
) {
  const command = {
    ...transferFromEntry(
      record,
      {
        requestId: '',
        expectedFromJournalRevision: account.journalRevision,
        expectedToJournalRevision: receiver.journalRevision,
      },
      order,
    ),
    ...instant,
  };
  const saved = { ...command, requestId: requestId(command) };
  if (editing)
    await ownedTransfersApi.correct(editing.id.replace(/^transfer:/, ''), {
      ...saved,
      expectedVersion: editing.version ?? 0,
    });
  else
    await ownedTransfersApi.create({
      ...saved,
      fromAccountId: account.id,
      toAccountId: receiver.id,
    });
}

async function saveReward(
  { record, account, editing, order, instant, requestId }: Save,
  kind: 'reward' | 'airdrop',
) {
  const command = {
    ...rewardFromEntry(
      record,
      kind,
      { requestId: '', expectedJournalRevision: account.journalRevision },
      order,
    ),
    ...instant,
  };
  const saved = { ...command, requestId: requestId(command) };
  if (editing)
    await assetRewardsApi.correct(account.id, editing.id.replace(/^reward:/, ''), {
      ...saved,
      expectedVersion: editing.version ?? 0,
    });
  else await assetRewardsApi.create(account.id, saved);
}

async function saveTrade(
  { record, account, editing, order, instant, requestId }: Save,
  kind: EntryKind,
  traded: PortfolioAsset | undefined,
) {
  const identity = { requestId: '', expectedJournalRevision: account.journalRevision };
  const command = {
    ...(isPurposeKind(kind)
      ? purposeTradeFromEntry(record, kind, identity, order)
      : tradeFromEntry(record, identity, order, !(traded && isCashOf(traded, record.currency)))),
    ...instant,
  };
  const saved = { ...command, requestId: requestId(command) };
  if (editing) await tradesApi.correct(account.id, editing.id.replace(/^trade:/, ''), saved);
  else await tradesApi.create(account.id, saved);
}

/** A transfer, a reward or airdrop, and every other type are three kinds of record. */
function saveEntry(
  save: Save,
  kind: EntryKind,
  receiver: Account | undefined,
  traded: PortfolioAsset | undefined,
) {
  if (kind === 'transfer' && receiver) return saveTransfer(save, receiver);
  if (kind === 'reward' || kind === 'airdrop') return saveReward(save, kind);
  return saveTrade(save, kind, traded);
}

/** "Buy 0.01 BTC · Bybit", the amount as entered, and "Bybit → Ledger" for a transfer. */
function savedDetail(
  kind: EntryKind,
  amount: string,
  symbol: string,
  account: Account,
  receiver: Account | undefined,
) {
  const where =
    kind === 'transfer' && receiver ? `${account.name} → ${receiver.name}` : account.name;
  return `${kindNames.get(kind) ?? 'Transaction'} ${counted(amount, symbol)} · ${where}`;
}

/** The window's words when it adds a transaction and when it corrects one. */
const wording = {
  add: { title: 'Add transaction', save: 'Save transaction', saved: 'Transaction added' },
  edit: { title: 'Edit transaction', save: 'Save changes', saved: 'Transaction updated' },
} as const;

// "Add transaction" from the accepted prototype: buy or sell, paid in USD, USDT, USDC, EUR or RUB.
export default function AddTransactionDialog({ onClose, onSaved, editing }: Props) {
  const [initial] = useState(() => (editing ? entryFromOperation(editing) : blankEntry()));
  const [kind, setKind] = useState<EntryKind>(() => (editing && entryKind(editing)) || 'buy');
  const [moreShown, setMoreShown] = useState(() => isMoreKind(kind));
  // A transfer's receiving account; the sending one is the account below.
  const [toAccountId, setToAccountId] = useState(() => editing?.counterAccount?.id ?? '');
  const [assets, setAssets] = useState<PortfolioAsset[] | null>(null);
  // Every asset, cash included: the account's cash in the paid currency is one of them.
  const [allAssets, setAllAssets] = useState<PortfolioAsset[]>([]);
  const [other, setOther] = useState<OtherAsset | null>(null);
  const otherRequest = useRef<{ ticker: string; requestId: string } | null>(null);
  // Latest market price in USD per asset, for the "Market today" hint.
  const [market, setMarket] = useState<ReadonlyMap<string, string>>(new Map());
  // The share of the portfolio of each asset held, for the order of the choices.
  const [allocation, setAllocation] = useState<ReadonlyMap<string, number>>(new Map());
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [accountId, setAccountId] = useState(() => editing?.account?.id ?? '');
  const [entry, setEntry] = useState<TransactionEntry>(initial);
  // An edit shows the price per unit the recorded amount and total imply.
  const [unit, setUnit] = useState(() => {
    const units = positive(initial.amount);
    const sum = positive(initial.total);
    return editing && units && sum ? derivedPrice(sum, units) : '';
  });
  // Which of price and total the owner typed last; an edit starts from the recorded total.
  const driver = useRef<'unit' | 'total'>(editing ? 'total' : 'unit');
  const [tried, setTried] = useState(false);
  // Fields the owner has left: their problems show on blur and clear as soon as the value is fixed.
  const [left, setLeft] = useState<Found>(new Set());
  // The date and time the rate and balance lookups follow: they move when the owner leaves the
  // field, not on every keystroke of a half-typed date.
  const [settled, setSettled] = useState(() => ({ date: initial.date, time: initial.time }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The Convert body saves on its own; the window still must not close under it.
  const [convertSaving, setConvertSaving] = useState(false);
  const attempt = useRef<{ body: string; requestId: string } | null>(null);
  const id = useId();
  const { form, refused } = useFocusFirstProblem();
  const toast = useToast();
  // The owner picked an account or an asset; a default that arrives later leaves them as they are.
  const accountTouched = useRef(false);
  const assetTouched = useRef(false);
  const chooseAccount = (set: (value: string) => void) => (value: string) => {
    accountTouched.current = true;
    set(value);
  };

  useEffect(() => {
    let live = true;
    // TOKEN-HIDE: the coins of tokens the wallets leave out are not offered; the list still shows
    // them when the wallets cannot be read, and an edit keeps the asset it was recorded with.
    const hiddenTokens = cachedReads.wallets
      .load()
      .then(hiddenTokenSymbols)
      .catch(() => new Set<string>());
    // ASSET-HIDE: nor are the assets the owner hid from their own pages.
    const hiddenAssets = cachedReads.hiddenAssets
      .load()
      .then((hidden) => new Set(hidden.map((asset) => asset.instrumentId)))
      .catch(() => new Set<string>());
    // The valuation is optional: the market hint and the order by allocation need it, nothing else.
    const valuation = cachedReads.portfolio.load('USD').catch(() => null);
    Promise.all([
      portfolioAssetsApi.listAll(),
      journalAccounts(),
      hiddenTokens,
      hiddenAssets,
      valuation,
    ])
      .then(async ([allAssets, withJournal, hidden, hiddenIds, report]) => {
        if (!live) return;
        const { prices, shares } = valuationMaps(report);
        const tradable = byAllocation(
          allAssets.filter((asset) => offered(asset, initial.instrumentId, hidden, hiddenIds)),
          shares,
        );
        setMarket(prices);
        setAllocation(shares);
        setAssets(tradable);
        setAllAssets(allAssets);
        setAccounts(withJournal);
        if (editing) return;
        const first = tradable[0]?.id ?? '';
        const startFrom = (from: string) => {
          setAccountId(from);
          setToAccountId(withJournal.find((account) => account.id !== from)?.id ?? '');
        };
        startFrom(withJournal[0]?.id ?? '');
        setEntry((current) => ({ ...current, instrumentId: first }));
        // The form shows at once. The first asset's largest holder then becomes the account it
        // starts from, so a sale or a transfer of it does not start from an account that has
        // none; never once the owner chose an account or another asset.
        const holder = await holderOf(withJournal, first);
        if (live && holder && !accountTouched.current && !assetTouched.current) startFrom(holder);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [editing, initial.instrumentId]);

  // The Bank of Russia rate of the chosen date fills the rate field until the owner edits it.
  const rateKey = rateKeyOf(entry.currency, settled, Boolean(editing));
  // While the date or time is still being typed the stored rate belongs to the old moment.
  const pending = unsettled(settled, entry);
  const { prefill, rateLoading } = useBankRate(rateKey, pending);
  const shown = shownEntry(entry, Boolean(editing), prefill);

  // A sale cannot take more than the account holds on its date or later (OPS-OVERSPEND), nor
  // can an expense, a gift sent, a fee or a transfer with its fee.
  const sell = spends(kind);
  const buy = kind === 'buy';
  const transfer = kind === 'transfer';
  const at = occurredAt(timedEntry(settled, Boolean(editing)));
  const availableKey = balanceKey(sell, accountId, entry.instrumentId, settled, at);
  const { quantity: available, loading: availableLoading } = useAvailable(availableKey, editing);

  const otherTicker = tickerOf(other);
  const cashKey = balanceKey(
    buy,
    accountId,
    cashOf(allAssets, entry, otherTicker)?.id,
    settled,
    at,
  );
  const { quantity: cash } = useAvailable(cashKey, editing);
  const typedFee = transferFee(transfer, entry.fee);
  const overspent = overspends(positive(entry.amount), typedFee, available);

  const update = (value: Partial<TransactionEntry>) => {
    if ('instrumentId' in value) assetTouched.current = true;
    setEntry((current) => ({ ...current, ...value }));
  };
  const pick = (instrumentId: string) => {
    setOther(null);
    update({ instrumentId });
  };
  const asset = chosenAsset(other, assets, entry.instrumentId);
  const { symbol, unitSymbol } = symbolsOf(other, otherTicker, asset);
  const checked = checkedEntry(shown, other, otherTicker);
  const found = foundOf(problems(checked, today(), kind), tried, left);
  const overshown = overspent && shows(tried, left, 'amount');
  /** Marks a field as left, so its problem, if any, shows from now on. */
  const leave = (problem: EntryProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  /** Date and time settle when focus leaves them, and the lookups follow. */
  const settle = (problem: 'date' | 'time') => () => {
    leave(problem)();
    setSettled({ date: entry.date, time: entry.time });
  };
  const priced = isPriced(kind);
  const commented = carriesComment(kind);
  const accountName = nameOf(accounts, accountId);
  const { sameAccount, fewAccounts } = transferChecks(transfer, accounts, accountId, toAccountId);
  // Use all leaves room for a transfer's fee.
  const applyAll = () => {
    if (available === null) return;
    setAmount(typedFee ? subtractDecimal(available, typedFee) : available);
  };

  /** Switching type keeps the asset, amount and date; a value is always in USD. */
  const choose = (next: EntryKind) => {
    setKind(next);
    update({
      side: spends(next) ? 'sell' : 'buy',
      ...(next === 'buy' || next === 'sell'
        ? {}
        : { currency: 'USD', rate: '', rateEdited: false }),
    });
    if (spends(next)) setOther(null);
  };

  // Price per unit and total follow each other: the field typed last decides. A total that
  // was typed (or recorded) is never recomputed from the shown, rounded price. The total is the
  // saved cost, so it is the exact product within the server's 30 decimals; past that the owner types it.
  const totalOf = (units: string, each: string) => exactProduct(units, each, 30) ?? '';
  const setAmount = (amount: string) => {
    const units = positive(amount);
    if (driver.current === 'total') {
      update({ amount });
      const sum = positive(entry.total);
      if (units && sum) setUnit(derivedPrice(sum, units));
      return;
    }
    const each = positive(unit);
    update({ amount, ...(units && each ? { total: totalOf(units, each) } : {}) });
  };
  const setUnitPrice = (value: string) => {
    driver.current = 'unit';
    setUnit(value);
    const units = positive(entry.amount);
    const each = positive(value);
    if (units && each) update({ total: totalOf(units, each) });
  };
  const setTotal = (total: string) => {
    driver.current = 'total';
    update({ total });
    const units = positive(entry.amount);
    const sum = positive(total);
    if (units && sum) setUnit(derivedPrice(sum, units));
  };

  const marketUsd = marketOf(market, asset);

  /** The new asset for "Other asset": an existing one with that ticker, or one created now. */
  const otherAssetId = async (): Promise<string> => {
    const existing = allAssets.find(
      (item) => item.assetType !== 'fiat' && item.symbol?.toUpperCase() === otherTicker,
    );
    if (existing) return existing.id;
    if (otherRequest.current?.ticker !== otherTicker)
      otherRequest.current = { ticker: otherTicker, requestId: newRequestId() };
    const created = await portfolioAssetsApi.create({
      requestId: otherRequest.current.requestId,
      name: other?.name.trim() || otherTicker,
      symbol: otherTicker,
      assetType: 'crypto',
    });
    setAllAssets((current) => [...current, created]);
    setAssets((current) => (current ? [...current, created] : [created]));
    return created.id;
  };

  const words = wording[editing ? 'edit' : 'add'];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Enter inside the date or time: settle it first, the rate and balance for it load, then save.
    if (pending) {
      setSettled({ date: entry.date, time: entry.time });
      return;
    }
    setTried(true);
    const account = accounts?.find((item) => item.id === accountId);
    const receiver = accounts?.find((item) => item.id === toAccountId);
    if (
      problems(checked, today(), kind).size ||
      !account ||
      overspent ||
      (transfer && (!receiver || sameAccount))
    ) {
      // The keyboard goes to the first field to fix, which reads out its error.
      refused();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const instrumentId = other ? await otherAssetId() : shown.instrumentId;
      const traded = allAssets.find((item) => item.id === instrumentId);
      // The same typed request keeps its request id, so a retry never saves it twice.
      const requestId = (body: object) => {
        const key = JSON.stringify({ accountId, toAccountId, kind, ...body });
        if (attempt.current?.body !== key)
          attempt.current = { body: key, requestId: newRequestId() };
        return attempt.current.requestId;
      };
      const record = { ...shown, instrumentId };
      const moment = keptMoment(editing, shown, initial);
      await saveEntry({ record, account, editing, ...moment, requestId }, kind, receiver, traded);
      // The same titles as the Transactions page's own word, so the toast is shown once; the
      // line under it says what was saved, the amount as entered ("Buy 0.01 BTC · Bybit").
      toast.show({
        tone: 'success',
        title: words.saved,
        detail: savedDetail(kind, entry.amount, symbol, account, receiver),
      });
      onSaved();
    } catch (caught) {
      setError(failure(caught, accounts, symbol, occurredAt(shown)));
      setSaving(false);
    }
  };

  // Not loaded yet, or nothing to record a transaction in.
  const empty = !assets || !accounts || accounts.length === 0 || assets.length === 0;

  // Convert starts in the account that holds the most of the cash given up.
  const holderOfCash = useCallback(
    (instrumentId: string) => holderOf(accounts ?? [], instrumentId),
    [accounts],
  );
  // Switching to or from Convert swaps the whole body, so the Type choice is made anew: give the
  // keyboard back to the type that was just chosen.
  const firstKind = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of type moves the focus.
  useEffect(() => {
    if (firstKind.current) {
      firstKind.current = false;
      return;
    }
    document.querySelector<HTMLInputElement>(`input[name="${id}-kind"]:checked`)?.focus();
  }, [kind === 'convert']);
  // The body under a running save stays, so its answer lands in the form that asked.
  const typeLocked = saving || convertSaving;
  const typeField = (
    <TypeField
      id={id}
      kind={kind}
      editing={Boolean(editing)}
      locked={typeLocked}
      moreShown={moreShown}
      onMore={() => setMoreShown(!moreShown)}
      onChoose={choose}
    />
  );

  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={typeLocked ? undefined : onClose}
      initialFocus={(root) => root.querySelector<HTMLElement>('input[type="radio"]:checked')}
    >
      {kind === 'convert' ? (
        <ConvertForm
          titleId={`${id}-title`}
          typeField={typeField}
          accounts={accounts}
          // Every asset, once both lists have loaded.
          assets={assets && accounts && allAssets}
          loadFailed={loadFailed}
          holderOf={holderOfCash}
          onClose={onClose}
          onSaved={onSaved}
          onSaving={setConvertSaving}
        />
      ) : (
        <form ref={form} onSubmit={submit} noValidate>
          <ModalHeader
            titleId={`${id}-title`}
            title={words.title}
            onClose={onClose}
            closeDisabled={saving}
          />
          <ModalBody>
            {typeField}
            {loadFailed || empty ? (
              <LoadNotice failed={loadFailed} accounts={accounts} assets={assets} />
            ) : (
              <>
                <AssetField
                  id={id}
                  assets={assets}
                  instrumentId={entry.instrumentId}
                  market={market}
                  allocation={allocation}
                  other={other}
                  sell={sell}
                  editing={Boolean(editing)}
                  found={found}
                  onPick={pick}
                  onOther={() => setOther(other ?? { ticker: '', name: '' })}
                />
                <OtherAssetFields
                  id={id}
                  other={other}
                  ticker={otherTicker}
                  found={found}
                  onChange={setOther}
                  onLeave={leave('instrument')}
                />
                <div className="ui-field-row">
                  <AmountField
                    id={id}
                    symbol={symbol}
                    amount={entry.amount}
                    found={found}
                    sell={sell}
                    over={overshown}
                    account={accountName}
                    at={at}
                    available={available}
                    loading={availableLoading}
                    onChange={setAmount}
                    onLeave={leave('amount')}
                    onUseAll={applyAll}
                  />
                  <Field id={`${id}-date`} label="Date" error={problemOf(found, 'date')}>
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        max={today()}
                        value={entry.date}
                        onChange={(event) => update({ date: event.target.value })}
                        onBlur={settle('date')}
                      />
                    )}
                  </Field>
                </div>
                {priced && (
                  <>
                    <PriceRow
                      id={id}
                      buy={buy}
                      unitSymbol={unitSymbol}
                      currency={entry.currency}
                      rate={shown.rate}
                      marketUsd={marketUsd}
                      unit={unit}
                      total={entry.total}
                      found={found}
                      onUnitPrice={setUnitPrice}
                      onTotal={setTotal}
                      onLeaveTotal={leave('total')}
                    />
                    <PaidInField
                      id={id}
                      buy={buy}
                      sell={sell}
                      currency={entry.currency}
                      asset={asset}
                      account={accountName}
                      cash={cash}
                      total={shown.total}
                      onCurrency={(code: PaidIn) =>
                        update({ currency: code, rate: '', rateEdited: false })
                      }
                    />
                    <RateField
                      id={id}
                      currency={entry.currency}
                      rate={shown.rate}
                      edited={entry.rateEdited}
                      prefill={prefill}
                      loading={rateLoading}
                      found={found}
                      onRate={(rate) => update({ rate, rateEdited: true })}
                      onBankRate={() => update({ rate: '', rateEdited: false })}
                      onLeave={leave('rate')}
                    />
                  </>
                )}
                <ValueField
                  id={id}
                  kind={kind}
                  total={entry.total}
                  amount={entry.amount}
                  marketUsd={marketUsd}
                  found={found}
                  onTotal={(total) => update({ total })}
                  onLeave={leave('total')}
                />
                <AccountFields
                  id={id}
                  transfer={transfer}
                  accounts={accounts}
                  accountId={accountId}
                  toAccountId={toAccountId}
                  editing={Boolean(editing)}
                  tried={tried}
                  sameAccount={sameAccount}
                  fewAccounts={fewAccounts}
                  onAccount={chooseAccount(setAccountId)}
                  onToAccount={chooseAccount(setToAccountId)}
                />
                <MoreOptions
                  id={id}
                  entry={entry}
                  found={found}
                  priced={priced}
                  transfer={transfer}
                  commented={commented}
                  symbol={symbol}
                  onUpdate={update}
                  onSettleTime={settle('time')}
                  onLeave={leave}
                />
              </>
            )}
            {error && <Banner tone="neg">{error}</Banner>}
          </ModalBody>
          <ModalFooter summary={<Summary kind={kind} shown={shown} total={entry.total} />}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || (priced && rateLoading) || empty || fewAccounts}
            >
              {words.save}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}

interface TypeFieldProps {
  id: string;
  kind: EntryKind;
  editing: boolean;
  locked: boolean;
  moreShown: boolean;
  onMore: () => void;
  onChoose: (kind: EntryKind) => void;
}

/** The Type choice: five types in view, the rest under More, and a gift received or sent. */
function TypeField({ id, kind, editing, locked, moreShown, onMore, onChoose }: TypeFieldProps) {
  const disabled = (value: EntryKind) => locked || editLocked(editing, value, kind);
  return (
    <div className="ui-field">
      <span id={`${id}-type`} className="ui-field__label">
        Type
      </span>
      <div className="portfolio-types">
        <SegmentedControl
          name={`${id}-kind`}
          labelledBy={`${id}-type`}
          options={mainKinds}
          value={kind}
          disabled={disabled}
          onChange={onChoose}
        />
        <Button
          variant="ghost"
          size="sm"
          className="portfolio-types__more"
          aria-expanded={moreShown}
          aria-controls={`${id}-more-types`}
          onClick={onMore}
        >
          More <span aria-hidden="true">{moreShown ? '▴' : '▾'}</span>
        </Button>
      </div>
      {moreShown && (
        <SegmentedControl
          id={`${id}-more-types`}
          name={`${id}-kind`}
          label="More types"
          options={moreKinds}
          value={kind}
          isChecked={(value) =>
            value === 'gift-received' ? kind.startsWith('gift') : kind === value
          }
          disabled={disabled}
          onChange={onChoose}
        />
      )}
      {kind.startsWith('gift') && (
        <SegmentedControl
          name={`${id}-gift`}
          label="Gift"
          options={giftKinds}
          value={kind}
          onChange={onChoose}
        />
      )}
    </div>
  );
}

interface LoadNoticeProps {
  failed: boolean;
  accounts: readonly Account[] | null;
  assets: readonly PortfolioAsset[] | null;
}

/** Why there are no fields: the load failed or is running, or there is no account or asset. */
function LoadNotice({ failed, accounts, assets }: LoadNoticeProps) {
  if (failed)
    return (
      <Banner tone="neg">
        Could not load your assets and accounts. Close this window and try again.
      </Banner>
    );
  if (accounts === null || assets === null)
    return (
      <p className="ui-field__hint" role="status">
        Loading your assets and accounts…
      </p>
    );
  return (
    <Banner tone="info" role="status">
      {accounts.length === 0 ? (
        <>
          Add a wallet first on the{' '}
          <Link className="ui-link" to="/wallets">
            Wallets
          </Link>{' '}
          page, or an asset with a balance on the Portfolio page.
        </>
      ) : (
        'Add an asset first on the Portfolio page, then record its trades.'
      )}
    </Banner>
  );
}

interface AssetFieldProps {
  id: string;
  assets: readonly PortfolioAsset[];
  instrumentId: string;
  market: ReadonlyMap<string, string>;
  allocation: ReadonlyMap<string, number>;
  other: OtherAsset | null;
  sell: boolean;
  editing: boolean;
  found: Found;
  onPick: (instrumentId: string) => void;
  onOther: () => void;
}

/** The asset chips, the rest under "More assets", and "Other asset" for a coin not yet added. */
function AssetField({
  id,
  assets,
  instrumentId,
  market,
  allocation,
  other,
  sell,
  editing,
  found,
  onPick,
  onOther,
}: AssetFieldProps) {
  const { shown, more } = splitAssets(assets, instrumentId, market, allocation);
  return (
    <div className="ui-field">
      <span id={`${id}-asset`} className="ui-field__label">
        Asset
      </span>
      <ChipGroup labelledBy={`${id}-asset`}>
        {shown.map((item) => (
          <Chip
            key={item.id}
            pressed={!other && instrumentId === item.id}
            icon={
              <AssetIcon
                symbol={item.symbol}
                name={item.name}
                assetType={item.assetType}
                size="sm"
              />
            }
            onClick={() => onPick(item.id)}
          >
            {item.symbol ?? item.name}
          </Chip>
        ))}
        {more.length > 0 && (
          <Select
            size="sm"
            className="portfolio-chip-select"
            aria-label="More assets"
            value=""
            onChange={(event) => onPick(event.target.value)}
          >
            <option value="">More assets…</option>
            {more.map((item) => (
              <option key={item.id} value={item.id}>
                {item.symbol ? `${item.symbol} · ${item.name}` : item.name}
              </option>
            ))}
          </Select>
        )}
        {!sell && !editing && (
          <Chip pressed={other !== null} onClick={onOther}>
            <span aria-hidden="true">+</span> Other asset
          </Chip>
        )}
      </ChipGroup>
      {other ? null : fieldError(id, found, 'instrument')}
    </div>
  );
}

interface OtherAssetFieldsProps {
  id: string;
  other: OtherAsset | null;
  ticker: string;
  found: Found;
  onChange: (other: OtherAsset) => void;
  onLeave: () => void;
}

/** The ticker and name of a coin not yet among the assets, added with the trade. */
function OtherAssetFields({ id, other, ticker, found, onChange, onLeave }: OtherAssetFieldsProps) {
  if (!other) return null;
  return (
    <div className="ui-field-row">
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-ticker`}>
          Ticker
        </label>
        <Input
          id={`${id}-ticker`}
          placeholder="e.g. TON"
          autoComplete="off"
          value={other.ticker}
          onChange={(event) => onChange({ ...other, ticker: event.target.value })}
          onBlur={onLeave}
          {...invalid(id, found, 'instrument')}
        />
        {fieldError(id, found, 'instrument', 'Enter the ticker: letters and digits, up to 32')}
      </div>
      <Field id={`${id}-name`} label="Name (optional)">
        {(control) => (
          <Input
            {...control}
            placeholder={ticker || 'Toncoin'}
            autoComplete="off"
            maxLength={120}
            value={other.name}
            onChange={(event) => onChange({ ...other, name: event.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

interface AmountFieldProps {
  id: string;
  symbol: string;
  amount: string;
  found: Found;
  sell: boolean;
  /** The amount is more than the account holds, and the owner has seen it. */
  over: boolean;
  account: string;
  at: string;
  available: string | null;
  loading: boolean;
  onChange: (amount: string) => void;
  onLeave: () => void;
  onUseAll: () => void;
}

/** The amount, and for a sale what the account holds then. */
function AmountField({
  id,
  symbol,
  amount,
  found,
  sell,
  over,
  account,
  at,
  available,
  loading,
  onChange,
  onLeave,
  onUseAll,
}: AmountFieldProps) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={`${id}-amount`}>
        Amount
      </label>
      <Affix suffix={symbol}>
        <Input
          id={`${id}-amount`}
          numeric
          placeholder="0.00"
          value={amount}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onLeave}
          {...(over
            ? { 'aria-invalid': true, 'aria-describedby': `${id}-available` }
            : invalid(id, found, 'amount'))}
        />
      </Affix>
      {fieldError(id, found, 'amount', numberProblem(amount, problemText.amount)) ||
        (sell && (
          <Availability
            id={`${id}-available`}
            account={account}
            symbol={symbol}
            date={at}
            available={available}
            loading={loading}
            over={over}
            onUseAll={onUseAll}
          />
        ))}
    </div>
  );
}

interface PriceRowProps {
  id: string;
  buy: boolean;
  unitSymbol: string;
  currency: PaidIn;
  /** The rate shown, for the market price in a currency other than USD. */
  rate: string;
  marketUsd: string | undefined;
  unit: string;
  total: string;
  found: Found;
  onUnitPrice: (value: string) => void;
  onTotal: (value: string) => void;
  onLeaveTotal: () => void;
}

/** The price per unit and the total, with the market price today to use. */
function PriceRow({
  id,
  buy,
  unitSymbol,
  currency,
  rate,
  marketUsd,
  unit,
  total,
  found,
  onUnitPrice,
  onTotal,
  onLeaveTotal,
}: PriceRowProps) {
  // The asset's latest market price in the price field's currency (prototype "Market today").
  const rateShown = needsRate(currency) ? positive(rate) : '1';
  const marketPrice = marketUsd && rateShown ? marketPriceFigure(marketUsd, rateShown) : null;
  return (
    <div className="ui-field-row">
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-unit`}>
          Price per {unitSymbol}
        </label>
        <Affix suffix={currency}>
          <Input
            id={`${id}-unit`}
            numeric
            placeholder="0.00"
            value={unit}
            onChange={(event) => onUnitPrice(event.target.value)}
          />
        </Affix>
        {marketPrice && (
          <span className="ui-field__hint">
            Market today{' '}
            {needsRate(currency)
              ? `${quantity(marketPrice)} ${currency}`
              : price(marketUsd ?? null, 'USD')}{' '}
            ·{' '}
            <button type="button" className="ui-link" onClick={() => onUnitPrice(marketPrice)}>
              Use
            </button>
          </span>
        )}
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-total`}>
          {buy ? 'Total paid' : 'Total received'}
        </label>
        <Affix suffix={currency}>
          <Input
            id={`${id}-total`}
            numeric
            placeholder="0.00"
            value={total}
            onChange={(event) => onTotal(event.target.value)}
            onBlur={onLeaveTotal}
            {...invalid(id, found, 'total')}
          />
        </Affix>
        {fieldError(id, found, 'total', buy ? 'Enter what you paid' : 'Enter what you received')}
      </div>
    </div>
  );
}

/** How much of the buy the account's cash pays; the rest is money from outside. */
function fromCashOf(cash: string | null, total: string | null): string | null {
  if (cash === null || total === null || !(Number(cash) > 0)) return null;
  return compareDecimal(cash, total) < 0 ? cash : total;
}

interface PaidInFieldProps {
  id: string;
  buy: boolean;
  sell: boolean;
  currency: PaidIn;
  asset: PortfolioAsset | undefined;
  account: string;
  /** What the account holds of its cash in the currency, for a buy. */
  cash: string | null;
  total: string;
  onCurrency: (code: PaidIn) => void;
}

/** The currency paid or received, and what the trade does to the account's cash in it. */
function PaidInField({
  id,
  buy,
  sell,
  currency,
  asset,
  account,
  cash,
  total,
  onCurrency,
}: PaidInFieldProps) {
  const totalTyped = positive(total);
  const fromCash = fromCashOf(cash, totalTyped);
  return (
    <div className="ui-field">
      <span id={`${id}-currency`} className="ui-field__label">
        {buy ? 'Paid in' : 'Received in'}
      </span>
      <SegmentedControl
        name={`${id}-currency`}
        labelledBy={`${id}-currency`}
        options={paidIn}
        value={currency}
        onChange={onCurrency}
      />
      {(currency === 'USDT' || currency === 'USDC') && (
        <span className="ui-field__hint">{currency} is counted 1:1 with USD.</span>
      )}
      {sell
        ? !(asset && isCashOf(asset, currency)) && (
            <span className="ui-field__hint">
              The {currency} received stays in {account} as cash.
            </span>
          )
        : fromCash !== null &&
          totalTyped !== null && (
            <span className="ui-field__hint">
              {compareDecimal(fromCash, totalTyped) === 0
                ? `Paid from the ${currency} cash in ${account}.`
                : `${quantity(fromCash)} ${currency} comes from the cash in ${account}; the other ${quantity(subtractDecimal(totalTyped, fromCash))} ${currency} is new money.`}
            </span>
          )}
    </div>
  );
}

/** What the rate field says about the rate shown. */
function rateHint(edited: boolean, prefill: string | null, loading: boolean): string {
  if (edited) return 'Your rate is used for this transaction. ';
  if (prefill)
    return 'Bank of Russia rate on the selected date, filled in automatically. Change it if you paid a different rate. ';
  return loading ? '' : 'No Bank of Russia rate is stored for this date; enter the rate you paid. ';
}

interface RateFieldProps {
  id: string;
  currency: PaidIn;
  rate: string;
  edited: boolean;
  prefill: string | null;
  loading: boolean;
  found: Found;
  onRate: (rate: string) => void;
  onBankRate: () => void;
  onLeave: () => void;
}

/** The rate a trade in EUR or RUB was paid at: the Bank of Russia rate until the owner edits it. */
function RateField({
  id,
  currency,
  rate,
  edited,
  prefill,
  loading,
  found,
  onRate,
  onBankRate,
  onLeave,
}: RateFieldProps) {
  if (!needsRate(currency)) return null;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={`${id}-rate`}>
        Exchange rate
      </label>
      <Affix wide suffix={`${currency} per 1 USD`}>
        <Input
          id={`${id}-rate`}
          numeric
          placeholder={loading ? 'Loading…' : ''}
          value={rate}
          onChange={(event) => onRate(event.target.value)}
          aria-describedby={`${id}-rate-hint`}
          onBlur={onLeave}
          {...invalid(id, found, 'rate')}
        />
      </Affix>
      {fieldError(id, found, 'rate')}
      <span className="ui-field__hint" id={`${id}-rate-hint`}>
        {rateHint(edited, prefill, loading)}
        {edited && prefill && (
          <button type="button" className="ui-link" onClick={onBankRate}>
            Use Bank of Russia rate {prefill}
          </button>
        )}
        {!edited && 'Totals are kept in USD.'}
      </span>
    </div>
  );
}

interface ValueFieldProps {
  id: string;
  kind: EntryKind;
  total: string;
  amount: string;
  marketUsd: string | undefined;
  found: Found;
  onTotal: (total: string) => void;
  onLeave: () => void;
}

/** What a type with a value in USD was worth on its date, with the market value today to use. */
function ValueField({
  id,
  kind,
  total,
  amount,
  marketUsd,
  found,
  onTotal,
  onLeave,
}: ValueFieldProps) {
  if (!valued(kind)) return null;
  // What the amount is worth at today's market price: cut down to the cent, never more than the
  // coins are worth.
  const typedAmount = positive(amount);
  const marketValue = marketUsd && typedAmount ? productDown(marketUsd, typedAmount, 2) : null;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={`${id}-total`}>
        Value{valueOptional(kind) ? ' (optional)' : ''}
      </label>
      <Affix suffix="USD">
        <Input
          id={`${id}-total`}
          numeric
          placeholder={marketValue ?? '0.00'}
          value={total}
          onChange={(event) => onTotal(event.target.value)}
          aria-describedby={`${id}-value-hint`}
          onBlur={onLeave}
          {...invalid(id, found, 'total')}
        />
      </Affix>
      {fieldError(id, found, 'total', numberProblem(total, 'Enter what it was worth on that date'))}
      <span className="ui-field__hint" id={`${id}-value-hint`}>
        What it was worth on that date. {valueHints[kind]}
        {marketValue && (
          <>
            {' '}
            Market today {money(marketValue, 'USD')} ·{' '}
            <button type="button" className="ui-link" onClick={() => onTotal(marketValue)}>
              Use
            </button>
          </>
        )}
      </span>
    </div>
  );
}

const accountOptions = (accounts: readonly Account[]) =>
  accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name}
    </option>
  ));

interface AccountFieldsProps {
  id: string;
  transfer: boolean;
  accounts: readonly Account[];
  accountId: string;
  toAccountId: string;
  editing: boolean;
  tried: boolean;
  sameAccount: boolean;
  fewAccounts: boolean;
  onAccount: (accountId: string) => void;
  onToAccount: (accountId: string) => void;
}

/** The account a trade is in, or the two accounts a transfer moves coins between. */
function AccountFields({
  id,
  transfer,
  accounts,
  accountId,
  toAccountId,
  editing,
  tried,
  sameAccount,
  fewAccounts,
  onAccount,
  onToAccount,
}: AccountFieldsProps) {
  if (!transfer)
    return (
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-account`}>
          Wallet or account
        </label>
        <Select
          id={`${id}-account`}
          value={accountId}
          disabled={editing}
          onChange={(event) => onAccount(event.target.value)}
        >
          {accountOptions(accounts)}
        </Select>
      </div>
    );
  const sameShown = tried && sameAccount;
  return (
    <>
      <div className="ui-field-row">
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-account`}>
            From
          </label>
          <Select
            id={`${id}-account`}
            value={accountId}
            disabled={editing}
            onChange={(event) => onAccount(event.target.value)}
          >
            {accountOptions(accounts)}
          </Select>
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-to`}>
            To
          </label>
          <Select
            id={`${id}-to`}
            value={toAccountId}
            disabled={editing}
            onChange={(event) => onToAccount(event.target.value)}
            {...(sameShown ? { 'aria-invalid': true, 'aria-describedby': `${id}-to-error` } : {})}
          >
            {accountOptions(accounts)}
          </Select>
          {sameShown && (
            <span className="ui-field__error" id={`${id}-to-error`}>
              Choose a different wallet
            </span>
          )}
        </div>
      </div>
      <p className="ui-field__hint">
        {fewAccounts
          ? 'Add a second wallet or account to move coins between them.'
          : 'Transfers move coins between your wallets and keep their purchase price. No price needed.'}
      </p>
    </>
  );
}

interface MoreOptionsProps {
  id: string;
  entry: TransactionEntry;
  found: Found;
  priced: boolean;
  transfer: boolean;
  commented: boolean;
  symbol: string;
  onUpdate: (value: Partial<TransactionEntry>) => void;
  onSettleTime: () => void;
  onLeave: (problem: EntryProblem) => () => void;
}

/** The time, a fee and a comment, open while any of them has a value or a problem. */
function MoreOptions({
  id,
  entry,
  found,
  priced,
  transfer,
  commented,
  symbol,
  onUpdate,
  onSettleTime,
  onLeave,
}: MoreOptionsProps) {
  // A buy, a sale or a transfer can carry a fee: in the currency paid, or in the coin moved.
  const feed = priced || transfer;
  return (
    <details
      className="ui-more"
      open={
        Boolean(entry.time || entry.fee || (commented && entry.comment)) ||
        found.has('time') ||
        found.has('fee') ||
        found.has('comment')
      }
    >
      <summary>
        {`More options: ${['time', ...(feed ? ['fee'] : []), ...(commented ? ['comment'] : [])].join(', ')}`}
      </summary>
      <div className="ui-field-row">
        <Field id={`${id}-time`} label="Time, UTC (optional)" error={problemOf(found, 'time')}>
          {(control) => (
            <Input
              {...control}
              type="time"
              value={entry.time}
              onChange={(event) => onUpdate({ time: event.target.value })}
              onBlur={onSettleTime}
            />
          )}
        </Field>
        {feed && (
          <Field
            id={`${id}-fee`}
            label="Fee (optional)"
            error={problemOf(found, 'fee', numberProblem(entry.fee, problemText.fee))}
          >
            {(control) => (
              <Affix suffix={transfer ? symbol : entry.currency}>
                <Input
                  {...control}
                  numeric
                  placeholder="0.00"
                  value={entry.fee}
                  onChange={(event) => onUpdate({ fee: event.target.value })}
                  onBlur={onLeave('fee')}
                />
              </Affix>
            )}
          </Field>
        )}
      </div>
      {/* transactions-01: only where the command keeps the comment. */}
      {commented && (
        <Field id={`${id}-comment`} label="Comment" error={problemOf(found, 'comment')}>
          {(control) => (
            <Textarea
              {...control}
              placeholder="Optional"
              value={entry.comment}
              onChange={(event) => onUpdate({ comment: event.target.value })}
              onBlur={onLeave('comment')}
            />
          )}
        </Field>
      )}
    </details>
  );
}

/** "Cost $1,000.00" for a buy or a sale, "Value $5.00" for a type with a value in USD. */
function Summary({
  kind,
  shown,
  total,
}: {
  kind: EntryKind;
  shown: TransactionEntry;
  total: string;
}) {
  const usd = isPriced(kind) ? usdTotal(shown) : null;
  return (
    <>
      {usd !== null && `${kind === 'buy' ? 'Cost' : 'Proceeds'} ${money(String(usd), 'USD')}`}
      {valued(kind) && positive(total) !== null && `Value ${money(positive(total), 'USD')}`}
    </>
  );
}

interface AvailabilityProps {
  id: string;
  account: string;
  symbol: string;
  date: string;
  available: string | null;
  loading: boolean;
  over: boolean;
  onUseAll: () => void;
}

/** "Available in Trust Wallet: 0.2 BTC · Use all", or why the amount is refused. */
function Availability({
  id,
  account,
  symbol,
  date,
  available,
  loading,
  over,
  onUseAll,
}: AvailabilityProps) {
  if (loading) return <span className="ui-field__hint">Checking what {account} holds…</span>;
  if (available === null) return null;
  const held = counted(available, symbol);
  if (Number(available) === 0)
    return (
      <span
        className={over ? 'ui-field__error' : 'ui-field__hint'}
        id={id}
        role={over ? 'alert' : undefined}
      >
        {account} has no {symbol} on {dayText(date)}
      </span>
    );
  const useAll = (
    <button type="button" className="ui-link" onClick={onUseAll}>
      Use all
    </button>
  );
  return over ? (
    <span className="ui-field__error" id={id} role="alert">
      Only {held} is available in {account} on {dayText(date)} · {useAll}
    </span>
  ) : (
    <span className="ui-field__hint" id={id}>
      Available in {account}: {held} · {useAll}
    </span>
  );
}

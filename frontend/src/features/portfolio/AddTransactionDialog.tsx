import { accountingApi } from '@api/accounting.api';
import { assetRewardsApi } from '@api/asset-rewards.api';
import { fxRatesApi } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import { ownedTransfersApi } from '@api/owned-transfers.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { type DependentOperation, tradesApi } from '@api/trades.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import AssetIcon from '../shell/AssetIcon';
import CloseButton from '../shell/CloseButton';
import { hiddenTokenSymbols } from '../wallets/WalletParts';
import { unitPrice } from './add-asset';
import {
  addDecimal,
  bankRate,
  compareDecimal,
  decimal,
  type EntryKind,
  type EntryProblem,
  entryFromOperation,
  entryKind,
  isCashOf,
  isPurposeKind,
  MAX_COMMENT_LENGTH,
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
  trimmed,
  usdTotal,
  valued,
  valueOptional,
  withDefaultTime,
} from './add-transaction';
import { money, price, quantity } from './format';

export interface Account {
  id: string;
  name: string;
  /** 0 for an account without a journal yet: its first trade starts one (OPS-ADD-BUY). */
  journalRevision: number;
}

const focusableFields =
  'a[href], button:not([disabled]), select:not([disabled]), textarea, input:not([disabled]):not([type="radio"]), input[type="radio"]:checked, summary';

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

const shortDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
/** Mar 1, 2026, as the prototype and the Transactions list write dates. */
export const dateText = (iso: string) => shortDate.format(new Date(iso));

/** The message of a 409 that names the transfer itself as the first operation left short. */
const OWN_SHORTFALL = 'An account does not hold enough for this transfer';

/** The operation a 409 names as depending on the change, if the server named one. */
export function dependentOf(error: unknown): DependentOperation | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  return isAxiosError(error) &&
    error.response?.status === 409 &&
    data?.dependent &&
    data.message !== OWN_SHORTFALL
    ? (data.dependent as DependentOperation)
    : null;
}

/** The account a new transfer would leave short, when the server named it. */
export function shortOf(error: unknown): DependentOperation | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  return isAxiosError(error) &&
    error.response?.status === 409 &&
    data?.dependent &&
    data.message === OWN_SHORTFALL
    ? (data.dependent as DependentOperation)
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

/** "Wallet A does not hold enough ETH on Mar 1, 2026 to move it." */
export const shortText = (account: string, coin: string, date: string) =>
  `${account} does not hold enough ${coin} on ${dateText(date)} for this transfer.`;
/**
 * The account's records start later than the transaction, so nothing can move in or out; with no
 * start date its records have not started: it was opened with balances.
 */
export const coverageText = (account: string, from: string | null, date: string) =>
  from === null
    ? `The records of ${account} have not started: it was opened with balances, so start them on Manual accounts first.`
    : `The records of ${account} start on ${dateText(from)}, after this transaction on ${dateText(date)}.`;

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
    return `${shortText(name(short.accountId), coin, short.occurredAt)} Add the receipts that bring it there first.`;
  if (coverage)
    return coverage.coverageFrom === null
      ? coverageText(name(coverage.accountId), null, date)
      : `${coverageText(name(coverage.accountId), coverage.coverageFrom, date)} Choose a later date.`;
  if (dependent)
    return `A later transaction on ${dateText(dependent.occurredAt)} spends these coins, so the account would not hold enough. Change that transaction first.`;
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
] as const satisfies readonly (readonly [EntryKind, string])[];
const isMoreKind = (kind: EntryKind) =>
  kind === 'reward' || kind === 'airdrop' || kind === 'fee' || kind.startsWith('gift');
/** Which records a type is saved as: an edit keeps to the same kind of record. */
const family = (kind: EntryKind) =>
  kind === 'transfer' ? 'transfer' : kind === 'reward' || kind === 'airdrop' ? 'reward' : 'trade';

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

// "Add transaction" from the accepted prototype: buy or sell, paid in USD, USDT, USDC, EUR or RUB.
export default function AddTransactionDialog({ onClose, onSaved, editing }: Props) {
  const [initial] = useState(() => (editing ? entryFromOperation(editing) : blankEntry()));
  const [kind, setKind] = useState<EntryKind>(() => (editing && entryKind(editing)) || 'buy');
  const [moreShown, setMoreShown] = useState(() => isMoreKind(kind));
  // A transfer's receiving account; the sending one is the account below.
  const [toAccountId, setToAccountId] = useState(editing?.counterAccount?.id ?? '');
  const [assets, setAssets] = useState<PortfolioAsset[] | null>(null);
  // Every asset, cash included: the account's cash in the paid currency is one of them.
  const [allAssets, setAllAssets] = useState<PortfolioAsset[]>([]);
  const [other, setOther] = useState<OtherAsset | null>(null);
  const otherRequest = useRef<{ ticker: string; requestId: string } | null>(null);
  // Latest market price in USD per asset, for the "Market today" hint.
  const [market, setMarket] = useState<ReadonlyMap<string, string>>(new Map());
  // The share of the portfolio of each asset held, for the order of the choices.
  const [allocation, setAllocation] = useState<ReadonlyMap<string, number>>(new Map());
  const [cashAvailability, setCashAvailability] = useState<Availability | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [accountId, setAccountId] = useState(editing?.account?.id ?? '');
  const [entry, setEntry] = useState<TransactionEntry>(initial);
  const [availability, setAvailability] = useState<Availability | null>(null);
  // An edit shows the price per unit the recorded amount and total imply.
  const [unit, setUnit] = useState(() => {
    const units = positive(initial.amount);
    const sum = positive(initial.total);
    return editing && units && sum ? derivedPrice(sum, units) : '';
  });
  // Which of price and total the owner typed last; an edit starts from the recorded total.
  const driver = useRef<'unit' | 'total'>(editing ? 'total' : 'unit');
  const [bank, setBank] = useState<{ key: string; rate: string | null } | null>(null);
  const [tried, setTried] = useState(false);
  // Fields the owner has left: their problems show on blur and clear as soon as the value is fixed.
  const [left, setLeft] = useState<ReadonlySet<EntryProblem>>(new Set());
  // The date and time the rate and balance lookups follow: they move when the owner leaves the
  // field, not on every keystroke of a half-typed date.
  const [settled, setSettled] = useState(() => ({ date: initial.date, time: initial.time }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ body: string; requestId: string } | null>(null);
  const id = useId();

  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const busy = useRef(false);
  busy.current = saving;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLElement>('input[type="radio"]:checked')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy.current) close.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(focusableFields)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    // TOKEN-HIDE: the coins of tokens the wallets leave out are not offered; the list still shows
    // them when the wallets cannot be read, and an edit keeps the asset it was recorded with.
    const hiddenTokens = walletAddressesApi
      .list()
      .then(hiddenTokenSymbols)
      .catch(() => new Set<string>());
    // The valuation is optional: the market hint and the order by allocation need it, nothing else.
    const valuation = portfolioValuationApi.get('USD').catch(() => null);
    Promise.all([portfolioAssetsApi.listAll(), journalAccounts(), hiddenTokens, valuation])
      .then(([allAssets, withJournal, hidden, report]) => {
        if (!live) return;
        const prices = new Map<string, string>();
        const shares = new Map<string, number>();
        for (const item of report?.assets ?? []) {
          if (item.priceSource === 'market' && item.price)
            prices.set(item.instrumentId, item.price.value);
          const share = Number(item.allocationPercent);
          if (share > 0) shares.set(item.instrumentId, share);
        }
        setMarket(prices);
        setAllocation(shares);
        const tradable = byAllocation(
          allAssets.filter(
            (asset) =>
              asset.id === initial.instrumentId ||
              (asset.assetType !== 'fiat' &&
                !(asset.assetType === 'crypto' && asset.symbol && hidden.has(asset.symbol))),
          ),
          shares,
        );
        setAssets(tradable);
        setAllAssets(allAssets);
        setAccounts(withJournal);
        if (!editing) {
          setAccountId(withJournal[0]?.id ?? '');
          setToAccountId(withJournal[1]?.id ?? '');
          setEntry((current) => ({ ...current, instrumentId: tradable[0]?.id ?? '' }));
        }
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [editing, initial.instrumentId]);

  // The Bank of Russia rate of the chosen date fills the rate field until the owner edits it.
  const settledEntry = { ...entry, ...settled };
  const rateKey = needsRate(entry.currency)
    ? `${entry.currency}:${rateDate(settledEntry, new Date(), Boolean(editing))}`
    : null;
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
  // While the date or time is still being typed the stored rate belongs to the old moment.
  const pending = settled.date !== entry.date || settled.time !== entry.time;
  const prefill = !pending && bank && bank.key === rateKey ? bank.rate : null;
  const rateLoading = rateKey !== null && (pending || bank?.key !== rateKey);
  // An edit keeps its recorded instant; a new entry for today without a time is now.
  const timed = editing ? entry : withDefaultTime(entry, new Date());
  const shown: TransactionEntry = entry.rateEdited ? timed : { ...timed, rate: prefill ?? '' };

  // A sale cannot take more than the account holds on its date or later (OPS-OVERSPEND), nor
  // can an expense, a gift sent, a fee or a transfer with its fee.
  const sell = spends(kind);
  const buy = kind === 'buy';
  const transfer = kind === 'transfer';
  const at = occurredAt(editing ? settledEntry : withDefaultTime(settledEntry, new Date()));
  const availableKey =
    sell &&
    accountId &&
    entry.instrumentId &&
    /^\d{4}-\d{2}-\d{2}$/.test(settled.date) &&
    (!settled.time || /^\d{2}:\d{2}$/.test(settled.time))
      ? `${accountId}|${entry.instrumentId}|${at}`
      : null;
  useEffect(() => {
    if (!availableKey) return;
    const [account, instrumentId, instant] = availableKey.split('|');
    let live = true;
    tradesApi
      .available(account, {
        instrumentId,
        at: instant,
        ...(editing ? { exclude: editing.id } : {}),
      })
      .then((result) => live && setAvailability({ key: availableKey, quantity: result.quantity }))
      .catch(() => live && setAvailability({ key: availableKey, quantity: null }));
    return () => {
      live = false;
    };
  }, [availableKey, editing]);
  const available =
    availableKey && availability?.key === availableKey ? availability.quantity : null;

  // A buy spends the account's cash in the paid currency first (OPS-BUY-CASH).
  const cashAsset = allAssets.find(
    (item) => isCashOf(item, entry.currency) && item.id !== entry.instrumentId,
  );
  const cashKey =
    buy &&
    // A new asset typed as the cash itself buys it, not with it.
    other?.ticker.trim().toUpperCase() !== entry.currency &&
    cashAsset &&
    accountId &&
    /^\d{4}-\d{2}-\d{2}$/.test(settled.date) &&
    (!settled.time || /^\d{2}:\d{2}$/.test(settled.time))
      ? `${accountId}|${cashAsset.id}|${at}`
      : null;
  useEffect(() => {
    if (!cashKey) return;
    const [account, instrumentId, instant] = cashKey.split('|');
    let live = true;
    tradesApi
      .available(account, {
        instrumentId,
        at: instant,
        ...(editing ? { exclude: editing.id } : {}),
      })
      .then((result) => live && setCashAvailability({ key: cashKey, quantity: result.quantity }))
      .catch(() => live && setCashAvailability({ key: cashKey, quantity: null }));
    return () => {
      live = false;
    };
  }, [cashKey, editing]);
  const cash = cashKey && cashAvailability?.key === cashKey ? cashAvailability.quantity : null;
  const typedAmount = positive(entry.amount);
  // A transfer's fee leaves the sending account in the same coin.
  const typedFee = transfer && entry.fee ? decimal(entry.fee) : null;
  const spent = typedAmount && typedFee ? addDecimal(typedAmount, typedFee) : typedAmount;
  const overspent = available !== null && spent !== null && compareDecimal(spent, available) > 0;

  const update = (value: Partial<TransactionEntry>) =>
    setEntry((current) => ({ ...current, ...value }));
  const asset = other ? undefined : assets?.find((item) => item.id === entry.instrumentId);
  const otherTicker = other?.ticker.trim().toUpperCase() ?? '';
  const otherValid = tickerPattern.test(otherTicker);
  const symbol = other ? otherTicker || 'units' : (asset?.symbol ?? 'units');
  const unitSymbol = other ? otherTicker || 'unit' : (asset?.symbol ?? asset?.name ?? 'unit');
  // A new asset's ticker stands in for its id until it is saved with the trade.
  const checked: TransactionEntry = other
    ? { ...shown, instrumentId: otherValid ? 'other' : '' }
    : shown;
  const all = problems(checked, today(), kind);
  const overshown = overspent && (tried || left.has('amount'));
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));
  /** Marks a field as left, so its problem, if any, shows from now on. */
  const leave = (problem: EntryProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  /** Date and time settle when focus leaves them, and the lookups follow. */
  const settle = (problem: 'date' | 'time') => () => {
    leave(problem)();
    setSettled({ date: entry.date, time: entry.time });
  };
  const priced = kind === 'buy' || kind === 'sell';
  const usd = priced ? usdTotal(shown) : null;
  const accountName = accounts?.find((item) => item.id === accountId)?.name ?? 'This account';
  const sameAccount = transfer && toAccountId === accountId;
  const fewAccounts = transfer && (accounts?.length ?? 0) < 2;
  // Use all leaves room for a transfer's fee.
  const useAll = () => {
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
  // was typed (or recorded) is never recomputed from the shown, rounded price.
  const setAmount = (amount: string) => {
    const units = positive(amount);
    if (driver.current === 'total') {
      update({ amount });
      const sum = positive(entry.total);
      if (units && sum) setUnit(derivedPrice(sum, units));
      return;
    }
    const each = positive(unit);
    update({
      amount,
      ...(units && each ? { total: trimmed(Number(units) * Number(each), 2) } : {}),
    });
  };
  const setUnitPrice = (value: string) => {
    driver.current = 'unit';
    setUnit(value);
    const units = positive(entry.amount);
    const each = positive(value);
    if (units && each) update({ total: trimmed(Number(units) * Number(each), 2) });
  };
  const setTotal = (total: string) => {
    driver.current = 'total';
    update({ total });
    const units = positive(entry.amount);
    const sum = positive(total);
    if (units && sum) setUnit(derivedPrice(sum, units));
  };

  // The asset's latest market price in the price field's currency (prototype "Market today").
  const marketUsd = asset ? market.get(asset.id) : undefined;
  const rateShown = needsRate(entry.currency) ? positive(shown.rate) : '1';
  const marketPrice =
    marketUsd && rateShown ? priceFigure(Number(marketUsd) * Number(rateShown)) : null;
  // What the amount is worth at today's market price, for the Value field.
  const marketValue =
    marketUsd && typedAmount ? trimmed(Number(marketUsd) * Number(typedAmount), 2) : null;

  // How much of the buy the account's cash pays; the rest is money from outside.
  const totalTyped = positive(shown.total);
  const fromCash =
    cash !== null && totalTyped !== null && Number(cash) > 0
      ? compareDecimal(cash, totalTyped) < 0
        ? cash
        : totalTyped
      : null;

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
    if (problems(checked, today(), kind).size || !account || overspent) return;
    if (transfer && (!receiver || sameAccount)) return;
    setSaving(true);
    setError(null);
    try {
      const instrumentId = other ? await otherAssetId() : shown.instrumentId;
      const traded = allAssets.find((item) => item.id === instrumentId);
      const record = { ...shown, instrumentId };
      // An edit at the same date and time keeps the operation's exact instant and place in it.
      const sameMoment = editing && occurredAt(shown) === occurredAt(initial);
      const order = sameMoment ? editing.orderWithinTimestamp : undefined;
      const instant = sameMoment ? { occurredAt: editing.occurredAt } : {};
      // The same typed request keeps its request id, so a retry never saves it twice.
      const requestId = (body: object) => {
        const key = JSON.stringify({ accountId, toAccountId, kind, ...body });
        if (attempt.current?.body !== key)
          attempt.current = { body: key, requestId: newRequestId() };
        return attempt.current.requestId;
      };
      if (transfer && receiver) {
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
        else await ownedTransfersApi.create({ ...saved, fromAccountId: accountId, toAccountId });
      } else if (kind === 'reward' || kind === 'airdrop') {
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
          await assetRewardsApi.correct(accountId, editing.id.replace(/^reward:/, ''), {
            ...saved,
            expectedVersion: editing.version ?? 0,
          });
        else await assetRewardsApi.create(accountId, saved);
      } else {
        const identity = { requestId: '', expectedJournalRevision: account.journalRevision };
        const command = {
          ...(isPurposeKind(kind)
            ? purposeTradeFromEntry(record, kind, identity, order)
            : tradeFromEntry(
                record,
                identity,
                order,
                !(traded && isCashOf(traded, entry.currency)),
              )),
          ...instant,
        };
        const saved = { ...command, requestId: requestId(command) };
        if (editing) await tradesApi.correct(accountId, editing.id.replace(/^trade:/, ''), saved);
        else await tradesApi.create(accountId, saved);
      }
      onSaved();
    } catch (caught) {
      setError(failure(caught, accounts, symbol, occurredAt(shown)));
      setSaving(false);
    }
  };

  const fieldError = (problem: EntryProblem, text = problemText[problem]) =>
    found.has(problem) && (
      <span className="portfolio-field__error" id={`${id}-${problem}-error`}>
        {text}
      </span>
    );
  const invalid = (problem: EntryProblem) =>
    found.has(problem)
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` }
      : {};
  const ready = assets !== null && accounts !== null;
  const { shown: shownAssets, more: moreAssets } = splitAssets(
    assets ?? [],
    entry.instrumentId,
    market,
    allocation,
  );

  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog portfolio-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <form onSubmit={submit} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id={`${id}-title`}>{editing ? 'Edit transaction' : 'Add transaction'}</h2>
            <CloseButton onClick={onClose} disabled={saving} />
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <span id={`${id}-type`} className="portfolio-field__label">
                Type
              </span>
              <div className="portfolio-types">
                <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-type`}>
                  {mainKinds.map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name={`${id}-kind`}
                        value={value}
                        checked={kind === value}
                        disabled={Boolean(editing) && family(value) !== family(kind)}
                        onChange={() => choose(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="portfolio-types__more"
                  aria-expanded={moreShown}
                  aria-controls={`${id}-more-types`}
                  onClick={() => setMoreShown(!moreShown)}
                >
                  More {moreShown ? '▴' : '▾'}
                </button>
              </div>
              {moreShown && (
                <div
                  id={`${id}-more-types`}
                  className="shell-seg"
                  role="radiogroup"
                  aria-label="More types"
                >
                  {moreKinds.map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name={`${id}-kind`}
                        value={value}
                        checked={
                          value === 'gift-received' ? kind.startsWith('gift') : kind === value
                        }
                        disabled={Boolean(editing) && family(value) !== family(kind)}
                        onChange={() => choose(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
              {kind.startsWith('gift') && (
                <div className="shell-seg" role="radiogroup" aria-label="Gift">
                  {(
                    [
                      ['gift-received', 'Received'],
                      ['gift-sent', 'Sent'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name={`${id}-gift`}
                        value={value}
                        checked={kind === value}
                        onChange={() => choose(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {loadFailed ? (
              <p className="portfolio-dialog__error" role="alert">
                Could not load your assets and accounts. Close this window and try again.
              </p>
            ) : !ready ? (
              <p className="portfolio-field__hint" role="status">
                Loading your assets and accounts…
              </p>
            ) : accounts.length === 0 || assets.length === 0 ? (
              <p className="shell-note" role="status">
                {accounts.length === 0 ? (
                  <>
                    Add a wallet first on the <Link to="/wallets">Wallets</Link> page, or an asset
                    with a balance on the Portfolio page.
                  </>
                ) : (
                  'Add an asset first on the Portfolio page, then record its trades.'
                )}
              </p>
            ) : (
              <>
                <div className="portfolio-field">
                  <span id={`${id}-asset`} className="portfolio-field__label">
                    Asset
                  </span>
                  <div className="portfolio-chips" role="group" aria-labelledby={`${id}-asset`}>
                    {shownAssets.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="portfolio-chip portfolio-chip--asset"
                        aria-pressed={!other && entry.instrumentId === item.id}
                        onClick={() => {
                          setOther(null);
                          update({ instrumentId: item.id });
                        }}
                      >
                        <AssetIcon
                          symbol={item.symbol}
                          name={item.name}
                          assetType={item.assetType}
                          size="sm"
                        />
                        {item.symbol ?? item.name}
                      </button>
                    ))}
                    {moreAssets.length > 0 && (
                      <select
                        className="portfolio-input portfolio-chip-select"
                        aria-label="More assets"
                        value=""
                        onChange={(event) => {
                          setOther(null);
                          update({ instrumentId: event.target.value });
                        }}
                      >
                        <option value="">More assets…</option>
                        {moreAssets.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.symbol ? `${item.symbol} · ${item.name}` : item.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {!sell && !editing && (
                      <button
                        type="button"
                        className="portfolio-chip portfolio-chip--asset"
                        aria-pressed={other !== null}
                        onClick={() => setOther(other ?? { ticker: '', name: '' })}
                      >
                        + Other asset
                      </button>
                    )}
                  </div>
                  {other ? null : fieldError('instrument')}
                </div>
                {other && (
                  <div className="portfolio-row">
                    <div className="portfolio-field">
                      <label className="portfolio-field__label" htmlFor={`${id}-ticker`}>
                        Ticker
                      </label>
                      <input
                        id={`${id}-ticker`}
                        className="portfolio-input"
                        placeholder="e.g. TON"
                        autoComplete="off"
                        value={other.ticker}
                        onChange={(event) => setOther({ ...other, ticker: event.target.value })}
                        onBlur={leave('instrument')}
                        {...invalid('instrument')}
                      />
                      {fieldError('instrument', 'Enter the ticker: letters and digits, up to 32')}
                    </div>
                    <div className="portfolio-field">
                      <label className="portfolio-field__label" htmlFor={`${id}-name`}>
                        Name (optional)
                      </label>
                      <input
                        id={`${id}-name`}
                        className="portfolio-input"
                        placeholder={otherTicker || 'Toncoin'}
                        autoComplete="off"
                        maxLength={120}
                        value={other.name}
                        onChange={(event) => setOther({ ...other, name: event.target.value })}
                      />
                    </div>
                  </div>
                )}
                <div className="portfolio-row">
                  <div className="portfolio-field">
                    <label className="portfolio-field__label" htmlFor={`${id}-amount`}>
                      Amount
                    </label>
                    <span className="portfolio-affix">
                      <input
                        id={`${id}-amount`}
                        className="portfolio-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={entry.amount}
                        onChange={(event) => setAmount(event.target.value)}
                        onBlur={leave('amount')}
                        {...(overshown
                          ? { 'aria-invalid': true, 'aria-describedby': `${id}-available` }
                          : invalid('amount'))}
                      />
                      <span className="portfolio-affix__suffix">{symbol}</span>
                    </span>
                    {fieldError('amount', numberProblem(entry.amount, problemText.amount)) ||
                      (sell && (
                        <Availability
                          id={`${id}-available`}
                          account={accountName}
                          symbol={symbol}
                          date={at}
                          available={available}
                          loading={availableKey !== null && availability?.key !== availableKey}
                          over={overshown}
                          onUseAll={useAll}
                        />
                      ))}
                  </div>
                  <div className="portfolio-field">
                    <label className="portfolio-field__label" htmlFor={`${id}-date`}>
                      Date
                    </label>
                    <input
                      id={`${id}-date`}
                      className="portfolio-input"
                      type="date"
                      max={today()}
                      value={entry.date}
                      onChange={(event) => update({ date: event.target.value })}
                      onBlur={settle('date')}
                      {...invalid('date')}
                    />
                    {fieldError('date')}
                  </div>
                </div>
                {priced && (
                  <>
                    <div className="portfolio-row">
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-unit`}>
                          Price per {unitSymbol}
                        </label>
                        <span className="portfolio-affix">
                          <input
                            id={`${id}-unit`}
                            className="portfolio-input"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={unit}
                            onChange={(event) => setUnitPrice(event.target.value)}
                          />
                          <span className="portfolio-affix__suffix">{entry.currency}</span>
                        </span>
                        {marketPrice && (
                          <span className="portfolio-field__hint">
                            Market today{' '}
                            {needsRate(entry.currency)
                              ? `${quantity(marketPrice)} ${entry.currency}`
                              : price(marketUsd ?? null, 'USD')}{' '}
                            ·{' '}
                            <button
                              type="button"
                              className="portfolio-link"
                              onClick={() => setUnitPrice(marketPrice)}
                            >
                              Use
                            </button>
                          </span>
                        )}
                      </div>
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-total`}>
                          {buy ? 'Total paid' : 'Total received'}
                        </label>
                        <span className="portfolio-affix">
                          <input
                            id={`${id}-total`}
                            className="portfolio-input"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={entry.total}
                            onChange={(event) => setTotal(event.target.value)}
                            onBlur={leave('total')}
                            {...invalid('total')}
                          />
                          <span className="portfolio-affix__suffix">{entry.currency}</span>
                        </span>
                        {fieldError(
                          'total',
                          buy ? 'Enter what you paid' : 'Enter what you received',
                        )}
                      </div>
                    </div>
                    <div className="portfolio-field">
                      <span id={`${id}-currency`} className="portfolio-field__label">
                        {buy ? 'Paid in' : 'Received in'}
                      </span>
                      <div
                        className="shell-seg"
                        role="radiogroup"
                        aria-labelledby={`${id}-currency`}
                      >
                        {paidIn.map((code: PaidIn) => (
                          <label key={code}>
                            <input
                              type="radio"
                              name={`${id}-currency`}
                              value={code}
                              checked={entry.currency === code}
                              onChange={() =>
                                update({ currency: code, rate: '', rateEdited: false })
                              }
                            />
                            {code}
                          </label>
                        ))}
                      </div>
                      {(entry.currency === 'USDT' || entry.currency === 'USDC') && (
                        <span className="portfolio-field__hint">
                          {entry.currency} is counted 1:1 with USD.
                        </span>
                      )}
                      {sell
                        ? !(asset && isCashOf(asset, entry.currency)) && (
                            <span className="portfolio-field__hint">
                              The {entry.currency} received stays in {accountName} as cash.
                            </span>
                          )
                        : fromCash !== null &&
                          totalTyped !== null && (
                            <span className="portfolio-field__hint">
                              {compareDecimal(fromCash, totalTyped) === 0
                                ? `Paid from the ${entry.currency} cash in ${accountName}.`
                                : `${quantity(fromCash)} ${entry.currency} comes from the cash in ${accountName}; the other ${quantity(trimmed(Number(totalTyped) - Number(fromCash), 8))} ${entry.currency} is new money.`}
                            </span>
                          )}
                    </div>
                    {needsRate(entry.currency) && (
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-rate`}>
                          Exchange rate
                        </label>
                        <span className="portfolio-affix portfolio-affix--wide">
                          <input
                            id={`${id}-rate`}
                            className="portfolio-input"
                            inputMode="decimal"
                            placeholder={rateLoading ? 'Loading…' : ''}
                            value={shown.rate}
                            onChange={(event) =>
                              update({ rate: event.target.value, rateEdited: true })
                            }
                            aria-describedby={`${id}-rate-hint`}
                            onBlur={leave('rate')}
                            {...invalid('rate')}
                          />
                          <span className="portfolio-affix__suffix">
                            {entry.currency} per 1 USD
                          </span>
                        </span>
                        {fieldError('rate')}
                        <span className="portfolio-field__hint" id={`${id}-rate-hint`}>
                          {entry.rateEdited
                            ? 'Your rate is used for this transaction. '
                            : prefill
                              ? 'Bank of Russia rate on the selected date, filled in automatically. Change it if you paid a different rate. '
                              : rateLoading
                                ? ''
                                : 'No Bank of Russia rate is stored for this date; enter the rate you paid. '}
                          {entry.rateEdited && prefill && (
                            <button
                              type="button"
                              className="portfolio-link"
                              onClick={() => update({ rate: '', rateEdited: false })}
                            >
                              Use Bank of Russia rate {prefill}
                            </button>
                          )}
                          {!entry.rateEdited && 'Totals are kept in USD.'}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {valued(kind) && (
                  <div className="portfolio-field">
                    <label className="portfolio-field__label" htmlFor={`${id}-total`}>
                      Value{valueOptional(kind) ? ' (optional)' : ''}
                    </label>
                    <span className="portfolio-affix">
                      <input
                        id={`${id}-total`}
                        className="portfolio-input"
                        inputMode="decimal"
                        placeholder={marketValue ?? '0.00'}
                        value={entry.total}
                        onChange={(event) => update({ total: event.target.value })}
                        aria-describedby={`${id}-value-hint`}
                        onBlur={leave('total')}
                        {...invalid('total')}
                      />
                      <span className="portfolio-affix__suffix">USD</span>
                    </span>
                    {fieldError(
                      'total',
                      numberProblem(entry.total, 'Enter what it was worth on that date'),
                    )}
                    <span className="portfolio-field__hint" id={`${id}-value-hint`}>
                      What it was worth on that date. {valueHints[kind]}
                      {marketValue && (
                        <>
                          {' '}
                          Market today {money(marketValue, 'USD')} ·{' '}
                          <button
                            type="button"
                            className="portfolio-link"
                            onClick={() => update({ total: marketValue })}
                          >
                            Use
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )}
                {transfer ? (
                  <>
                    <div className="portfolio-row">
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-account`}>
                          From
                        </label>
                        <select
                          id={`${id}-account`}
                          className="portfolio-input"
                          value={accountId}
                          disabled={Boolean(editing)}
                          onChange={(event) => setAccountId(event.target.value)}
                        >
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-to`}>
                          To
                        </label>
                        <select
                          id={`${id}-to`}
                          className="portfolio-input"
                          value={toAccountId}
                          disabled={Boolean(editing)}
                          onChange={(event) => setToAccountId(event.target.value)}
                          {...(tried && sameAccount
                            ? { 'aria-invalid': true, 'aria-describedby': `${id}-to-error` }
                            : {})}
                        >
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                        {tried && sameAccount && (
                          <span className="portfolio-field__error" id={`${id}-to-error`}>
                            Choose a different wallet
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="portfolio-field__hint">
                      {fewAccounts
                        ? 'Add a second wallet or account to move coins between them.'
                        : 'Transfers move coins between your wallets and keep their purchase price. No price needed.'}
                    </p>
                  </>
                ) : (
                  <div className="portfolio-field">
                    <label className="portfolio-field__label" htmlFor={`${id}-account`}>
                      Wallet or account
                    </label>
                    <select
                      id={`${id}-account`}
                      className="portfolio-input"
                      value={accountId}
                      disabled={Boolean(editing)}
                      onChange={(event) => setAccountId(event.target.value)}
                    >
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <details
                  className="portfolio-more"
                  open={
                    Boolean(entry.time || entry.fee || entry.comment) ||
                    found.has('time') ||
                    found.has('fee') ||
                    found.has('comment')
                  }
                >
                  <summary>
                    {priced || transfer
                      ? 'More options: time, fee, comment'
                      : 'More options: time, comment'}
                  </summary>
                  <div className="portfolio-row">
                    <div className="portfolio-field">
                      <label className="portfolio-field__label" htmlFor={`${id}-time`}>
                        Time, UTC (optional)
                      </label>
                      <input
                        id={`${id}-time`}
                        className="portfolio-input"
                        type="time"
                        value={entry.time}
                        onChange={(event) => update({ time: event.target.value })}
                        onBlur={settle('time')}
                        {...invalid('time')}
                      />
                      {fieldError('time')}
                    </div>
                    {(priced || transfer) && (
                      <div className="portfolio-field">
                        <label className="portfolio-field__label" htmlFor={`${id}-fee`}>
                          Fee (optional)
                        </label>
                        <span className="portfolio-affix">
                          <input
                            id={`${id}-fee`}
                            className="portfolio-input"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={entry.fee}
                            onChange={(event) => update({ fee: event.target.value })}
                            onBlur={leave('fee')}
                            {...invalid('fee')}
                          />
                          <span className="portfolio-affix__suffix">
                            {transfer ? symbol : entry.currency}
                          </span>
                        </span>
                        {fieldError('fee', numberProblem(entry.fee, problemText.fee))}
                      </div>
                    )}
                  </div>
                  <div className="portfolio-field">
                    <label className="portfolio-field__label" htmlFor={`${id}-comment`}>
                      Comment
                    </label>
                    <textarea
                      id={`${id}-comment`}
                      className="portfolio-input portfolio-textarea"
                      placeholder="Optional"
                      value={entry.comment}
                      onChange={(event) => update({ comment: event.target.value })}
                      onBlur={leave('comment')}
                      {...invalid('comment')}
                    />
                    {fieldError('comment')}
                  </div>
                </details>
              </>
            )}
            {error && (
              <p className="portfolio-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="portfolio-dialog__foot">
            <span className="portfolio-dialog__summary">
              {usd !== null && `${buy ? 'Cost' : 'Proceeds'} ${money(String(usd), 'USD')}`}
              {valued(kind) &&
                positive(entry.total) !== null &&
                `Value ${money(positive(entry.total), 'USD')}`}
            </span>
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="shell-button shell-button--primary"
              disabled={
                saving ||
                (priced && rateLoading) ||
                !ready ||
                !accounts?.length ||
                !assets?.length ||
                fewAccounts
              }
            >
              {editing ? 'Save changes' : 'Save transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  if (loading) return <span className="portfolio-field__hint">Checking what {account} holds…</span>;
  if (available === null) return null;
  const held = `${quantity(available)} ${symbol}`;
  if (Number(available) === 0)
    return (
      <span
        className={over ? 'portfolio-field__error' : 'portfolio-field__hint'}
        id={id}
        role={over ? 'alert' : undefined}
      >
        {account} has no {symbol} on {dateText(date)}
      </span>
    );
  const useAll = (
    <button type="button" className="portfolio-link" onClick={onUseAll}>
      Use all
    </button>
  );
  return over ? (
    <span className="portfolio-field__error" id={id} role="alert">
      Only {held} is available in {account} on {dateText(date)} · {useAll}
    </span>
  ) : (
    <span className="portfolio-field__hint" id={id}>
      Available in {account}: {held} · {useAll}
    </span>
  );
}

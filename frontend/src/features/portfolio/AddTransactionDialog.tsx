import { accountingApi } from '@api/accounting.api';
import { fxRatesApi } from '@api/fx-rates.api';
import type { Operation } from '@api/operations.api';
import { type PortfolioAsset, portfolioAssetsApi } from '@api/portfolio-assets.api';
import { type DependentOperation, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import AssetIcon from '../shell/AssetIcon';
import {
  bankRate,
  compareDecimal,
  type EntryProblem,
  entryFromOperation,
  MAX_COMMENT_LENGTH,
  needsRate,
  occurredAt,
  type PaidIn,
  paidIn,
  positive,
  problems,
  type TransactionEntry,
  tradeFromEntry,
  trimmed,
  usdTotal,
} from './add-transaction';
import { money, quantity } from './format';

interface Account {
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

/** The operation a 409 names as depending on the change, if the server named one. */
export function dependentOf(error: unknown): DependentOperation | null {
  const data = isAxiosError(error) ? error.response?.data : undefined;
  return isAxiosError(error) && error.response?.status === 409 && data?.dependent
    ? (data.dependent as DependentOperation)
    : null;
}

function failure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  const dependent = dependentOf(error);
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not save the transaction twice.';
  if (status === 409 && message.includes('Bank of Russia rate'))
    return 'No Bank of Russia rate is stored for this date. Enter the rate you paid.';
  if (dependent)
    return `A later transaction on ${dateText(dependent.occurredAt)} spends these coins, so the account would not hold enough. Change that transaction first.`;
  if (status === 409 || status === 422)
    return 'This transaction does not fit the saved history: the account may not hold that much on this date, or it was changed elsewhere. Close this window and try again.';
  if (status === 400) return 'Check the fields and try again.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not save the transaction. Try again.';
}

const today = () => new Date().toISOString().slice(0, 10);

async function journalAccounts(): Promise<Account[]> {
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
  /** A recorded buy or sell to correct (OPS-EDIT); without it the window adds one. */
  editing?: Operation;
}

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

// "Add transaction" from the accepted prototype: buy or sell, paid in USD, USDT, USDC, EUR or RUB.
export default function AddTransactionDialog({ onClose, onSaved, editing }: Props) {
  const [initial] = useState(() => (editing ? entryFromOperation(editing) : blankEntry()));
  const [assets, setAssets] = useState<PortfolioAsset[] | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [accountId, setAccountId] = useState(editing?.account?.id ?? '');
  const [entry, setEntry] = useState<TransactionEntry>(initial);
  const [availability, setAvailability] = useState<Availability | null>(null);
  // An edit shows the price per unit the recorded amount and total imply.
  const [unit, setUnit] = useState(() => {
    const units = positive(initial.amount);
    const sum = positive(initial.total);
    return editing && units && sum ? trimmed(Number(sum) / Number(units), 2) : '';
  });
  const [bank, setBank] = useState<{ key: string; rate: string | null } | null>(null);
  const [tried, setTried] = useState(false);
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
    Promise.all([portfolioAssetsApi.listAll(), journalAccounts()])
      .then(([allAssets, withJournal]) => {
        if (!live) return;
        const tradable = allAssets.filter(
          (asset) => asset.assetType !== 'fiat' || asset.id === initial.instrumentId,
        );
        setAssets(tradable);
        setAccounts(withJournal);
        if (!editing) {
          setAccountId(withJournal[0]?.id ?? '');
          setEntry((current) => ({ ...current, instrumentId: tradable[0]?.id ?? '' }));
        }
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [editing, initial.instrumentId]);

  // The Bank of Russia rate of the chosen date fills the rate field until the owner edits it.
  const rateKey = needsRate(entry.currency) ? `${entry.currency}:${entry.date}` : null;
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
  const prefill = bank && bank.key === rateKey ? bank.rate : null;
  const rateLoading = rateKey !== null && bank?.key !== rateKey;
  const shown: TransactionEntry = entry.rateEdited ? entry : { ...entry, rate: prefill ?? '' };

  // A sale cannot take more than the account holds on its date or later (OPS-OVERSPEND).
  const sell = entry.side === 'sell';
  const at = occurredAt(entry);
  const availableKey =
    sell &&
    accountId &&
    entry.instrumentId &&
    /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    (!entry.time || /^\d{2}:\d{2}$/.test(entry.time))
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
        ...(editing ? { excludeTradeId: editing.id.replace(/^trade:/, '') } : {}),
      })
      .then((result) => live && setAvailability({ key: availableKey, quantity: result.quantity }))
      .catch(() => live && setAvailability({ key: availableKey, quantity: null }));
    return () => {
      live = false;
    };
  }, [availableKey, editing]);
  const available =
    availableKey && availability?.key === availableKey ? availability.quantity : null;
  const typedAmount = positive(entry.amount);
  const overspent =
    available !== null && typedAmount !== null && compareDecimal(typedAmount, available) > 0;

  const update = (value: Partial<TransactionEntry>) =>
    setEntry((current) => ({ ...current, ...value }));
  const asset = assets?.find((item) => item.id === entry.instrumentId);
  const symbol = asset?.symbol ?? 'units';
  const unitSymbol = asset?.symbol ?? asset?.name ?? 'unit';
  const found = tried ? problems(shown, today()) : new Set<EntryProblem>();
  const usd = usdTotal(shown);
  const buy = entry.side === 'buy';
  const accountName = accounts?.find((item) => item.id === accountId)?.name ?? 'This account';
  const useAll = () => available !== null && setAmount(available);

  // Price per unit and total follow each other: the field typed last decides.
  const setAmount = (amount: string) => {
    const units = positive(amount);
    const each = positive(unit);
    update({
      amount,
      ...(units && each ? { total: trimmed(Number(units) * Number(each), 2) } : {}),
    });
  };
  const setUnitPrice = (value: string) => {
    setUnit(value);
    const units = positive(entry.amount);
    const each = positive(value);
    if (units && each) update({ total: trimmed(Number(units) * Number(each), 2) });
  };
  const setTotal = (total: string) => {
    update({ total });
    const units = positive(entry.amount);
    const sum = positive(total);
    if (units && sum) setUnit(trimmed(Number(sum) / Number(units), 2));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const account = accounts?.find((item) => item.id === accountId);
    if (problems(shown, today()).size || !account || overspent) return;
    // An edit at the same date and time keeps the trade's exact instant and place in it.
    const sameMoment = editing && occurredAt(shown) === occurredAt(initial);
    const command = tradeFromEntry(
      shown,
      { requestId: '', expectedJournalRevision: account.journalRevision },
      sameMoment ? editing.orderWithinTimestamp : undefined,
    );
    if (sameMoment) command.occurredAt = editing.occurredAt;
    const key = JSON.stringify({ accountId, ...command });
    if (attempt.current?.body !== key) attempt.current = { body: key, requestId: newRequestId() };
    setSaving(true);
    setError(null);
    try {
      const saved = { ...command, requestId: attempt.current.requestId };
      if (editing) await tradesApi.correct(accountId, editing.id.replace(/^trade:/, ''), saved);
      else await tradesApi.create(accountId, saved);
      onSaved();
    } catch (caught) {
      setError(failure(caught));
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
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <span id={`${id}-type`} className="portfolio-field__label">
                Type
              </span>
              <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-type`}>
                {(
                  [
                    ['buy', 'Buy'],
                    ['sell', 'Sell'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${id}-side`}
                      value={value}
                      checked={entry.side === value}
                      onChange={() => update({ side: value })}
                    />
                    {label}
                  </label>
                ))}
              </div>
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
                {accounts.length === 0
                  ? 'Add a wallet or account first on the '
                  : 'Add an asset first on the Portfolio page, then record its trades. '}
                {accounts.length === 0 && (
                  <>
                    <Link to="/manual-accounts">manual accounts</Link> page.
                  </>
                )}
              </p>
            ) : (
              <>
                <div className="portfolio-field">
                  <span id={`${id}-asset`} className="portfolio-field__label">
                    Asset
                  </span>
                  <div className="portfolio-chips" role="group" aria-labelledby={`${id}-asset`}>
                    {assets.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="portfolio-chip portfolio-chip--asset"
                        aria-pressed={entry.instrumentId === item.id}
                        onClick={() => update({ instrumentId: item.id })}
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
                  </div>
                  {fieldError('instrument')}
                </div>
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
                        {...(overspent
                          ? { 'aria-invalid': true, 'aria-describedby': `${id}-available` }
                          : invalid('amount'))}
                      />
                      <span className="portfolio-affix__suffix">{symbol}</span>
                    </span>
                    {fieldError('amount') ||
                      (sell && (
                        <Availability
                          id={`${id}-available`}
                          account={accountName}
                          symbol={symbol}
                          date={at}
                          available={available}
                          loading={availableKey !== null && availability?.key !== availableKey}
                          over={overspent}
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
                      {...invalid('date')}
                    />
                    {fieldError('date')}
                  </div>
                </div>
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
                        {...invalid('total')}
                      />
                      <span className="portfolio-affix__suffix">{entry.currency}</span>
                    </span>
                    {fieldError('total', buy ? 'Enter what you paid' : 'Enter what you received')}
                  </div>
                </div>
                <div className="portfolio-field">
                  <span id={`${id}-currency`} className="portfolio-field__label">
                    {buy ? 'Paid in' : 'Received in'}
                  </span>
                  <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-currency`}>
                    {paidIn.map((code: PaidIn) => (
                      <label key={code}>
                        <input
                          type="radio"
                          name={`${id}-currency`}
                          value={code}
                          checked={entry.currency === code}
                          onChange={() => update({ currency: code, rate: '', rateEdited: false })}
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
                        onChange={(event) => update({ rate: event.target.value, rateEdited: true })}
                        aria-describedby={`${id}-rate-hint`}
                        {...invalid('rate')}
                      />
                      <span className="portfolio-affix__suffix">{entry.currency} per 1 USD</span>
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
                <details
                  className="portfolio-more"
                  open={
                    Boolean(entry.time || entry.fee || entry.comment) ||
                    found.has('time') ||
                    found.has('fee') ||
                    found.has('comment')
                  }
                >
                  <summary>More options: time, fee, comment</summary>
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
                        {...invalid('time')}
                      />
                      {fieldError('time')}
                    </div>
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
                          {...invalid('fee')}
                        />
                        <span className="portfolio-affix__suffix">{entry.currency}</span>
                      </span>
                      {fieldError('fee')}
                    </div>
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
              disabled={saving || rateLoading || !ready || !accounts?.length || !assets?.length}
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

import type { PortfolioAsset } from '@api/portfolio-assets.api';
import { tradesApi } from '@api/trades.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Affix, Input, Select, Textarea } from '@/ui/inputs';
import { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { dayText } from '@/utils/dates';
import { newRequestId } from '../accounting/feedback';
import type { Account } from './AddTransactionDialog';
import {
  compareDecimal,
  decimal,
  isCashOf,
  numberProblem,
  occurredAt,
  positive,
  withDefaultTime,
} from './add-transaction';
import {
  type CashCurrency,
  type ConvertEntry,
  type ConvertProblem,
  cashCurrencies,
  convertProblems,
  convertTrade,
  rateText,
} from './convert';
import { useFocusFirstProblem } from './focus-problem';
import { quantity } from './format';
import './portfolio.css';

const problemText: Record<ConvertProblem, string> = {
  currency: 'Choose two different currencies',
  amount: 'Enter an amount greater than 0',
  received: 'Enter what you received',
  date: 'Choose a date, today or earlier',
  time: 'Enter the time as HH:MM',
  comment: 'Keep the comment within 500 characters',
};

const today = () => new Date().toISOString().slice(0, 10);

/** What a refused or lost save means for a conversion. */
function failure(error: unknown, account: string, from: CashCurrency, date: string): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  if (status === undefined)
    return 'Could not reach the server. Try again; the same request will not save the conversion twice.';
  if (status === 409 && message.includes('Bank of Russia rate'))
    return 'No Bank of Russia rate is stored for this date, so the euros or rubles cannot be valued in USD. Choose another date.';
  if (status === 409 && message.includes('does not hold enough'))
    return `${account} does not hold enough ${from} cash on ${dayText(date)}. Add the cash that brings it there first.`;
  if (status === 409 || status === 422)
    return 'This conversion does not fit the saved history: the account may not hold that much on this date, or it was changed elsewhere. Close this window and try again.';
  if (status === 400) return 'Check the fields and try again.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  return 'Could not save the conversion. Try again.';
}

interface Props {
  /** The id of the window's title, which the header carries. */
  titleId: string;
  /** The Type choice of the Add transaction window, which this body sits under. */
  typeField: ReactNode;
  /** Null while the accounts load. */
  accounts: Account[] | null;
  /** Every asset, cash included. */
  assets: readonly PortfolioAsset[] | null;
  loadFailed: boolean;
  /** The account that holds the most of an asset now, if one does. */
  holderOf: (instrumentId: string) => Promise<string | null>;
  onClose: () => void;
  onSaved: () => void;
  /** Tells the window a save is in flight, so Escape does not close it meanwhile. */
  onSaving: (saving: boolean) => void;
}

/**
 * "Convert" (CASH-CONVERT): cash in one currency becomes cash in another in the same account.
 * One sale of the cash given up, settled in the cash received, so the balance of each currency
 * moves together, the sale cannot take more than the account holds, and nothing counts as money
 * added or taken out.
 */
export default function ConvertForm({
  titleId,
  typeField,
  accounts,
  assets,
  loadFailed,
  holderOf,
  onClose,
  onSaved,
  onSaving,
}: Props) {
  const id = useId();
  const toast = useToast();
  const { form, refused } = useFocusFirstProblem();
  const [entry, setEntry] = useState<ConvertEntry>(() => ({
    from: 'RUB',
    to: 'USD',
    amount: '',
    received: '',
    date: today(),
    time: '',
    comment: '',
  }));
  const [accountId, setAccountId] = useState('');
  const accountTouched = useRef(false);
  const [availability, setAvailability] = useState<{ key: string; quantity: string | null } | null>(
    null,
  );
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<ConvertProblem>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => onSaving(saving), [saving, onSaving]);
  useEffect(() => () => onSaving(false), [onSaving]);
  // The same typed conversion keeps its request id, so a retry never saves it twice.
  // The instant a time-less entry dated today resolved to is kept with it, so a retry after the
  // minute changed is the same request.
  const attempt = useRef<{ inputs: string; requestId: string; sale: ConvertEntry } | null>(null);

  const update = (changes: Partial<ConvertEntry>) =>
    setEntry((current) => ({ ...current, ...changes }));
  const leave = (problem: ConvertProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));

  // Picking the currency the other side has turns the other side around instead of refusing.
  const chooseFrom = (from: CashCurrency) =>
    update(from === entry.to ? { from, to: entry.from } : { from });
  const chooseTo = (to: CashCurrency) =>
    update(to === entry.from ? { to, from: entry.to } : { to });

  const fromAsset = assets?.find((item) => isCashOf(item, entry.from));
  const ready = accounts !== null && assets !== null;
  const account = accounts?.find((item) => item.id === accountId);

  // The account starts as the one holding the most of the cash given up, unless the owner chose.
  useEffect(() => {
    if (!accounts?.length || accountTouched.current) return;
    let live = true;
    const first = accounts[0].id;
    setAccountId((current) => current || first);
    if (fromAsset)
      holderOf(fromAsset.id).then(
        (holder) => live && !accountTouched.current && holder && setAccountId(holder),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [accounts, fromAsset, holderOf]);

  const moment = occurredAt(withDefaultTime(entry, new Date()));
  // A half-typed date or time asks nothing: the server would refuse the instant.
  const validMoment = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && /^(\d{2}:\d{2})?$/.test(entry.time);
  const availableKey =
    fromAsset && accountId && validMoment ? `${accountId}|${fromAsset.id}|${moment}` : null;
  useEffect(() => {
    if (!availableKey || !fromAsset) return;
    let live = true;
    tradesApi
      .available(accountId, { instrumentId: fromAsset.id, at: moment })
      .then((result) => live && setAvailability({ key: availableKey, quantity: result.quantity }))
      .catch(() => live && setAvailability({ key: availableKey, quantity: null }));
    return () => {
      live = false;
    };
  }, [availableKey, accountId, fromAsset, moment]);
  const available =
    availableKey && availability?.key === availableKey ? availability.quantity : null;

  const all = convertProblems(entry, today());
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));
  const typed = positive(entry.amount);
  const over = available !== null && typed !== null && compareDecimal(typed, available) > 0;
  const problem = (name: ConvertProblem, text = problemText[name]) =>
    found.has(name) ? text : null;
  const fieldError = (name: ConvertProblem, text = problemText[name]) =>
    found.has(name) && (
      <span className="ui-field__error" id={`${id}-${name}-error`}>
        {text}
      </span>
    );
  const invalid = (name: ConvertProblem) =>
    found.has(name) ? { 'aria-invalid': true, 'aria-describedby': `${id}-${name}-error` } : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const inputs = JSON.stringify({ accountId, revision: account?.journalRevision, entry });
    // An unchanged retry is replayed as it was: if the first try was saved but its answer was lost,
    // the balance now read already includes it, and only the server can tell it is the same request.
    const retry = attempt.current !== null && attempt.current.inputs === inputs;
    if (all.size || !account || !fromAsset || (over && !retry)) {
      refused();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (attempt.current?.inputs !== inputs)
        attempt.current = {
          inputs,
          requestId: newRequestId(),
          sale: withDefaultTime(entry, new Date()),
        };
      const { requestId, sale } = attempt.current;
      const command = convertTrade(sale, fromAsset.id, {
        requestId,
        expectedJournalRevision: account.journalRevision,
      });
      await tradesApi.create(accountId, command);
      toast.show({
        tone: 'success',
        title: 'Transaction added',
        detail: `Convert ${quantity(entry.amount)} ${entry.from} to ${quantity(entry.received)} ${entry.to} · ${account.name}`,
      });
      onSaved();
    } catch (caught) {
      setError(failure(caught, account.name, entry.from, entry.date));
      setSaving(false);
    }
  };

  const fillAll = () => available && update({ amount: available });
  const rate = rateText(entry);

  return (
    <form ref={form} onSubmit={submit} noValidate>
      <ModalHeader
        titleId={titleId}
        title="Add transaction"
        onClose={onClose}
        closeDisabled={saving}
      />
      <ModalBody>
        {typeField}
        {loadFailed ? (
          <Banner tone="neg">
            Could not load your assets and accounts. Close this window and try again.
          </Banner>
        ) : !ready ? (
          <p className="ui-field__hint" role="status">
            Loading your assets and accounts…
          </p>
        ) : accounts.length === 0 ? (
          <Banner tone="info" role="status">
            Add an account with some cash first: on the Portfolio page choose Add, then Cash.
          </Banner>
        ) : (
          <>
            <div className="ui-field-row">
              <div className="ui-field">
                <span className="ui-field__label" aria-hidden="true">
                  From
                </span>
                <SegmentedControl
                  name={`${id}-from`}
                  label="From"
                  options={cashCurrencies}
                  value={entry.from}
                  onChange={chooseFrom}
                />
              </div>
              <div className="ui-field">
                <span className="ui-field__label" aria-hidden="true">
                  To
                </span>
                <SegmentedControl
                  name={`${id}-to`}
                  label="To"
                  options={cashCurrencies}
                  value={entry.to}
                  onChange={chooseTo}
                />
                {fieldError('currency')}
              </div>
            </div>
            <div className="ui-field-row">
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-amount`}>
                  Amount given
                </label>
                <Affix suffix={entry.from}>
                  <Input
                    id={`${id}-amount`}
                    numeric
                    placeholder="0.00"
                    value={entry.amount}
                    onChange={(event) => update({ amount: event.target.value })}
                    onBlur={leave('amount')}
                    {...(over
                      ? { 'aria-invalid': true, 'aria-describedby': `${id}-available` }
                      : invalid('amount'))}
                  />
                </Affix>
                {fieldError('amount', numberProblem(entry.amount, problemText.amount)) ||
                  (!fromAsset ? (
                    <span className="ui-field__hint">
                      You hold no {entry.from} cash yet. Add it first on the Portfolio page: Add,
                      then Cash.
                    </span>
                  ) : available !== null && account ? (
                    over ? (
                      <span className="ui-field__error" id={`${id}-available`} role="alert">
                        Only {quantity(available)} {entry.from} is available in {account.name} on{' '}
                        {dayText(moment.slice(0, 10))} ·{' '}
                        <button type="button" className="ui-link" onClick={fillAll}>
                          Use all
                        </button>
                      </span>
                    ) : (
                      <span className="ui-field__hint" id={`${id}-available`}>
                        Available in {account.name}: {quantity(available)} {entry.from} ·{' '}
                        <button type="button" className="ui-link" onClick={fillAll}>
                          Use all
                        </button>
                      </span>
                    )
                  ) : null)}
              </div>
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-received`}>
                  Amount received
                </label>
                <Affix suffix={entry.to}>
                  <Input
                    id={`${id}-received`}
                    numeric
                    placeholder="0.00"
                    value={entry.received}
                    onChange={(event) => update({ received: event.target.value })}
                    onBlur={leave('received')}
                    {...invalid('received')}
                  />
                </Affix>
                {fieldError('received', numberProblem(entry.received, problemText.received))}
                {rate && (
                  <span className="ui-field__hint">
                    {rate}
                    {entry.from !== 'USD' && entry.to !== 'USD' && (
                      <> · valued in USD at the Bank of Russia rate of the day</>
                    )}
                  </span>
                )}
              </div>
            </div>
            <div className="ui-field-row">
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-account`}>
                  Wallet or account
                </label>
                <Select
                  id={`${id}-account`}
                  value={accountId}
                  onChange={(event) => {
                    accountTouched.current = true;
                    setAccountId(event.target.value);
                  }}
                >
                  {accounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Field id={`${id}-date`} label="Date" error={problem('date')}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    max={today()}
                    value={entry.date}
                    onChange={(event) => update({ date: event.target.value })}
                    onBlur={leave('date')}
                  />
                )}
              </Field>
            </div>
            <p className="ui-field__hint">
              The cash you give up leaves {account?.name ?? 'the account'} and the cash you receive
              arrives there. Nothing counts as money added or taken out. Any difference between the
              cost of the cash you give up and the value of what you receive, in USD, shows as
              profit or loss.
            </p>
            <details
              className="ui-more"
              open={
                Boolean(entry.time || entry.comment) || found.has('time') || found.has('comment')
              }
            >
              <summary>More options: time, comment</summary>
              <div className="ui-field-row">
                <Field id={`${id}-time`} label="Time, UTC (optional)" error={problem('time')}>
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      value={entry.time}
                      onChange={(event) => update({ time: event.target.value })}
                      onBlur={leave('time')}
                    />
                  )}
                </Field>
              </div>
              <Field id={`${id}-comment`} label="Comment" error={problem('comment')}>
                {(control) => (
                  <Textarea
                    {...control}
                    placeholder="Optional"
                    value={entry.comment}
                    onChange={(event) => update({ comment: event.target.value })}
                    onBlur={leave('comment')}
                  />
                )}
              </Field>
            </details>
          </>
        )}
        {error && <Banner tone="neg">{error}</Banner>}
      </ModalBody>
      <ModalFooter
        summary={
          positive(entry.amount) !== null && positive(entry.received) !== null
            ? `${quantity(decimal(entry.amount)!)} ${entry.from} → ${quantity(decimal(entry.received)!)} ${entry.to}`
            : null
        }
      >
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || !ready || !accounts?.length || !fromAsset}
        >
          Save transaction
        </Button>
      </ModalFooter>
    </form>
  );
}

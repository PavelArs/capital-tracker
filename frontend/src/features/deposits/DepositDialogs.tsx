import {
  type DayBasis,
  type DepositCurrency,
  type DepositDetail,
  depositsApi,
  type EarlyClose,
  type MovementKind,
  type NewDeposit,
  type PayoutSchedule,
} from '@api/deposits.api';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import CloseButton from '../shell/CloseButton';
import { movementText, today } from './deposit-format';
import '../transactions/transactions.css';

const MONEY = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
/** The longest term the server accepts, in years. */
const MAX_TERM_YEARS = 30;
const RATE = /^(0|[1-9]\d{0,2})(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const amountProblem = (value: string, label: string, zero = false) =>
  !MONEY.test(value.trim()) || (!zero && Number(value) === 0)
    ? `${label}: a number with up to two decimals${zero ? '' : ', above 0'}`
    : null;
const rateProblem = (value: string) =>
  RATE.test(value.trim()) ? null : 'Rate: percent a year, up to four decimals';
const dateProblem = (value: string, label: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? null
    : `${label}: pick a date`;

/**
 * The id of this attempt. A retry of the same entries after a lost answer keeps it, so the
 * server records it once; changed entries are a new attempt with a new id.
 */
function useAttempt() {
  const last = useRef<{ key: string; id: string } | null>(null);
  return (entries: unknown) => {
    const key = JSON.stringify(entries);
    if (last.current?.key !== key) last.current = { key, id: newRequestId() };
    return last.current.id;
  };
}

/** The server's own words for a refusal it explained, else a general line. */
const failure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Nothing was saved; try again.',
    status: {
      400: 'Check the fields and try again.',
      404: 'This deposit no longer exists. Reload the page.',
      409: (message) => message ?? 'Could not save. Try again.',
      422: (message) => message ?? 'Could not save. Try again.',
    },
    fallback: 'Could not save. Try again.',
  });

/** One modal form: a title, fields, a refusal line and Cancel/Save. */
function FormDialog({
  title,
  note,
  submit,
  problem,
  onClose,
  onSubmit,
  children,
  wide,
}: {
  title: string;
  note?: string;
  submit: string;
  problem: () => string | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  const hint = tried ? problem() : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem() !== null) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit();
    } catch (caught) {
      setError(failure(caught));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size={wide ? 'wide' : 'narrow'}
      onEscape={saving ? undefined : onClose}
    >
      <form onSubmit={save} noValidate>
        <div className="ui-modal__head">
          <h2 id={`${id}-title`}>{title}</h2>
          <CloseButton onClick={onClose} disabled={saving} />
          {note && <p className="shell-note">{note}</p>}
        </div>
        <div className="ui-modal__body">
          {children}
          {(hint || error) && (
            <p className="ui-banner ui-banner--neg" role="alert">
              {hint ?? error}
            </p>
          )}
        </div>
        <div className="ui-modal__foot">
          <button
            type="button"
            className="shell-button shell-button--ghost"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
            {saving ? 'Saving…' : submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  hint,
  numeric,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  numeric?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          className="ui-input"
          value={value}
          autoComplete="off"
          inputMode={numeric ? 'decimal' : undefined}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="date"
          className="ui-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select
          id={id}
          className="ui-input"
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const payoutOptions: readonly (readonly [PayoutSchedule, string])[] = [
  ['monthly', 'Every month'],
  ['quarterly', 'Every quarter'],
  ['at-end', 'At the end of the term'],
];

/** DEP-TERMS: a deposit is entered once; the app computes the rest. */
export function AddDepositDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState<DepositCurrency>('RUB');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [payout, setPayout] = useState<PayoutSchedule>('monthly');
  const [capitalized, setCapitalized] = useState(false);
  const [dayBasis, setDayBasis] = useState<DayBasis>('actual-365');
  const [earlyClose, setEarlyClose] = useState<EarlyClose>('forfeits-interest');
  const attempt = useAttempt();

  const problem = () =>
    (!name.trim() ? 'Name: give the deposit a name' : null) ??
    (!bank.trim() ? 'Bank: enter the bank' : null) ??
    amountProblem(amount, 'Amount put in') ??
    rateProblem(rate) ??
    dateProblem(startDate, 'Start date') ??
    (endDate ? dateProblem(endDate, 'End date') : null) ??
    (endDate && endDate <= startDate ? 'End date: must be after the start date' : null) ??
    (endDate && endDate > `${Number(startDate.slice(0, 4)) + MAX_TERM_YEARS}${startDate.slice(4)}`
      ? `End date: a term is at most ${MAX_TERM_YEARS} years`
      : null) ??
    (payout === 'at-end' && !endDate ? 'Interest at the end of the term needs an end date' : null);

  return (
    <FormDialog
      title="Add deposit"
      note="Enter the terms once. The app counts the interest and what the deposit is worth; you only record top-ups and payouts."
      submit="Add deposit"
      problem={problem}
      onClose={onClose}
      wide
      onSubmit={async () => {
        const entries = {
          name: name.trim(),
          bank: bank.trim(),
          currency,
          startDate,
          endDate: endDate || null,
          payout,
          capitalized,
          dayBasis,
          earlyClose,
          ratePercent: rate.trim(),
          amount: amount.trim(),
        };
        const body: NewDeposit = { requestId: attempt(entries), ...entries };
        onSaved(await depositsApi.create(body));
      }}
    >
      <div className="ui-field-row">
        <Text label="Name" value={name} onChange={setName} maxLength={120} placeholder="Savings" />
        <Text
          label="Bank"
          value={bank}
          onChange={setBank}
          maxLength={120}
          placeholder="Bank name"
        />
      </div>
      <div className="ui-field-row">
        <Select
          label="Currency"
          value={currency}
          options={[
            ['RUB', 'RUB'],
            ['USD', 'USD'],
            ['EUR', 'EUR'],
          ]}
          onChange={setCurrency}
        />
        <Text
          label="Amount put in"
          value={amount}
          onChange={setAmount}
          numeric
          placeholder="0.00"
        />
      </div>
      <div className="ui-field-row">
        <Text
          label="Rate, % a year"
          value={rate}
          onChange={setRate}
          numeric
          hint="The rate the bank pays now. Add a change later if it moves."
        />
        <Select
          label="Interest"
          value={payout}
          options={payoutOptions}
          onChange={setPayout}
          hint="When the bank posts it."
        />
      </div>
      <div className="ui-field-row">
        <DateField label="Start date" value={startDate} onChange={setStartDate} />
        <DateField
          label="End date (optional)"
          value={endDate}
          onChange={setEndDate}
          hint="Leave empty for a deposit with no term."
        />
      </div>
      <label className="transactions-toggle">
        <input
          type="checkbox"
          checked={capitalized}
          onChange={(event) => setCapitalized(event.target.checked)}
        />
        Interest is added to the deposit and earns interest itself
      </label>
      <details className="deposit-more">
        <summary>More options</summary>
        <div className="ui-field-row">
          <Select
            label="Days in a year"
            value={dayBasis}
            options={[
              ['actual-365', 'Always 365'],
              ['actual-actual', '366 in a leap year'],
            ]}
            onChange={setDayBasis}
            hint="How the bank divides the annual rate by days."
          />
          <Select
            label="Closing before the end"
            value={earlyClose}
            options={[
              ['forfeits-interest', 'Loses the interest not yet posted'],
              ['keeps-interest', 'Keeps the interest earned'],
            ]}
            onChange={setEarlyClose}
          />
        </div>
      </details>
    </FormDialog>
  );
}

const movementOptions: readonly (readonly [MovementKind, string])[] = (
  ['topup', 'withdrawal', 'interest-payout'] as const
).map((kind) => [kind, movementText[kind]] as const);

/** DEP-MOVEMENT: money in, money out, interest taken out. */
export function MovementDialog({
  id,
  currency,
  initial = 'topup',
  onClose,
  onSaved,
}: {
  id: string;
  currency: DepositCurrency;
  initial?: MovementKind;
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const [kind, setKind] = useState<MovementKind>(initial);
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const attempt = useAttempt();
  const hints: Record<MovementKind, string> = {
    topup: 'Money you put into the deposit.',
    withdrawal: 'Money you took out of the deposit. Taking all of it closes the deposit.',
    'interest-payout': 'Interest the bank paid to your account. It does not change the deposit.',
  };
  return (
    <FormDialog
      title="Record a movement"
      note={hints[kind]}
      submit="Record"
      problem={() => dateProblem(date, 'Date') ?? amountProblem(amount, `Amount, ${currency}`)}
      onClose={onClose}
      onSubmit={async () => {
        const entries = {
          date,
          kind,
          amount: amount.trim(),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        };
        onSaved(await depositsApi.addMovement(id, { requestId: attempt(entries), ...entries }));
      }}
    >
      <Select label="What happened" value={kind} options={movementOptions} onChange={setKind} />
      <div className="ui-field-row">
        <DateField label="Date" value={date} onChange={setDate} />
        <Text
          label={`Amount, ${currency}`}
          value={amount}
          onChange={setAmount}
          numeric
          placeholder="0.00"
        />
      </div>
      <Text label="Note (optional)" value={comment} onChange={setComment} maxLength={200} />
    </FormDialog>
  );
}

/** DEP-CHECK: the balance the bank's app shows, kept to compare with the computed one. */
export function CheckDialog({
  id,
  currency,
  onClose,
  onSaved,
}: {
  id: string;
  currency: DepositCurrency;
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [balance, setBalance] = useState('');
  const attempt = useAttempt();
  return (
    <FormDialog
      title="Check against the bank"
      note="Open the deposit in the bank's app and enter the balance it shows. The app compares it with what it counted."
      submit="Save check"
      problem={() =>
        dateProblem(date, 'Date') ??
        amountProblem(balance, `Balance in the bank, ${currency}`, true)
      }
      onClose={onClose}
      onSubmit={async () => {
        const entries = { checkedOn: date, bankBalance: balance.trim() };
        onSaved(await depositsApi.addCheck(id, { requestId: attempt(entries), ...entries }));
      }}
    >
      <div className="ui-field-row">
        <DateField label="Date" value={date} onChange={setDate} />
        <Text
          label={`Balance in the bank, ${currency}`}
          value={balance}
          onChange={setBalance}
          numeric
          placeholder="0.00"
        />
      </div>
    </FormDialog>
  );
}

/** DEP-RATE: the bank changed the rate during the term. */
export function RateDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('');
  return (
    <FormDialog
      title="Change the rate"
      note="From this date on interest is counted at the new rate. Earlier days keep the rate they had."
      submit="Change rate"
      problem={() => dateProblem(date, 'From') ?? rateProblem(rate)}
      onClose={onClose}
      onSubmit={async () =>
        onSaved(await depositsApi.addRate(id, { effectiveFrom: date, ratePercent: rate.trim() }))
      }
    >
      <div className="ui-field-row">
        <DateField label="From" value={date} onChange={setDate} />
        <Text label="New rate, % a year" value={rate} onChange={setRate} numeric />
      </div>
    </FormDialog>
  );
}

/** Deleting forgets the deposit and everything entered for it; nothing else changes. */
export function DeleteDepositDialog({
  id,
  name,
  onClose,
  onDeleted,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <FormDialog
      title="Delete deposit"
      note={`${name} and the movements, rates and checks entered for it will be removed. This cannot be undone.`}
      submit="Delete"
      problem={() => null}
      onClose={onClose}
      onSubmit={async () => {
        await depositsApi.remove(id);
        onDeleted();
      }}
    >
      <p className="shell-note">Other assets and operations are not affected.</p>
    </FormDialog>
  );
}

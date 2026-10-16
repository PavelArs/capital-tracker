import {
  type DayBasis,
  type DepositCurrency,
  type DepositDetail,
  type DepositPreview,
  type DepositTerms,
  depositsApi,
  type EarlyClose,
  type MovementKind,
  type NewDeposit,
  type PayoutSchedule,
} from '@api/deposits.api';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Chip, ChipGroup } from '@/ui/Chip';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Field, type FieldControl } from '@/ui/Field';
import { Affix, Input, Select } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Toggle } from '@/ui/Toggle';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { useFocusFirstProblem } from '../portfolio/focus-problem';
import { Icon } from '../shell/icons';
import { dateText, earlyCloseText, money, movementText, today } from './deposit-format';
import './deposits.css';

const MONEY = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
/** The longest term the server accepts, in years. */
const MAX_TERM_YEARS = 30;
const RATE = /^(0|[1-9]\d{0,2})(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// What is wrong with a field, said under it; null when nothing is.
const amountProblem = (value: string, what: string, zero = false) =>
  !value.trim()
    ? `Enter ${what}`
    : !MONEY.test(value.trim()) || (!zero && Number(value) === 0)
      ? `A number with up to 12 digits and two decimals${zero ? '' : ', above 0'}`
      : null;
const rateProblem = (value: string) =>
  !value.trim()
    ? 'Enter the rate'
    : RATE.test(value.trim())
      ? null
      : 'Percent a year, up to four decimals';
const dateProblem = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : 'Pick a date';

/** Each field's problem by the field's key; a field without one is fine. */
type Problems = Record<string, string | null>;
const hasProblems = (problems: Problems) => Object.values(problems).some(Boolean);

/** The problems shown in a form: none until the owner first tries to save it. */
const ShownProblems = createContext<Problems>({});

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
  problems,
  onClose,
  onSubmit,
  children,
  wide,
}: {
  title: string;
  note?: string;
  submit: string;
  /** Every field's problem; each is shown under its field once the owner tried to save. */
  problems: () => Problems;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  // Each refused save puts the keyboard on the first field that needs a fix.
  const { form, refused } = useFocusFirstProblem();

  const shown = tried ? problems() : {};
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (hasProblems(problems())) {
      refused();
      return;
    }
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
      size={wide ? 'wide' : 'default'}
      onEscape={saving ? undefined : onClose}
      initialFocus={(root) => root.querySelector<HTMLElement>('input, select')}
    >
      <form ref={form} onSubmit={save} noValidate>
        <ModalHeader
          titleId={`${id}-title`}
          title={title}
          onClose={onClose}
          closeDisabled={saving}
          intro={note}
        />
        <ModalBody>
          <ShownProblems.Provider value={shown}>{children}</ShownProblems.Provider>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : submit}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * A labelled field of these forms. `name` is its key among the form's problems: once the owner
 * tried to save, its problem is said under it, in place of the hint.
 */
function FormField({
  label,
  hint,
  name,
  children,
}: {
  label: string;
  hint?: string;
  name?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const problems = useContext(ShownProblems);
  return (
    <Field label={label} hint={hint} error={name ? problems[name] : null}>
      {children}
    </Field>
  );
}

function Text({
  label,
  name,
  value,
  onChange,
  hint,
  numeric,
  maxLength,
  placeholder,
  suffix,
  children,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  numeric?: boolean;
  maxLength?: number;
  placeholder?: string;
  /** A unit shown inside the field's end, such as the currency or %. */
  suffix?: string;
  /** Shown under the field, such as choices that fill it in. */
  children?: ReactNode;
}) {
  return (
    <FormField label={label} hint={hint} name={name}>
      {(control) => {
        const input = (
          <Input
            {...control}
            value={value}
            autoComplete="off"
            numeric={numeric}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
        return (
          <>
            {suffix ? <Affix suffix={suffix}>{input}</Affix> : input}
            {children}
          </>
        );
      }}
    </FormField>
  );
}

function DateField({
  label,
  name,
  value,
  onChange,
  hint,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <FormField label={label} hint={hint} name={name}>
      {(control) => (
        <Input
          {...control}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

function Choice<T extends string>({
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
    <FormField label={label} hint={hint}>
      {(control) => (
        <Select {...control} value={value} onChange={(event) => onChange(event.target.value as T)}>
          {options.map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

// Quarterly is not offered any more; a deposit made with it keeps working.
const payoutOptions: readonly (readonly [PayoutSchedule, string])[] = [
  ['daily', 'Every day'],
  ['monthly', 'Every month'],
  ['at-end', 'At the end of the term'],
];

const currencies: readonly DepositCurrency[] = ['RUB', 'USD', 'EUR'];
const earlyCloseOptions = (['forfeits-interest', 'keeps-interest'] as const).map(
  (rule) => [rule, earlyCloseText[rule]] as const,
);
/** What a deposit is called when the owner leaves the name empty. */
const DEFAULT_NAME = 'Deposit';
/** How long the entries stay still before the figures are asked for: typing asks once. */
const PREVIEW_DELAY_MS = 400;

/**
 * DEP-PREVIEW: what the server computes for these terms, asked once they are all valid and have
 * stayed still a moment. Only the answer for the terms as they are now is returned: a changed
 * entry, a refusal or no answer yet gives null, never a zero.
 */
function usePreview(terms: DepositTerms | null): DepositPreview | null {
  const key = terms && JSON.stringify(terms);
  const [answer, setAnswer] = useState<{ key: string; figures: DepositPreview } | null>(null);
  useEffect(() => {
    if (key === null) return;
    // A newer entry or a closed dialog stops the request still on its way.
    const asked = new AbortController();
    const timer = setTimeout(() => {
      depositsApi.preview(JSON.parse(key) as DepositTerms, asked.signal).then(
        (figures) => {
          if (!asked.signal.aborted) setAnswer({ key, figures });
        },
        () => undefined,
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      asked.abort();
      clearTimeout(timer);
    };
  }, [key]);
  return answer !== null && answer.key === key ? answer.figures : null;
}

/** "At this rate, at the end of the term, on Dec 1, 2026: ₽105,030.14, of which … interest. …" */
function previewText(preview: DepositPreview, currency: DepositCurrency): string | null {
  const { atMaturity: end, firstPayout: first } = preview;
  const parts = [
    end &&
      `At this rate, at the end of the term, on ${dateText(end.date)}: ${money(end.balance, currency)}, of which ${money(end.interest, currency)} interest.`,
    first &&
      `The first interest, ${money(first.interest, currency)}, ${
        first.treatment === 'capitalized' ? 'is added on' : 'comes on'
      } ${dateText(first.date)}.`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** DEP-TERMS: a deposit is entered once; the app computes the rest. */
export function AddDepositDialog({
  banks = [],
  onClose,
  onSaved,
}: {
  /** The banks of the deposits already entered, offered as one-tap choices. */
  banks?: readonly string[];
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState<DepositCurrency>('RUB');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState('');
  const [payout, setPayout] = useState<PayoutSchedule>('monthly');
  // Most deposits add the interest to themselves; the owner turns it off for one that pays out.
  const [capitalized, setCapitalized] = useState(true);
  const [dayBasis, setDayBasis] = useState<DayBasis>('actual-365');
  const [earlyClose, setEarlyClose] = useState<EarlyClose>('forfeits-interest');
  const attempt = useAttempt();
  const knownBanks = [...new Set(banks)];
  const entries: DepositTerms = {
    name: name.trim() || DEFAULT_NAME,
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

  const problems = (): Problems => ({
    bank: bank.trim() ? null : 'Enter the bank',
    amount: amountProblem(amount, 'the amount put in'),
    rate: rateProblem(rate),
    startDate: dateProblem(startDate),
    endDate: endDate
      ? (dateProblem(endDate) ??
        (endDate <= startDate
          ? 'Must be after the opening date'
          : endDate > `${Number(startDate.slice(0, 4)) + MAX_TERM_YEARS}${startDate.slice(4)}`
            ? `A term is at most ${MAX_TERM_YEARS} years`
            : null))
      : payout === 'at-end'
        ? 'Interest at the end of the term needs an end date'
        : null,
  });
  const preview = usePreview(hasProblems(problems()) ? null : entries);
  const figures = preview && previewText(preview, currency);

  return (
    <FormDialog
      title="Add bank deposit"
      note="Enter the terms once. The app counts the interest and what the deposit is worth; you only record top-ups and payouts."
      submit="Add deposit"
      problems={problems}
      onClose={onClose}
      wide
      onSubmit={async () => {
        const body: NewDeposit = { requestId: attempt(entries), ...entries };
        onSaved(await depositsApi.create(body));
      }}
    >
      <div className="ui-field-row">
        <Text
          label="Bank"
          name="bank"
          value={bank}
          onChange={setBank}
          maxLength={120}
          placeholder="Bank name"
        >
          {knownBanks.length > 0 && (
            <ChipGroup label="Banks already entered">
              {knownBanks.map((known) => (
                <Chip key={known} pressed={bank.trim() === known} onClick={() => setBank(known)}>
                  {known}
                </Chip>
              ))}
            </ChipGroup>
          )}
        </Text>
        <Text
          label="Name (optional)"
          value={name}
          onChange={setName}
          maxLength={120}
          placeholder={DEFAULT_NAME}
        />
      </div>
      <div className="ui-field">
        <span id={`${id}-currency`} className="ui-field__label">
          Currency
        </span>
        <SegmentedControl
          name={`${id}-currency`}
          labelledBy={`${id}-currency`}
          options={currencies}
          value={currency}
          onChange={setCurrency}
        />
      </div>
      <div className="ui-field-row">
        <Text
          label="Amount put in"
          name="amount"
          value={amount}
          onChange={setAmount}
          numeric
          placeholder="0"
          suffix={currency}
        />
        <Text
          label="Rate, % a year"
          name="rate"
          value={rate}
          onChange={setRate}
          numeric
          placeholder="16"
          suffix="%"
          hint="The rate the bank pays now. A change can be added later."
        />
      </div>
      <div className="ui-field-row">
        <DateField label="Opened on" name="startDate" value={startDate} onChange={setStartDate} />
        <DateField
          label="Ends on (optional)"
          name="endDate"
          value={endDate}
          onChange={setEndDate}
          hint="Leave empty for a deposit with no term."
        />
      </div>
      <div className="ui-field-row">
        <Choice
          label="Interest comes"
          value={payout}
          options={payoutOptions}
          onChange={setPayout}
        />
        <div className="deposit-toggle">
          <Toggle checked={capitalized} onChange={setCapitalized}>
            Interest is added to the deposit
          </Toggle>
        </div>
      </div>
      {figures && <Banner tone="info">{figures}</Banner>}
      <details className="ui-more">
        <summary>
          <Icon name="chevron" />
          More options
        </summary>
        <div>
          <div className="ui-field-row">
            <Choice
              label="If closed early"
              value={earlyClose}
              options={earlyCloseOptions}
              onChange={setEarlyClose}
            />
            <Choice
              label="Days in a year"
              value={dayBasis}
              options={[
                ['actual-365', 'Always 365'],
                ['actual-actual', '366 in a leap year'],
              ]}
              onChange={setDayBasis}
              hint="How the bank divides the annual rate by days."
            />
          </div>
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
      problems={() => ({ date: dateProblem(date), amount: amountProblem(amount, 'the amount') })}
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
      <Choice label="What happened" value={kind} options={movementOptions} onChange={setKind} />
      <div className="ui-field-row">
        <DateField label="Date" name="date" value={date} onChange={setDate} />
        <Text
          label={`Amount, ${currency}`}
          name="amount"
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
  capitalized,
  onClose,
  onSaved,
}: {
  id: string;
  currency: DepositCurrency;
  capitalized: boolean;
  onClose: () => void;
  onSaved: (deposit: DepositDetail) => void;
}) {
  const [date, setDate] = useState(today());
  const [balance, setBalance] = useState('');
  const attempt = useAttempt();
  return (
    <FormDialog
      title="Check against the bank"
      note={`Open the deposit in the bank's app and enter the balance it shows. ${
        capitalized
          ? 'The app compares it with what the bank has added, without the interest earned since the last interest date.'
          : 'The app compares it with the deposit and all the interest earned so far.'
      }`}
      submit="Save check"
      problems={() => ({
        date: dateProblem(date),
        balance: amountProblem(balance, 'the balance the bank shows', true),
      })}
      onClose={onClose}
      onSubmit={async () => {
        const entries = { checkedOn: date, bankBalance: balance.trim() };
        onSaved(await depositsApi.addCheck(id, { requestId: attempt(entries), ...entries }));
      }}
    >
      <div className="ui-field-row">
        <DateField label="Date" name="date" value={date} onChange={setDate} />
        <Text
          label={`Balance in the bank, ${currency}`}
          name="balance"
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
      problems={() => ({ from: dateProblem(date), rate: rateProblem(rate) })}
      onClose={onClose}
      onSubmit={async () =>
        onSaved(await depositsApi.addRate(id, { effectiveFrom: date, ratePercent: rate.trim() }))
      }
    >
      <div className="ui-field-row">
        <DateField label="From" name="from" value={date} onChange={setDate} />
        <Text label="New rate, % a year" name="rate" value={rate} onChange={setRate} numeric />
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
    <ConfirmDialog
      title="Delete this deposit?"
      confirmLabel="Delete deposit"
      busyLabel="Deleting…"
      failure={failure}
      onClose={onClose}
      onConfirm={async () => {
        await depositsApi.remove(id);
        onDeleted();
      }}
    >
      {name} and the movements, rates and checks entered for it are removed; this cannot be undone.
      Other assets and operations are not affected.
    </ConfirmDialog>
  );
}

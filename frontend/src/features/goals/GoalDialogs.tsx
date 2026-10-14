import {
  type Goal,
  type GoalCurrency,
  type GoalPreview,
  type GoalTerms,
  goalsApi,
} from '@api/goals.api';
import { isCancel } from 'axios';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import CloseButton from '../shell/CloseButton';
import { Icon } from '../shell/icons';
import { bannerTone, flooredText, rateText, today, verdict } from './goal-format';
import '../transactions/transactions.css';
import './goals.css';

// What the server accepts (goal-input.ts): a sum with up to two decimals, a yearly return below
// 1000 with up to four, a name of at most 120 characters.
const MONEY = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const RATE = /^(0|[1-9]\d{0,2})(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_LENGTH = 120;
const PRESETS: readonly (readonly [string, string])[] = [
  ['4', 'Careful'],
  ['8', 'Base'],
  ['12', 'Bold'],
];

/**
 * The id of this attempt. A retry of the same entries after a lost answer keeps it, so the
 * server records the goal once; changed entries are a new attempt with a new id.
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
      404: 'This goal no longer exists. Reload the page.',
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
}: {
  title: string;
  note?: string;
  submit: string;
  problem: () => string | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
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
      size="wide"
      onEscape={saving ? undefined : onClose}
      initialFocus={(root) => root.querySelector<HTMLElement>('input, select')}
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
  optional,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}
        {optional && <span className="goal-optional"> (optional)</span>}
      </label>
      {children(id)}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

const problemOf = (terms: {
  name: string;
  target: string;
  deadline: string;
  rate: string;
  monthly: string;
}): string | null =>
  (!terms.name.trim()
    ? 'Name: give the goal a name'
    : Array.from(terms.name.trim()).length > NAME_LENGTH
      ? `Name: at most ${NAME_LENGTH} characters`
      : null) ??
  (!MONEY.test(terms.target.trim()) || Number(terms.target) === 0
    ? 'Sum to reach: a number with up to two decimals, above 0'
    : null) ??
  (terms.deadline &&
  (!DATE.test(terms.deadline) || Number.isNaN(Date.parse(`${terms.deadline}T00:00:00Z`)))
    ? 'By: pick a date'
    : null) ??
  (terms.deadline && terms.deadline <= today()
    ? 'By: pick a date after today, or clear it'
    : null) ??
  (RATE.test(terms.rate.trim())
    ? null
    : 'Expected return: percent a year, from 0 to 999.9999 with up to four decimals') ??
  (terms.monthly.trim() && !MONEY.test(terms.monthly.trim())
    ? 'Monthly contribution: a number with up to two decimals, or leave it empty'
    : null);

/** How long the dialog waits after the last keystroke before it asks for the plan. */
const PREVIEW_DELAY_MS = 350;

type PreviewTerms = Omit<GoalTerms, 'name'>;

/**
 * GOAL-PREVIEW: the plan the goal would have, asked for a moment after the owner stops typing.
 * Only the newest answer counts; terms that cannot be sent yet show none.
 */
function usePreview(terms: PreviewTerms | null) {
  const key = terms === null ? null : JSON.stringify(terms);
  const [state, setState] = useState<{
    key: string;
    preview: GoalPreview | null;
    failed: boolean;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the terms.
  useEffect(() => {
    if (terms === null || key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      goalsApi.preview(terms, controller.signal).then(
        (preview) => setState({ key, preview, failed: false }),
        (error) => {
          if (!isCancel(error)) setState({ key, preview: null, failed: true });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (key === null) return { preview: null, failed: false, pending: false };
  // Until the answer for these terms arrives, the last one stays in view, marked as busy.
  return state === null
    ? { preview: null, failed: false, pending: true }
    : { preview: state.preview, failed: state.failed, pending: state.key !== key };
}

/** The verdict the goal page would show for these terms, under the fields. */
function PlanPreview({
  ready,
  preview,
  failed,
  pending,
}: {
  ready: boolean;
  preview: GoalPreview | null;
  failed: boolean;
  pending: boolean;
}) {
  if (!ready || failed || preview === null)
    return (
      <p className="ui-banner ui-banner--info goal-preview" aria-busy={ready && pending}>
        <Icon name="info" className="shell-icon shell-icon--sm" />
        <span>
          {!ready
            ? 'Enter the sum and the return to see a plan.'
            : failed
              ? 'Could not work out the plan right now. The goal can still be saved.'
              : 'Working out the plan…'}
        </span>
      </p>
    );
  const tone = bannerTone[preview.status];
  return (
    <p
      className={`ui-banner ui-banner--${tone} goal-preview`}
      role="status"
      aria-label="Plan"
      aria-busy={pending}
    >
      <Icon
        name={tone === 'warn' || tone === 'neg' ? 'alert' : 'info'}
        className="shell-icon shell-icon--sm"
      />
      <span>{verdict(preview)} A projection, not a promise.</span>
    </p>
  );
}

/** GOAL-TERMS: a goal is a sum in one currency with an optional date, for the whole portfolio. */
export function GoalDialog({
  goal,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  /** The goal being changed; none adds a new one. */
  goal?: Goal;
  defaultCurrency: GoalCurrency;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [currency, setCurrency] = useState<GoalCurrency>(goal?.currency ?? defaultCurrency);
  const [target, setTarget] = useState(goal ? goal.targetAmount : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [rate, setRate] = useState(goal ? rateText(goal.expectedReturnPercent) : '8');
  const [monthly, setMonthly] = useState(goal?.monthlyContribution ?? '');
  const attempt = useAttempt();
  // The plan is asked for as soon as the terms could be saved, whatever the name says.
  const ready = problemOf({ name: 'x', target, deadline, rate, monthly }) === null;
  const plan = usePreview(
    ready
      ? {
          currency,
          targetAmount: target.trim(),
          deadline: deadline || null,
          expectedReturnPercent: rate.trim(),
          monthlyContribution: monthly.trim() || null,
        }
      : null,
  );
  const now = plan.preview?.progress.current ?? null;
  const nameId = useId();
  const targetId = useId();
  const rateId = useId();

  return (
    <FormDialog
      title={goal ? 'Edit goal' : 'Add goal'}
      note="A goal counts your whole portfolio. The app works out what to put in each month, or when you get there."
      submit={goal ? 'Save goal' : 'Add goal'}
      problem={() => problemOf({ name, target, deadline, rate, monthly })}
      onClose={onClose}
      onSubmit={async () => {
        const terms: GoalTerms = {
          name: name.trim(),
          currency,
          targetAmount: target.trim(),
          deadline: deadline || null,
          expectedReturnPercent: rate.trim(),
          monthlyContribution: monthly.trim() || null,
        };
        onSaved(
          goal
            ? await goalsApi.update(goal.id, terms)
            : await goalsApi.create({ requestId: attempt(terms), ...terms }),
        );
      }}
    >
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className="ui-input"
          value={name}
          autoComplete="off"
          maxLength={NAME_LENGTH}
          placeholder="Apartment down payment"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="ui-field">
        <span className="ui-field__label" id={`${nameId}-currency`}>
          Currency
        </span>
        <SegmentedControl
          name="goal-currency"
          labelledBy={`${nameId}-currency`}
          options={['RUB', 'USD', 'EUR']}
          value={currency}
          onChange={setCurrency}
        />
      </div>
      <div className="ui-field-row">
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={targetId}>
            Sum to reach
          </label>
          <div className="ui-affix">
            <input
              id={targetId}
              className="ui-input"
              value={target}
              autoComplete="off"
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setTarget(event.target.value)}
            />
            <span className="ui-affix__suffix">{currency}</span>
          </div>
          {now !== null && plan.preview?.currency === currency && (
            <span className="ui-field__hint">Your portfolio now: {flooredText(now, currency)}</span>
          )}
        </div>
        <Field label="By" optional hint="Without a date the app shows when you get there.">
          {(id) => (
            <input
              id={id}
              type="date"
              className="ui-input"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={rateId}>
          Expected return, % a year
        </label>
        <div className="goal-rate">
          <div className="ui-chips">
            {PRESETS.map(([value, text]) => (
              <button
                key={value}
                type="button"
                className="ui-chip"
                aria-pressed={rate.trim() === value}
                onClick={() => setRate(value)}
              >
                {value}% <span className="goal-optional">{text}</span>
              </button>
            ))}
          </div>
          <div className="ui-affix goal-rate__input">
            <input
              id={rateId}
              className="ui-input"
              value={rate}
              autoComplete="off"
              inputMode="decimal"
              onChange={(event) => setRate(event.target.value)}
            />
            <span className="ui-affix__suffix">%</span>
          </div>
        </div>
        <span className="ui-field__hint">
          On the whole portfolio, before inflation. A projection, not a promise: the same return
          every year.
        </span>
      </div>
      <Field label="You put in a month" optional>
        {(id) => (
          <div className="ui-affix">
            <input
              id={id}
              className="ui-input"
              value={monthly}
              autoComplete="off"
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setMonthly(event.target.value)}
            />
            <span className="ui-affix__suffix">{currency}</span>
          </div>
        )}
      </Field>
      <PlanPreview ready={ready} {...plan} />
    </FormDialog>
  );
}

export function DeleteGoalDialog({
  goal,
  onClose,
  onDeleted,
}: {
  goal: Goal;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return (
    <FormDialog
      title="Delete goal"
      note={`${goal.name} will be removed. This cannot be undone.`}
      submit="Delete"
      problem={() => null}
      onClose={onClose}
      onSubmit={async () => {
        await goalsApi.remove(goal.id);
        onDeleted();
      }}
    >
      <p className="shell-note">Your portfolio and its history are not affected.</p>
    </FormDialog>
  );
}

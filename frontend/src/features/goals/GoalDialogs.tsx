import {
  type Goal,
  type GoalCurrency,
  type GoalPreview,
  type GoalTerms,
  goalsApi,
} from '@api/goals.api';
import { isAxiosError, isCancel } from 'axios';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Chip, ChipGroup } from '@/ui/Chip';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { type FieldControl, Field as FormField } from '@/ui/Field';
import { FormDialog, hasProblems, type Problems, useShownProblem } from '@/ui/FormDialog';
import { Affix, Input } from '@/ui/inputs';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { requestFailure } from '@/utils/request-failure';
import { useAttempt } from '../accounting/feedback';
import {
  addMonths,
  bannerTone,
  enteredInput,
  flooredText,
  rateText,
  today,
  verdict,
} from './goal-format';
import './goals.css';

// What the server accepts (goal-input.ts): a sum with up to two decimals, a yearly return below
// 1000 with up to four, a name of at most 120 characters.
const MONEY = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const RATE = /^(0|[1-9]\d{0,2})(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_LENGTH = 120;
/** The furthest date the server's forecast reaches: 100 years of monthly payments. */
const MAX_MONTHS = 1200;
const PRESETS: readonly (readonly [string, string])[] = [
  ['4', 'Careful'],
  ['8', 'Base'],
  ['12', 'Bold'],
];

/**
 * The server's own words for a refusal it explained, else a general line. Without an answer the
 * change may have been made (goals-02), so `unreachable` never says that nothing was saved.
 */
const failure = (error: unknown, unreachable: string) =>
  requestFailure(error, {
    unreachable,
    status: {
      400: 'Check the fields and try again.',
      404: 'This goal no longer exists. Reload the page.',
      409: (message) => message ?? 'Could not save. Try again.',
      422: (message) => message ?? 'Could not save. Try again.',
    },
    fallback: 'Could not save. Try again.',
  });

/**
 * A labelled field. `name` is its key among the form's problems: once the owner tried to save,
 * its problem is said under it, in place of the hint, and the control is marked invalid.
 */
function Field({
  label,
  optional,
  hint,
  name,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  name?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const problem = useShownProblem(name);
  return (
    <FormField
      label={
        optional ? (
          <>
            {label} <span className="ui-muted">(optional)</span>
          </>
        ) : (
          label
        )
      }
      hint={hint}
      error={problem}
    >
      {children}
    </FormField>
  );
}

/** A real day as the server reads one: "2030-02-30" is not one. */
function isCalendarDate(text: string): boolean {
  if (!DATE.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}

function nameProblem(name: string): string | undefined {
  if (!name) return 'Enter a name';
  return Array.from(name).length > NAME_LENGTH ? `At most ${NAME_LENGTH} characters` : undefined;
}

/** What is wrong with a new or moved date: it must be a real day, after today, within 100 years. */
function deadlineProblem(deadline: string): string | undefined {
  if (!isCalendarDate(deadline)) return 'Pick a date';
  if (deadline <= today()) return 'Pick a date after today, or clear it';
  return deadline > addMonths(today(), MAX_MONTHS)
    ? 'Pick a date within 100 years, or clear it'
    : undefined;
}

/**
 * Every field's problem at once (goals-05). A date the goal already has stays as it is, also on
 * and after its day (goals-28); a new or moved date has to be ahead.
 */
function problemsOf(terms: {
  name: string;
  target: string;
  deadline: string;
  rate: string;
  monthly: string;
  kept: string | null;
}): Problems {
  const { deadline } = terms;
  const moved = deadline !== '' && deadline !== terms.kept;
  return {
    name: nameProblem(terms.name.trim()),
    target:
      !MONEY.test(terms.target.trim()) || Number(terms.target) === 0
        ? 'Enter a sum above 0, with up to two decimals'
        : undefined,
    deadline: moved ? deadlineProblem(deadline) : undefined,
    rate: RATE.test(terms.rate.trim())
      ? undefined
      : 'Enter a percent a year from 0 to 999.9999, with up to four decimals',
    monthly:
      terms.monthly.trim() && !MONEY.test(terms.monthly.trim())
        ? 'Enter a sum with up to two decimals, or leave it empty'
        : undefined,
  };
}

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
    failed: unknown;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the terms.
  useEffect(() => {
    if (terms === null || key === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      goalsApi.preview(terms, controller.signal).then(
        (preview) => setState({ key, preview, failed: null }),
        (error) => {
          if (!isCancel(error)) setState({ key, preview: null, failed: error ?? 'failed' });
        },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (key === null) return { preview: null, failed: null, pending: false };
  // Until the answer for these terms arrives, the last one stays in view, marked as busy.
  return state === null
    ? { preview: null, failed: null, pending: true }
    : { preview: state.preview, failed: state.failed, pending: state.key !== key };
}

/** The server refused these terms: saving them would be refused the same way. */
function refusalOf(failed: unknown): string | null {
  if (!isAxiosError<{ message?: unknown }>(failed)) return null;
  const status = failed.response?.status;
  if (status !== 400 && status !== 422) return null;
  return typeof failed.response?.data?.message === 'string' && status === 422
    ? `These terms cannot be saved: ${failed.response.data.message}.`
    : 'These terms cannot be saved. Check the fields.';
}

/** Why no plan is shown: the terms are not ready, it failed, or it is on its way. */
function noPlanText(ready: boolean, failed: unknown): string {
  if (!ready) return 'Enter the sum and the return to see a plan.';
  return failed !== null
    ? 'Could not work out the plan right now. The goal can still be saved.'
    : 'Working out the plan…';
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
  /** Why the newest plan could not be worked out; null when it was. */
  failed: unknown;
  pending: boolean;
}) {
  const refusal = refusalOf(failed);
  if (refusal !== null)
    return (
      <div className="goal-preview" aria-busy={pending}>
        <Banner tone="warn">{refusal}</Banner>
      </div>
    );
  if (!ready || failed !== null || preview === null)
    return (
      <div className="goal-preview" aria-busy={ready && pending}>
        <Banner tone="info">{noPlanText(ready, failed)}</Banner>
      </div>
    );
  const tone = bannerTone[preview.status];
  return (
    <div className="goal-preview" role="status" aria-label="Plan" aria-busy={pending}>
      <Banner tone={tone} icon={tone === 'warn' || tone === 'neg' ? 'alert' : 'info'} role="none">
        {verdict(preview)} A projection, not a promise.
      </Banner>
    </div>
  );
}

const dialogWords = {
  edit: {
    title: 'Edit goal',
    submit: 'Save goal',
    unreachable:
      'Could not reach the server. The change may have been saved; saving it again is safe.',
  },
  add: {
    title: 'Add goal',
    submit: 'Add goal',
    unreachable:
      'Could not reach the server. The goal may have been added; adding it again does not add it twice.',
  },
};

/** The terms a plan is asked for, as the fields stand. */
function previewTermsOf(
  fields: {
    currency: GoalCurrency;
    target: string;
    deadline: string;
    rate: string;
    monthly: string;
  },
  goal: Goal | undefined,
): PreviewTerms {
  return {
    currency: fields.currency,
    targetAmount: fields.target.trim(),
    deadline: fields.deadline || null,
    expectedReturnPercent: fields.rate.trim(),
    monthlyContribution: fields.monthly.trim() || null,
    // The goal being changed, so a date it keeps is judged as saving it would be.
    ...(goal ? { goalId: goal.id } : {}),
  };
}

/** The portfolio now, under the sum, once the plan has it in the currency chosen. */
function portfolioHint(preview: GoalPreview | null, currency: GoalCurrency): string | undefined {
  const now = preview?.progress.current ?? null;
  return now !== null && preview?.currency === currency
    ? `Your portfolio now: ${flooredText(now, currency)}`
    : undefined;
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
  const [target, setTarget] = useState(goal ? enteredInput(goal.targetAmount) : '');
  const [deadline, setDeadline] = useState(goal?.deadline ?? '');
  const [rate, setRate] = useState(goal ? rateText(goal.expectedReturnPercent) : '8');
  const [monthly, setMonthly] = useState(
    goal?.monthlyContribution == null ? '' : enteredInput(goal.monthlyContribution),
  );
  const attempt = useAttempt();
  const kept = goal?.deadline ?? null;
  const problems = () => problemsOf({ name, target, deadline, rate, monthly, kept });
  // The plan is asked for as soon as the terms could be saved, whatever the name says.
  const ready = !hasProblems({ ...problems(), name: undefined });
  const plan = usePreview(
    ready ? previewTermsOf({ currency, target, deadline, rate, monthly }, goal) : null,
  );
  const currencyId = useId();
  const words = dialogWords[goal ? 'edit' : 'add'];

  return (
    <FormDialog
      title={words.title}
      note="A goal counts your whole portfolio. The app works out what to put in each month, or when you get there."
      submit={words.submit}
      submitVariant="secondary"
      problems={problems}
      failure={(error) => failure(error, words.unreachable)}
      size="wide"
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
      <Field label="Name" name="name">
        {(control) => (
          <Input
            {...control}
            value={name}
            autoComplete="off"
            maxLength={NAME_LENGTH}
            placeholder="e.g. Apartment down payment"
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="ui-field">
        <span className="ui-field__label" id={currencyId}>
          Currency
        </span>
        <SegmentedControl
          name="goal-currency"
          labelledBy={currencyId}
          options={['RUB', 'USD', 'EUR']}
          value={currency}
          onChange={setCurrency}
        />
      </div>
      <div className="ui-row2">
        <Field label="Sum to reach" name="target" hint={portfolioHint(plan.preview, currency)}>
          {(control) => (
            <Affix suffix={currency}>
              <Input
                {...control}
                numeric
                value={target}
                autoComplete="off"
                placeholder="0"
                onChange={(event) => setTarget(event.target.value)}
              />
            </Affix>
          )}
        </Field>
        <Field
          label="By"
          optional
          name="deadline"
          hint="Without a date the app shows when you get there."
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field
        label="Expected return, % a year"
        name="rate"
        hint="On the whole portfolio, before inflation. A projection, not a promise: the same return every year."
      >
        {(control) => (
          <div className="goal-rate">
            <ChipGroup label="Return presets">
              {PRESETS.map(([value, text]) => (
                <Chip key={value} pressed={rate.trim() === value} onClick={() => setRate(value)}>
                  {value}% <span className="ui-muted">{text}</span>
                </Chip>
              ))}
            </ChipGroup>
            <div className="goal-rate__input">
              <Affix suffix="%">
                <Input
                  {...control}
                  numeric
                  value={rate}
                  autoComplete="off"
                  onChange={(event) => setRate(event.target.value)}
                />
              </Affix>
            </div>
          </div>
        )}
      </Field>
      <Field label="You put in a month" optional name="monthly">
        {(control) => (
          <Affix suffix={currency}>
            <Input
              {...control}
              numeric
              value={monthly}
              autoComplete="off"
              placeholder="0"
              onChange={(event) => setMonthly(event.target.value)}
            />
          </Affix>
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
    <ConfirmDialog
      title="Delete this goal?"
      confirmLabel="Delete goal"
      busyLabel="Deleting…"
      failure={(error) =>
        failure(error, 'Could not reach the server. The goal may have been deleted; try again.')
      }
      onClose={onClose}
      onConfirm={async () => {
        await goalsApi.remove(goal.id);
        onDeleted();
      }}
    >
      {goal.name} and its plan are removed; this cannot be undone. Your portfolio and transactions
      stay as they are.
    </ConfirmDialog>
  );
}

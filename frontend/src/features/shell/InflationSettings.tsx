import { type CurrencyInflation, type InflationOverview, inflationApi } from '@api/inflation.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { dayText, moscowDate } from '@/utils/dates';
import { requestFailure } from '@/utils/request-failure';
import CloseButton from './CloseButton';
import { type InflationBasis, useInflationBasis } from './inflation-basis';

// INFL-UI: Settings → Inflation. The rate that values "after inflation" use: the published index
// of each currency or the owner's own yearly rate, and the months the index has not come out for.

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "2026-08" → "Aug 2026" */
export const monthText = (month: string) =>
  `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const nextMonth = (month: string) => {
  const number = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  return `${Math.floor(number / 12)}-${String((number % 12) + 1).padStart(2, '0')}`;
};

/** The months after the last official one, up to the last full Moscow calendar month, newest 12. */
export function pendingMonths(officialLastMonth: string | null, now = new Date()): string[] {
  if (officialLastMonth === null) return [];
  const thisMonth = moscowDate(now).slice(0, 7);
  const months: string[] = [];
  for (let month = nextMonth(officialLastMonth); month < thisMonth; month = nextMonth(month))
    months.push(month);
  return months.slice(-12);
}

/** "A", "A and B", "A, B and C" */
const listText = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// numeric text as the server writes it back: no trailing zeros.
const exact = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);

const percentText = (value: string | null, places = 1) =>
  value === null ? null : `${Number(value).toFixed(places)}%`;

/** A decimal percent as typed ("5", "-0,5", "7.25"), as the exact text the server takes. */
function typedPercent(text: string, min: number, max: number): string | undefined {
  const value = text.trim().replace(',', '.');
  if (!/^-?\d{1,4}(\.\d{1,8})?$/.test(value)) return undefined;
  return Number(value) > min && Number(value) < max ? value : undefined;
}

const saveFailure = (what: string) => (error: unknown) =>
  requestFailure(error, {
    unreachable: `Could not reach the server; ${what} was not saved. Try again.`,
    status: {
      400: `Check the figure and try again; ${what} was not saved.`,
      401: 'Your session has ended. Sign in again.',
    },
    fallback: `Could not save ${what}. Try again.`,
  });

/** One currency: the official rate for reference and the owner's own yearly rate beside it. */
function CurrencyRow({
  row,
  basis,
  onSaved,
}: {
  row: CurrencyInflation;
  basis: InflationBasis;
  onSaved: (rate: string | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(row.personalRatePercent ?? '');
  const [state, setState] = useState<'ready' | 'saving' | 'saved' | 'invalid' | 'failed'>('ready');
  const [failure, setFailure] = useState('');
  // What the server holds changes only through this row, so it follows the answer.
  useEffect(() => setText(row.personalRatePercent ?? ''), [row.personalRatePercent]);

  const official = percentText(row.officialTrailingYearPercent);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const rate = text.trim() === '' ? null : typedPercent(text, -50, 1000);
    if (rate === undefined) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      await inflationApi.setPersonalRate(row.currency, rate);
      onSaved(rate === null ? null : exact(rate));
      setState('saved');
    } catch (error) {
      setFailure(saveFailure(`your ${row.currency} rate`)(error));
      setState('failed');
    }
  };
  const hint = (() => {
    if (state === 'invalid')
      return 'Enter a yearly rate above -50% and below 1000%, or leave it empty to follow the official rate.';
    if (state === 'failed') return failure;
    if (state === 'saved')
      return row.personalRatePercent === null
        ? 'Saved. Your rate now follows the official one.'
        : `Saved. Your ${row.currency} rate is ${percentText(row.personalRatePercent)} a year. ${
            basis === 'personal' ? 'Real values use it now.' : 'Choose My rate above to use it.'
          }`;
    if (row.officialSource === null) return 'No official index for this currency yet.';
    if (row.officialLastMonth === null) return `No ${row.officialSource} figures loaded yet.`;
    if (row.officialTrailingYearPercent === null)
      return `${row.officialSource} has no twelve full months yet.`;
    return `Official ${official} over 12 months · published to ${monthText(row.officialLastMonth)}`;
  })();
  const alert = state === 'invalid' || state === 'failed';
  return (
    <form
      className="shell-setting shell-setting--rate"
      onSubmit={(event) => void save(event)}
      noValidate
    >
      <div className="shell-setting__text shell-setting__text--grow">
        <span id={`${id}-title`} className="shell-setting__label">
          {row.currency}
          {row.officialSource && ` · ${row.officialSource}`}
        </span>
        <p
          id={`${id}-hint`}
          className={`shell-setting__hint${alert ? ' shell-setting__hint--error' : ''}`}
          role={alert ? 'alert' : undefined}
        >
          {hint}
        </p>
      </div>
      <div className="shell-dust shell-dust--rate">
        <label id={`${id}-label`} htmlFor={`${id}-rate`} className="shell-dust__label">
          My rate a year
        </label>
        <input
          id={`${id}-rate`}
          aria-labelledby={`${id}-title ${id}-label`}
          className="ui-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={official?.replace('%', '') ?? 'Official'}
          value={text}
          disabled={state === 'saving'}
          aria-invalid={state === 'invalid' || undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setText(event.target.value);
            if (state !== 'saving') setState('ready');
          }}
        />
        <span className="shell-dust__unit" aria-hidden="true">
          %
        </span>
        <button
          type="submit"
          className="shell-button shell-button--secondary"
          disabled={state === 'saving' || text.trim() === (row.personalRatePercent ?? '')}
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/** Enter a month the index has not come out for yet; it stands in for the estimate. */
function MonthDialog({
  rows,
  onClose,
  onSaved,
}: {
  rows: CurrencyInflation[];
  onClose: () => void;
  onSaved: (currency: AccountingCurrency, month: string, changePercent: string) => void;
}) {
  const id = useId();
  const open = rows.filter((row) => pendingMonths(row.officialLastMonth).length > 0);
  const [currency, setCurrency] = useState<AccountingCurrency>(
    open[0]?.currency ?? rows[0]?.currency ?? 'USD',
  );
  const months = pendingMonths(
    rows.find((row) => row.currency === currency)?.officialLastMonth ?? null,
  );
  const [month, setMonth] = useState(months[months.length - 1] ?? '');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = typedPercent(text, -5, 20);
  const problem =
    change === undefined ? 'Enter the change for one month, between -5% and 20%' : null;
  const chosen = months.includes(month) ? month : (months[months.length - 1] ?? '');

  const field = useRef<HTMLInputElement>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (change === undefined) {
      field.current?.focus();
      return;
    }
    if (chosen === '') return;
    setSaving(true);
    setError(null);
    try {
      await inflationApi.setMonth(currency, chosen, change);
      onSaved(currency, chosen, exact(change));
    } catch (caught) {
      setError(saveFailure(`${currency} ${monthText(chosen)}`)(caught));
      setSaving(false);
    }
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size="narrow"
      onEscape={saving ? undefined : onClose}
      initialFocus={() => field.current}
    >
      <form onSubmit={(event) => void save(event)} noValidate>
        <div className="ui-modal__head">
          <h2 id={`${id}-title`}>Enter a month</h2>
          <CloseButton onClick={onClose} disabled={saving} />
          <p className="shell-note">
            Use this while the official figure isn't out yet. It replaces the estimate for that
            month only; remove it once the official figure is published.
          </p>
        </div>
        <div className="ui-modal__body">
          <div className="ui-field-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-currency`}>
                Currency
              </label>
              <select
                id={`${id}-currency`}
                className="ui-input"
                value={currency}
                disabled={saving}
                onChange={(event) => {
                  const next = event.target.value as AccountingCurrency;
                  setCurrency(next);
                  const list = pendingMonths(
                    rows.find((row) => row.currency === next)?.officialLastMonth ?? null,
                  );
                  setMonth(list[list.length - 1] ?? '');
                }}
              >
                {open.map((row) => (
                  <option key={row.currency}>{row.currency}</option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-month`}>
                Month
              </label>
              <select
                id={`${id}-month`}
                className="ui-input"
                value={chosen}
                disabled={saving}
                onChange={(event) => setMonth(event.target.value)}
              >
                {months.map((value) => (
                  <option key={value} value={value}>
                    {monthText(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-change`}>
              How much prices changed over the month, %
            </label>
            <input
              ref={field}
              id={`${id}-change`}
              className="ui-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.6"
              value={text}
              disabled={saving}
              aria-invalid={tried && problem ? true : undefined}
              aria-describedby={`${id}-change-hint`}
              onChange={(event) => setText(event.target.value)}
            />
            {tried && problem ? (
              <span className="ui-field__error" id={`${id}-change-hint`} role="alert">
                {problem}
              </span>
            ) : (
              <span className="ui-field__hint" id={`${id}-change-hint`}>
                For example 0.6 for a month when prices rose 0.6%.
              </span>
            )}
          </div>
          {error && (
            <p className="ui-banner ui-banner--neg" role="alert">
              {error}
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const basisChoices = [
  ['official', 'Official'],
  ['personal', 'My rate'],
] as const;

export default function InflationSettings() {
  const [basis, setBasis] = useInflationBasis();
  const [overview, setOverview] = useState<InflationOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [entering, setEntering] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeFailed, setRemoveFailed] = useState<string | null>(null);
  // The newest read of the rates; an older answer arriving after it would undo a newer save.
  const newest = useRef(0);

  // A save shows at once from what was sent; the server's own answer is read right after, and if
  // that read fails the page already shows what was saved.
  const changed = useCallback(
    (currency: AccountingCurrency, update: (row: CurrencyInflation) => CurrencyInflation) => {
      setOverview((current) =>
        current
          ? {
              ...current,
              currencies: current.currencies.map((row) =>
                row.currency === currency ? update(row) : row,
              ),
            }
          : current,
      );
      const mine = ++newest.current;
      inflationApi.overview().then(
        (loaded) => {
          if (mine === newest.current) setOverview(loaded);
        },
        () => undefined,
      );
    },
    [],
  );
  useEffect(() => {
    let live = true;
    const mine = ++newest.current;
    inflationApi
      .overview()
      .then((loaded) => {
        if (!live || mine !== newest.current) return;
        setOverview(loaded);
        setLoadFailed(false);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const remove = async (currency: AccountingCurrency, month: string) => {
    const key = currency + month;
    setRemoving(key);
    setRemoveFailed(null);
    try {
      await inflationApi.removeMonth(currency, month);
      changed(currency, (row) => ({
        ...row,
        manualMonths: row.manualMonths.filter((item) => item.month !== month),
      }));
    } catch {
      setRemoveFailed(key);
    } finally {
      setRemoving(null);
    }
  };

  const rows = overview?.currencies ?? [];
  const canEnter = rows.some((row) => pendingMonths(row.officialLastMonth).length > 0);
  const entered = rows.flatMap((row) => row.manualMonths.map((item) => ({ ...item, row })));
  // The full months each currency estimates: not published yet and not entered by the owner.
  const estimated = rows.flatMap((row) => {
    const months = pendingMonths(row.officialLastMonth).filter(
      (month) => !row.manualMonths.some((item) => item.month === month),
    );
    return months.length ? [`${row.currency} ${listText(months.map(monthText))}`] : [];
  });
  const syncHint = overview?.sync
    ? overview.sync.errorMessage
      ? `Last update failed: ${overview.sync.errorMessage}.`
      : overview.sync.lastSuccessAt
        ? `Official figures last loaded ${dayText(overview.sync.lastSuccessAt)}.`
        : null
    : null;

  return (
    <section className="shell-card" aria-labelledby="settings-inflation">
      <h2 id="settings-inflation">Inflation</h2>
      <p className="shell-setting__hint">
        Used by the Nominal / Real switch next to the currency, and by every deposit.
      </p>
      <div className="shell-setting">
        <div className="shell-setting__text">
          <span id="settings-inflation-basis" className="shell-setting__label">
            Rate for real values
          </span>
          <p id="settings-inflation-basis-hint" className="shell-setting__hint">
            {basis === 'official'
              ? 'Official indexes, loaded every month. Saved in this browser.'
              : 'Your own yearly rate for each currency; a currency without one follows the official rate. Saved in this browser.'}
          </p>
        </div>
        <SegmentedControl<InflationBasis>
          name="inflation-basis"
          labelledBy="settings-inflation-basis"
          describedBy="settings-inflation-basis-hint"
          options={basisChoices}
          value={basis}
          onChange={setBasis}
        />
      </div>
      {overview === null ? (
        <p
          className="shell-setting__hint"
          role={loadFailed ? 'alert' : undefined}
          aria-busy={!loadFailed}
        >
          {loadFailed ? 'Could not load the inflation rates; try again later.' : 'Loading…'}
        </p>
      ) : (
        <>
          {rows.map((row) => (
            <CurrencyRow
              key={row.currency}
              row={row}
              basis={basis}
              onSaved={(rate) =>
                changed(row.currency, (current) => ({ ...current, personalRatePercent: rate }))
              }
            />
          ))}
          <div className="shell-setting">
            <div className="shell-setting__text">
              <span className="shell-setting__label">Months not published yet</span>
              <p className="shell-setting__hint">
                {estimated.length > 0 && `${estimated.join('; ')}. `}Until a figure comes out, a
                month uses the last 12-month rate and is marked as estimated. {syncHint}
              </p>
            </div>
            <button
              type="button"
              className="shell-button shell-button--secondary"
              disabled={!canEnter}
              onClick={() => setEntering(true)}
            >
              Enter a month
            </button>
          </div>
          {entered.map(({ row, month, changePercent }) => {
            const key = row.currency + month;
            const out = row.officialLastMonth !== null && month <= row.officialLastMonth;
            return (
              <div className="shell-setting" key={key}>
                <div className="shell-setting__text">
                  <span className="shell-setting__label">
                    {row.currency} · {monthText(month)}
                  </span>
                  <p
                    className={`shell-setting__hint${removeFailed === key ? ' shell-setting__hint--error' : ''}`}
                    role={removeFailed === key ? 'alert' : undefined}
                  >
                    {removeFailed === key
                      ? `Could not remove ${row.currency} ${monthText(month)}. Try again.`
                      : `Entered by you · prices ${Number(changePercent) >= 0 ? 'rose' : 'fell'} ${Math.abs(Number(changePercent)).toFixed(2)}% over the month${
                          out
                            ? '. The official figure is out; yours is used until you remove it.'
                            : ''
                        }`}
                  </p>
                </div>
                <button
                  type="button"
                  className="shell-button shell-button--secondary"
                  disabled={removing !== null}
                  aria-label={`Remove ${row.currency} ${monthText(month)}`}
                  onClick={() => void remove(row.currency, month)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </>
      )}
      {entering && (
        <MonthDialog
          rows={rows}
          onClose={() => setEntering(false)}
          onSaved={(currency, month, changePercent) => {
            changed(currency, (row) => ({
              ...row,
              manualMonths: [
                ...row.manualMonths.filter((item) => item.month !== month),
                { month, changePercent },
              ].sort((a, b) => a.month.localeCompare(b.month)),
            }));
            setEntering(false);
          }}
        />
      )}
    </section>
  );
}

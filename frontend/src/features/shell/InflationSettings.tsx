import { type CurrencyInflation, type InflationOverview, inflationApi } from '@api/inflation.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { useToast } from '@contexts/ToastContext';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ErrorState } from '@/ui/ErrorState';
import { Field } from '@/ui/Field';
import { Affix, Input, Select } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { SettingRow } from '@/ui/SettingRow';
import { dayText, moscowDate } from '@/utils/dates';
import { requestFailure } from '@/utils/request-failure';
import { type InflationBasis, useInflationBasis } from './inflation-basis';
import { Bone } from './Skeleton';

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
  const toast = useToast();
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
      const message = saveFailure(`your ${row.currency} rate`)(error);
      setFailure(message);
      setState('failed');
      toast.show({
        tone: 'error',
        title: `Could not save your ${row.currency} rate`,
        detail: message,
      });
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
    <form onSubmit={(event) => void save(event)} noValidate>
      <SettingRow
        title={
          <span id={`${id}-title`}>
            {row.currency}
            {row.officialSource && ` · ${row.officialSource}`}
          </span>
        }
        description={
          <span id={`${id}-hint`} role={alert ? 'alert' : undefined}>
            {hint}
          </span>
        }
        control={
          <>
            <label id={`${id}-label`} htmlFor={`${id}-rate`} className="ui-soft">
              My rate a year
            </label>
            <div style={{ width: '6.5rem' }}>
              <Affix suffix="%">
                <Input
                  id={`${id}-rate`}
                  aria-labelledby={`${id}-title ${id}-label`}
                  numeric
                  type="text"
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
              </Affix>
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={state === 'saving' || text.trim() === (row.personalRatePercent ?? '')}
            >
              {state === 'saving' ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
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
        <ModalHeader
          titleId={`${id}-title`}
          title="Enter a month"
          onClose={onClose}
          closeDisabled={saving}
          intro="Use this while the official figure isn't out yet. It replaces the estimate for that month only; remove it once the official figure is published."
        />
        <ModalBody>
          <div className="ui-row2">
            <Field label="Currency" id={`${id}-currency`}>
              {(control) => (
                <Select
                  {...control}
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
                </Select>
              )}
            </Field>
            <Field label="Month" id={`${id}-month`}>
              {(control) => (
                <Select
                  {...control}
                  value={chosen}
                  disabled={saving}
                  onChange={(event) => setMonth(event.target.value)}
                >
                  {months.map((value) => (
                    <option key={value} value={value}>
                      {monthText(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field
            label="How much prices changed over the month, %"
            id={`${id}-change`}
            hint="For example 0.6 for a month when prices rose 0.6%."
            error={tried ? problem : null}
          >
            {(control) => (
              <Input
                {...control}
                ref={field}
                numeric
                autoComplete="off"
                placeholder="0.6"
                value={text}
                disabled={saving}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </Field>
          {(error ?? (tried ? problem : null)) && <Banner tone="neg">{error ?? problem}</Banner>}
        </ModalBody>
        <ModalFooter>
          <span className="ui-grow" />
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </ModalFooter>
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
  const toast = useToast();

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
  const load = useCallback(() => {
    const mine = ++newest.current;
    setLoadFailed(false);
    inflationApi
      .overview()
      .then((loaded) => {
        if (mine === newest.current) setOverview(loaded);
      })
      .catch(() => mine === newest.current && setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
    return () => {
      newest.current++;
    };
  }, [load]);
  const retry = load;

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
      toast.show({ tone: 'success', title: `${currency} ${monthText(month)} removed` });
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
    <Card labelledBy="settings-inflation">
      <CardHeader id="settings-inflation" title="Inflation" />
      <p className="ui-sub">
        Used by the Nominal / Real switch next to the currency, and by every deposit.
      </p>
      <SettingRow
        title="Rate for real values"
        titleId="settings-inflation-basis"
        description={
          <span id="settings-inflation-basis-hint">
            {basis === 'official'
              ? 'Official indexes, loaded every month. Saved in this browser.'
              : 'Your own yearly rate for each currency; a currency without one follows the official rate. Saved in this browser.'}
          </span>
        }
        control={
          <SegmentedControl<InflationBasis>
            name="inflation-basis"
            labelledBy="settings-inflation-basis"
            describedBy="settings-inflation-basis-hint"
            options={basisChoices}
            value={basis}
            onChange={setBasis}
          />
        }
      />
      {overview === null ? (
        loadFailed ? (
          <ErrorState onRetry={retry}>
            Could not load the inflation rates; try again later.
          </ErrorState>
        ) : (
          <p className="ui-sub" aria-busy="true">
            <Bone width="60%" height={12} />
          </p>
        )
      ) : (
        <>
          {rows.map((row) => (
            <CurrencyRow
              key={row.currency}
              row={row}
              basis={basis}
              onSaved={(rate) => {
                changed(row.currency, (current) => ({ ...current, personalRatePercent: rate }));
                toast.show({ tone: 'success', title: `${row.currency} rate saved` });
              }}
            />
          ))}
          <SettingRow
            title="Months not published yet"
            description={`${estimated.length > 0 ? `${estimated.join('; ')}. ` : ''}Until a figure comes out, a month uses the last 12-month rate and is marked as estimated. ${syncHint ?? ''}`.trim()}
            control={
              <Button
                variant="secondary"
                size="sm"
                disabled={!canEnter}
                onClick={() => setEntering(true)}
              >
                Enter a month
              </Button>
            }
          />
          {entered.map(({ row, month, changePercent }) => {
            const key = row.currency + month;
            const out = row.officialLastMonth !== null && month <= row.officialLastMonth;
            return (
              <SettingRow
                key={key}
                title={`${row.currency} · ${monthText(month)}`}
                description={
                  <span role={removeFailed === key ? 'alert' : undefined}>
                    {removeFailed === key
                      ? `Could not remove ${row.currency} ${monthText(month)}. Try again.`
                      : `Entered by you · prices ${Number(changePercent) >= 0 ? 'rose' : 'fell'} ${Math.abs(Number(changePercent)).toFixed(2)}% over the month${
                          out
                            ? '. The official figure is out; yours is used until you remove it.'
                            : ''
                        }`}
                  </span>
                }
                control={
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={removing !== null}
                    aria-label={`Remove ${row.currency} ${monthText(month)}`}
                    onClick={() => void remove(row.currency, month)}
                  >
                    Remove
                  </Button>
                }
              />
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
            toast.show({ tone: 'success', title: `${currency} ${monthText(month)} entered` });
          }}
        />
      )}
    </Card>
  );
}

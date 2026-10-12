import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import { manualPricesApi } from '@api/manual-prices.api';
import {
  type PortfolioAsset,
  portfolioAssetsApi,
  type ValuationCurrency,
} from '@api/portfolio-assets.api';
import { type TradeReceipt, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useId, useRef, useState } from 'react';
import Modal from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { unitPrice } from '../portfolio/add-asset';
import { bankRate, numberProblem } from '../portfolio/add-transaction';
import CloseButton from '../shell/CloseButton';
import {
  MAX_PROPERTY_NAME,
  type PropertyEntry,
  type PropertyProblem,
  propertyAsset,
  propertyKinds,
  propertyName,
  propertyProblems,
  purchaseTrade,
} from './property';
import './property.css';

const currencies: ValuationCurrency[] = ['USD', 'EUR', 'RUB'];
const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);
const utcDay = (now: Date) => now.toISOString().slice(0, 10);

const problemText: Record<PropertyProblem, string> = {
  name: `Keep the name on one line, within ${MAX_PROPERTY_NAME} characters`,
  cost: 'Enter what you paid',
  bought: 'Enter a date that is not in the future',
  estimate: 'Enter a value greater than 0, or leave it empty',
  share: 'A share from 0.01 to 100%',
};

const failure = (error: unknown, saved: string) => {
  const code = status(error);
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  if (code === 409 && message.includes('Bank of Russia rate'))
    return `${saved}No Bank of Russia rate is stored for the purchase day; try again later.`;
  return `${saved}${requestFailure(error, {
    unreachable: 'Could not reach the server. Try again; the same request will not save it twice.',
    status: {
      400: 'Check the fields and try again.',
      401: 'Your session has ended. Sign in again.',
    },
    fallback: 'Try again.',
  })}`;
};

interface Props {
  onClose: () => void;
  onAdded: (asset: PortfolioAsset) => void;
}

interface Saved {
  accountId: string | null;
  asset: PortfolioAsset | null;
  receipt: TradeReceipt | null;
  /** How many of the property's prices are saved: the purchase, then today's estimate. */
  prices: number;
}

// "Add property" from the accepted mockups (v8): an apartment, a house, land or parking at the
// owner's own estimate. It gets an account of its own, so it shows under Real estate, and its
// purchase counts as money put in on the day it was bought.
export default function AddPropertyDialog({ onClose, onAdded }: Props) {
  const [entry, setEntry] = useState<PropertyEntry>(() => ({
    kind: 'Apartment',
    name: '',
    currency: 'RUB',
    cost: '',
    bought: utcDay(new Date()),
    estimate: '',
    share: '100',
  }));
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<PropertyProblem>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What is saved stays saved: a retry adds only what is still missing, under the same ids.
  const saved = useRef<Saved>({ accountId: null, asset: null, receipt: null, prices: 0 });
  const requests = useRef({
    account: newRequestId(),
    asset: newRequestId(),
    trade: newRequestId(),
    prices: [newRequestId(), newRequestId()],
  });
  const startedAt = useRef<Date | null>(null);
  const [locked, setLocked] = useState(false);
  const id = useId();
  const first = useRef<HTMLInputElement>(null);

  // Closing keeps what cannot be taken back: once the property itself is saved, its page opens,
  // as Add asset does, and its purchase can be added there. An account made for a property that
  // was never saved holds nothing, so it goes rather than stay out of reach.
  const finish = () => {
    const done = saved.current;
    if (done.asset) return onAdded(done.asset);
    if (done.accountId) void accountingApi.removeAccount(done.accountId).catch(() => undefined);
    onClose();
  };
  const update = (changes: Partial<PropertyEntry>) =>
    setEntry((current) => ({ ...current, ...changes }));
  const leave = (problem: PropertyProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  const all = propertyProblems(entry, utcDay(new Date()));
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));
  const fieldError = (problem: PropertyProblem, value = '') =>
    found.has(problem) && (
      <span className="ui-field__error" id={`${id}-${problem}-error`}>
        {numberProblem(value, problemText[problem])}
      </span>
    );
  const invalid = (problem: PropertyProblem) =>
    found.has(problem)
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` }
      : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const now = startedAt.current ?? new Date();
    if (propertyProblems(entry, utcDay(now)).size) return;
    setSaving(true);
    setError(null);
    const done = saved.current;
    const estimate = entry.estimate.trim();
    // Today's estimate is kept in USD: a RUB or EUR one needs today's Bank of Russia rate, so
    // without it nothing is saved.
    let perUsd = '1';
    if (estimate && entry.currency !== 'USD' && done.prices < 2) {
      const currency = entry.currency;
      const rate = await cachedReads.rates.load().then(
        (report) => bankRate(currency, report),
        () => null,
      );
      if (rate === null) {
        setError(
          done.asset
            ? 'The property is saved, but no Bank of Russia rate is stored for today, so its estimate cannot be converted yet. Try again later.'
            : `No Bank of Russia rate is stored for today yet, so the ${currency} estimate cannot be converted. Nothing was saved; try again later.`,
        );
        setSaving(false);
        return;
      }
      perUsd = rate;
    }
    startedAt.current = now;
    setLocked(true);
    const name = propertyName(entry);
    try {
      if (!done.accountId) {
        const account = await accountingApi.createAccount({
          requestId: requests.current.account,
          name,
          assetClass: 'property',
        });
        done.accountId = account.id;
      }
      if (!done.asset)
        done.asset = await portfolioAssetsApi.create({
          requestId: requests.current.asset,
          ...propertyAsset(entry),
        });
    } catch (caught) {
      setError(failure(caught, 'Nothing was saved. '));
      setSaving(false);
      return;
    }
    const asset = done.asset;
    try {
      // A new account has no journal yet, so its first trade starts it at revision 0.
      done.receipt ??= await tradesApi.create(
        done.accountId,
        purchaseTrade(entry, asset.id, now, {
          requestId: requests.current.trade,
          expectedJournalRevision: 0,
        }),
      );
    } catch (caught) {
      setError(failure(caught, 'The property was added, but its purchase was not saved. '));
      setSaving(false);
      return;
    }
    const trade = done.receipt.trade;
    // The whole property's price: what it cost on the purchase day, then today's estimate. One
    // bought today starts at the estimate.
    const estimateUsd = estimate ? unitPrice(estimate, perUsd) : null;
    const boughtToday = entry.bought === utcDay(now);
    const prices = [
      {
        observedAt: trade.occurredAt,
        priceUsd:
          boughtToday && estimateUsd ? estimateUsd : unitPrice(trade.grossUsd, trade.quantity),
      },
      ...(estimateUsd && !boughtToday
        ? [{ observedAt: `${now.toISOString().slice(0, 19)}Z`, priceUsd: estimateUsd }]
        : []),
    ];
    try {
      for (let index = done.prices; index < prices.length; index++) {
        await manualPricesApi.set(asset.id, {
          requestId: requests.current.prices[index],
          expectedRevision: index,
          ...prices[index],
          assertReviewed: true,
        });
        done.prices = index + 1;
      }
    } catch {
      setError('The property and its purchase were saved, but its value was not. Try again.');
      setSaving(false);
      return;
    }
    onAdded(asset);
  };

  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={saving ? undefined : finish}
      initialFocus={() => first.current}
    >
      <form onSubmit={submit} noValidate>
        <div className="ui-modal__head">
          <h2 id={`${id}-title`}>Add property</h2>
          <CloseButton onClick={finish} disabled={saving} />
          <p className="shell-note">
            An apartment, a house, land or parking, valued at your own estimate.
          </p>
        </div>
        <div className="ui-modal__body">
          <div className="ui-field property-kinds">
            <span id={`${id}-kind`} className="ui-field__label">
              Kind
            </span>
            <SegmentedControl
              name={`${id}-kind`}
              labelledBy={`${id}-kind`}
              options={propertyKinds}
              value={entry.kind}
              disabled={locked}
              onChange={(kind) => update({ kind })}
            />
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-name`}>
              Name (optional)
            </label>
            <input
              id={`${id}-name`}
              ref={first}
              className="ui-input"
              maxLength={MAX_PROPERTY_NAME}
              autoComplete="off"
              placeholder={entry.kind}
              value={entry.name}
              disabled={locked}
              onChange={(event) => update({ name: event.target.value })}
              onBlur={leave('name')}
              {...invalid('name')}
            />
            {fieldError('name')}
          </div>
          <div className="ui-field">
            <span id={`${id}-currency`} className="ui-field__label">
              Currency
            </span>
            <SegmentedControl
              name={`${id}-currency`}
              labelledBy={`${id}-currency`}
              options={currencies}
              value={entry.currency}
              disabled={locked}
              onChange={(currency) => update({ currency })}
            />
          </div>
          <div className="ui-field-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-cost`}>
                Purchase price
              </label>
              <span className="ui-affix">
                <input
                  id={`${id}-cost`}
                  className="ui-input"
                  inputMode="decimal"
                  placeholder="0"
                  value={entry.cost}
                  disabled={locked}
                  onChange={(event) => update({ cost: event.target.value })}
                  onBlur={leave('cost')}
                  {...invalid('cost')}
                />
                <span className="ui-affix__suffix">{entry.currency}</span>
              </span>
              {fieldError('cost', entry.cost)}
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-bought`}>
                Bought on
              </label>
              <input
                id={`${id}-bought`}
                className="ui-input"
                type="date"
                max={utcDay(new Date())}
                value={entry.bought}
                disabled={locked}
                onChange={(event) => update({ bought: event.target.value })}
                onBlur={leave('bought')}
                {...invalid('bought')}
              />
              {fieldError('bought')}
            </div>
          </div>
          <div className="ui-field-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-estimate`}>
                What it is worth now (optional)
              </label>
              <span className="ui-affix">
                <input
                  id={`${id}-estimate`}
                  className="ui-input"
                  inputMode="decimal"
                  placeholder="Same as purchase"
                  value={entry.estimate}
                  disabled={locked}
                  onChange={(event) => update({ estimate: event.target.value })}
                  onBlur={leave('estimate')}
                  aria-describedby={found.has('estimate') ? undefined : `${id}-estimate-hint`}
                  {...invalid('estimate')}
                />
                <span className="ui-affix__suffix">{entry.currency}</span>
              </span>
              {fieldError('estimate', entry.estimate) || (
                <span className="ui-field__hint" id={`${id}-estimate-hint`}>
                  Your estimate. Update it whenever you like.
                </span>
              )}
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-share`}>
                Your share
              </label>
              <span className="ui-affix">
                <input
                  id={`${id}-share`}
                  className="ui-input"
                  inputMode="decimal"
                  value={entry.share}
                  disabled={locked}
                  onChange={(event) => update({ share: event.target.value })}
                  onBlur={leave('share')}
                  {...invalid('share')}
                />
                <span className="ui-affix__suffix">%</span>
              </span>
              {fieldError('share', entry.share)}
            </div>
          </div>
          <p className="ui-modal__info" role="note">
            Your share of the purchase price counts as money put in on the day you bought it. Later
            estimates count as market movement.
          </p>
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
            onClick={finish}
            disabled={saving}
          >
            {saved.current.asset ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
            Add property
          </button>
        </div>
      </form>
    </Modal>
  );
}

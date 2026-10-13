import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
import { manualPricesApi } from '@api/manual-prices.api';
import {
  type NewPortfolioAsset,
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
import { ambiguousComma, numberProblem } from '../portfolio/add-transaction';
import CloseButton from '../shell/CloseButton';
import { Icon } from '../shell/icons';
import {
  type BrokerEntry,
  type BrokerProblem,
  blankPosition,
  brokerAccountName,
  brokerAccountTypes,
  brokerProblems,
  convertible,
  filledPositions,
  freshRates,
  holdingTrade,
  MAX_BROKER_NAME,
  MAX_POSITIONS,
  MAX_TICKER,
  moscowDate,
  type PositionEntry,
  type PositionField,
  positionAsset,
  times,
} from './broker';
import './broker.css';

const currencies: ValuationCurrency[] = ['USD', 'EUR', 'RUB'];
const accountTypes: Record<(typeof brokerAccountTypes)[number], string> = {
  Regular: 'Regular',
  IIS: 'Individual investment (IIS)',
};
const cashNames: Record<ValuationCurrency, string> = {
  USD: 'US dollar',
  EUR: 'Euro',
  RUB: 'Russian ruble',
};
const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

const failure = (error: unknown, saved: string) => {
  const code = status(error);
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  if (code === 409 && message.includes('Bank of Russia rate'))
    return `${saved}No Bank of Russia rate is stored for today; try again later.`;
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
  /** Something was saved: the account, with what it holds or part of it. */
  onAdded: () => void;
}

/** One holding as it is saved: the asset, the buy that gives it a balance, then its price. */
interface SavedHolding {
  asset: PortfolioAsset | null;
  /** The asset this form asks to make; asked again under the same id, it finds the same one. */
  making: NewPortfolioAsset | null;
  /** The cash asset was hidden: it is shown for the buy, and hidden again if none is saved. */
  wasHidden: boolean;
  shown: boolean;
  receipt: TradeReceipt | null;
  /** A buy went out and no definite answer came back, so it may be saved. */
  unsure: boolean;
  priced: boolean;
}

interface Saved {
  accountId: string | null;
  /** The account request went out and no definite answer came back, so it may be saved. */
  accountUnsure: boolean;
  /** The account's journal revision the next buy expects. */
  revision: number;
  holdings: SavedHolding[];
}

interface Holding {
  quantity: string;
  total: string;
  /** The asset to make; null for cash, which goes to the owner's cash asset in the currency. */
  position: PositionEntry | null;
}

// "Add broker account" from the accepted mockups (v8): the broker, what the account holds at the
// price seen there now, and its cash. Each position becomes an asset priced by hand; everything
// held counts as money put in today, so the gain starts from here.
export default function AddBrokerDialog({ onClose, onAdded }: Props) {
  const [entry, setEntry] = useState<BrokerEntry>(() => ({
    broker: '',
    account: 'Regular',
    currency: 'USD',
    positions: [blankPosition()],
    cash: '',
  }));
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<BrokerProblem>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What is saved stays saved: a retry adds only what is still missing, under the same ids.
  const saved = useRef<Saved>({
    accountId: null,
    accountUnsure: false,
    revision: 0,
    holdings: [],
  });
  const requests = useRef<{ account: string; holdings: string[][] }>({
    account: newRequestId(),
    holdings: [],
  });
  const startedAt = useRef<Date | null>(null);
  const retried = useRef(false);
  const [locked, setLocked] = useState(false);
  const id = useId();
  const first = useRef<HTMLInputElement>(null);

  // Closing keeps what cannot be taken back: once anything it holds is saved, the account stays
  // and Brokers shows it. An account that holds nothing yet goes rather than stay out of reach.
  // A request whose answer was lost is asked again under the same id, which finds what it made.
  // An asset this form made, or showed again, without a saved buy would show as an empty asset
  // in Portfolio, so it is hidden. A buy whose answer was lost may have been saved: its asset is
  // hidden only once the account is gone (the server removes only an account without trades) or
  // has no trade in it at all. Whatever cannot be settled now keeps the form open, so closing
  // again retries; a second failure closes it and leaves the rest as it is.
  const finish = async () => {
    const done = saved.current;
    setSaving(true);
    setError(null);
    let settled = true;
    // Whether a failed request got a definite answer; without one, nothing is settled yet.
    const definite = (caught: unknown) => {
      const code = status(caught);
      if (code === undefined || code >= 500) settled = false;
      return code !== undefined && code < 500;
    };
    await Promise.all(
      done.holdings.map(async (step) => {
        if (!step.asset && step.making)
          step.asset = await portfolioAssetsApi.create(step.making).catch((caught) => {
            if (definite(caught)) step.making = null;
            return null;
          });
      }),
    );
    if (!done.accountId && done.accountUnsure)
      done.accountId = await accountingApi.createAccount(accountRequest()).then(
        (account) => {
          done.accountUnsure = false;
          return account.id;
        },
        (caught) => {
          if (definite(caught)) done.accountUnsure = false;
          return null;
        },
      );
    const kept = done.holdings.some((step) => step.receipt);
    // A 404 for the account this form made means it is already gone.
    if (!kept && done.accountId) {
      const removed = await accountingApi.removeAccount(done.accountId).then(
        () => true,
        (caught) => definite(caught) && status(caught) === 404,
      );
      if (removed) done.accountId = null;
    }
    const bare = !kept && !done.accountId && !done.accountUnsure;
    const accountId = done.accountId;
    const doubtful = done.holdings.some((step) => step.unsure && !step.receipt);
    const traded =
      doubtful && !bare && accountId
        ? await tradesApi.list(accountId).then(
            (page) =>
              page.nextOffset === null
                ? new Set(page.items.map((trade) => trade.instrumentId))
                : null,
            (caught) => {
              definite(caught);
              return null;
            },
          )
        : null;
    const empty = (step: SavedHolding) =>
      !!step.asset &&
      !!(step.making || step.wasHidden) &&
      !step.receipt &&
      (!step.unsure || bare || (traded !== null && !traded.has(step.asset.id)));
    const hidden = await Promise.allSettled(
      done.holdings.flatMap((step) =>
        step.asset && empty(step) ? [hiddenAssetsApi.hide(step.asset.id)] : [],
      ),
    );
    // An asset that is gone needs no hiding.
    for (const result of hidden) if (result.status === 'rejected') definite(result.reason);
    if (!settled && !retried.current) {
      retried.current = true;
      setError(
        'Could not undo everything this form added. Close the form again to retry; if that fails too, it closes and leaves the rest as it is.',
      );
      setSaving(false);
      return;
    }
    if (bare) onClose();
    else onAdded();
  };
  const accountRequest = () => ({
    requestId: requests.current.account,
    name: brokerAccountName(entry),
    assetClass: 'broker' as const,
  });
  const update = (changes: Partial<BrokerEntry>) =>
    setEntry((current) => ({ ...current, ...changes }));
  const updatePosition = (index: number, changes: Partial<PositionEntry>) =>
    setEntry((current) => ({
      ...current,
      positions: current.positions.map((position, at) =>
        at === index ? { ...position, ...changes } : position,
      ),
    }));
  const leave = (problem: BrokerProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  const all = brokerProblems(entry);
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));
  const invalid = (problem: BrokerProblem, describedBy = `${id}-${problem}-error`) =>
    found.has(problem) ? { 'aria-invalid': true, 'aria-describedby': describedBy } : {};
  const positionProblem = entry.positions.some((_, index) =>
    (['ticker', 'quantity', 'price'] as const).some((field) => found.has(`${field}-${index}`)),
  );
  const disabled = locked || saving;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (brokerProblems(entry).size) return;
    setSaving(true);
    setError(null);
    const done = saved.current;
    // RUB and EUR amounts are converted at a recent Bank of Russia rate: without one nothing would
    // be held, so nothing is saved, and neither is anything while the rates cannot be read.
    const currency = entry.currency;
    const now = startedAt.current ?? new Date();
    const cash = entry.cash.trim();
    const holdings: Holding[] = [
      ...filledPositions(entry).map((position) => ({
        quantity: position.quantity,
        total: times(position.quantity, position.price),
        position,
      })),
      ...(cash ? [{ quantity: cash, total: cash, position: null }] : []),
    ];
    if (currency !== 'USD' && !done.accountId) {
      // An amount that converts to zero dollars, or past what the server keeps, is refused too.
      const check = await cachedReads.rates.load().then(
        (report) =>
          !freshRates(currency, report, moscowDate(now))
            ? ('stale' as const)
            : holdings.every(({ total }) => convertible(total, currency, report))
              ? ('ok' as const)
              : ('amount' as const),
        () => 'unread' as const,
      );
      if (check !== 'ok') {
        setError(
          {
            unread: `Could not check the Bank of Russia rate for ${currency}. Nothing was saved; try again.`,
            stale: `No recent Bank of Russia rate is stored, so ${currency} amounts cannot be converted. Nothing was saved; try again later.`,
            amount: `An amount is too small or too large to convert to US dollars at the Bank of Russia rate. Nothing was saved; change it and try again.`,
          }[check],
        );
        setSaving(false);
        return;
      }
    }
    startedAt.current = now;
    setLocked(true);
    while (requests.current.holdings.length < holdings.length)
      requests.current.holdings.push([newRequestId(), newRequestId(), newRequestId()]);
    while (done.holdings.length < holdings.length)
      done.holdings.push({
        asset: null,
        making: null,
        wasHidden: false,
        shown: false,
        receipt: null,
        unsure: false,
        priced: false,
      });

    if (!done.accountId) {
      try {
        const account = await accountingApi.createAccount(accountRequest());
        done.accountId = account.id;
      } catch (caught) {
        const code = status(caught);
        done.accountUnsure = code === undefined || code >= 500;
        setError(failure(caught, 'Nothing was saved. '));
        setSaving(false);
        return;
      }
    }
    const accountId = done.accountId;
    const partly = 'The account was added, but not all it holds was saved. ';
    for (const [index, holding] of holdings.entries()) {
      const step = done.holdings[index];
      const [assetRequest, tradeRequest, priceRequest] = requests.current.holdings[index];
      try {
        const asset =
          step.asset ?? (await assetFor(step, holding.position, currency, assetRequest));
        // A hidden cash asset is left out of Portfolio, so the cash held here would not count.
        if (step.wasHidden && !step.shown) {
          await hiddenAssetsApi.show(asset.id);
          step.shown = true;
        }
        if (!step.receipt) {
          try {
            step.receipt = await tradesApi.create(
              accountId,
              holdingTrade({ ...holding, currency }, asset.id, now, {
                requestId: tradeRequest,
                expectedJournalRevision: done.revision,
              }),
            );
          } catch (caught) {
            // Without an answer, or after a server error, the buy may have been saved.
            const code = status(caught);
            step.unsure = code === undefined || code >= 500;
            throw caught;
          }
          step.unsure = false;
          done.revision = step.receipt.journalRevision;
        }
        // A position starts at the price it was entered with; cash is always worth its amount.
        if (asset.priceSource === 'manual' && !step.priced) {
          const trade = step.receipt.trade;
          await manualPricesApi.set(asset.id, {
            requestId: priceRequest,
            expectedRevision: 0,
            observedAt: trade.occurredAt,
            priceUsd: unitPrice(trade.grossUsd, trade.quantity),
            assertReviewed: true,
          });
          step.priced = true;
        }
      } catch (caught) {
        setError(failure(caught, partly));
        setSaving(false);
        return;
      }
    }
    onAdded();
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
          <h2 id={`${id}-title`}>Add broker account</h2>
          <CloseButton onClick={finish} disabled={saving} />
          <p className="shell-note">Stocks, bonds and funds at a broker, at prices you enter.</p>
        </div>
        <div className="ui-modal__body">
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-broker`}>
              Broker
            </label>
            <input
              id={`${id}-broker`}
              ref={first}
              className="ui-input"
              maxLength={MAX_BROKER_NAME}
              autoComplete="off"
              placeholder="e.g. Sample Broker"
              value={entry.broker}
              disabled={disabled}
              onChange={(event) => update({ broker: event.target.value })}
              onBlur={leave('broker')}
              {...invalid('broker')}
            />
            {found.has('broker') && (
              <span className="ui-field__error" id={`${id}-broker-error`}>
                Enter the broker, on one line
              </span>
            )}
          </div>
          <div className="ui-field broker-account-type">
            <span id={`${id}-account`} className="ui-field__label">
              Account
            </span>
            <SegmentedControl
              name={`${id}-account`}
              labelledBy={`${id}-account`}
              options={brokerAccountTypes.map((value) => [value, accountTypes[value]] as const)}
              value={entry.account}
              disabled={disabled}
              onChange={(account) => update({ account })}
            />
          </div>
          <div className="ui-field">
            <span id={`${id}-currency`} className="ui-field__label">
              Currency of the prices
            </span>
            <SegmentedControl
              name={`${id}-currency`}
              labelledBy={`${id}-currency`}
              options={currencies}
              value={entry.currency}
              disabled={disabled}
              onChange={(currency) => update({ currency })}
            />
          </div>
          <fieldset className="ui-field broker-positions">
            <legend className="ui-field__label">What it holds</legend>
            <div className="broker-positions__grid">
              <span className="broker-positions__head" aria-hidden="true">
                Ticker or name
              </span>
              <span className="broker-positions__head" aria-hidden="true">
                Quantity
              </span>
              <span className="broker-positions__head" aria-hidden="true">
                Price now, {entry.currency}
              </span>
              {entry.positions.map((position, index) => {
                const field = (name: PositionField) => `${name}-${index}` as const;
                const row = index + 1;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are only ever added at the end.
                  <div key={index} className="broker-positions__row">
                    <input
                      className="ui-input"
                      aria-label={`Ticker or name ${row}`}
                      maxLength={MAX_TICKER}
                      autoComplete="off"
                      placeholder="VWRA"
                      value={position.ticker}
                      disabled={disabled}
                      onChange={(event) => updatePosition(index, { ticker: event.target.value })}
                      onBlur={leave(field('ticker'))}
                      {...invalid(field('ticker'), `${id}-positions-error`)}
                    />
                    <input
                      className="ui-input"
                      aria-label={`Quantity ${row}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={position.quantity}
                      disabled={disabled}
                      onChange={(event) => updatePosition(index, { quantity: event.target.value })}
                      onBlur={leave(field('quantity'))}
                      {...invalid(field('quantity'), `${id}-positions-error`)}
                    />
                    <input
                      className="ui-input"
                      aria-label={`Price ${row}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={position.price}
                      disabled={disabled}
                      onChange={(event) => updatePosition(index, { price: event.target.value })}
                      onBlur={leave(field('price'))}
                      {...invalid(field('price'), `${id}-positions-error`)}
                    />
                  </div>
                );
              })}
            </div>
            {entry.positions.length < MAX_POSITIONS && (
              <button
                type="button"
                className="shell-button shell-button--ghost broker-positions__add"
                disabled={disabled}
                onClick={() => update({ positions: [...entry.positions, blankPosition()] })}
              >
                <Icon name="plus" className="shell-icon shell-icon--sm" />
                Add position
              </button>
            )}
            {positionProblem ? (
              <span className="ui-field__error" id={`${id}-positions-error`}>
                {entry.positions.some((position) =>
                  [position.quantity, position.price].some(ambiguousComma),
                )
                  ? numberProblem('1,000', '')
                  : 'Fill in the ticker, the quantity and the price of each position, or clear the row'}
              </span>
            ) : (
              found.has('holdings') && (
                <span className="ui-field__error" role="alert">
                  Add a position or the cash at the broker
                </span>
              )
            )}
          </fieldset>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-cash`}>
              Cash at the broker (optional)
            </label>
            <span className="ui-affix">
              <input
                id={`${id}-cash`}
                className="ui-input"
                inputMode="decimal"
                placeholder="0"
                value={entry.cash}
                disabled={disabled}
                onChange={(event) => update({ cash: event.target.value })}
                onBlur={leave('cash')}
                {...invalid('cash')}
              />
              <span className="ui-affix__suffix">{entry.currency}</span>
            </span>
            {found.has('cash') && (
              <span className="ui-field__error" id={`${id}-cash-error`}>
                {numberProblem(entry.cash, 'Enter an amount greater than 0, or leave it empty')}
              </span>
            )}
          </div>
          <p className="ui-modal__info" role="note">
            Prices for stocks and funds aren't loaded yet: update them on the position's page.
            Adding the account counts as money put in.
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
            {saved.current.holdings.some((holding) => holding.receipt) ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="shell-button shell-button--primary" disabled={saving}>
            Add account
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The position's asset, or the owner's cash asset in the currency, made the first time it is
 * needed. What it asks to make, and whether the cash asset was hidden, is noted before asking.
 */
async function assetFor(
  step: SavedHolding,
  position: PositionEntry | null,
  currency: ValuationCurrency,
  requestId: string,
): Promise<PortfolioAsset> {
  if (!step.making) {
    if (position) step.making = { requestId, ...positionAsset(position, currency) };
    else {
      const assets = await portfolioAssetsApi.listAll();
      const found = assets.find(
        (asset) => asset.assetType === 'fiat' && asset.symbol?.toUpperCase() === currency,
      );
      if (found) {
        const hidden = await hiddenAssetsApi.list();
        step.wasHidden = hidden.some(({ instrumentId }) => instrumentId === found.id);
        step.asset = found;
        return found;
      }
      step.making = { requestId, name: cashNames[currency], symbol: currency, assetType: 'fiat' };
    }
  }
  try {
    step.asset = await portfolioAssetsApi.create(step.making);
  } catch (caught) {
    // Refused outright, nothing was made; without an answer, or after a server error, it may be.
    const code = status(caught);
    if (code !== undefined && code < 500) step.making = null;
    throw caught;
  }
  return step.asset;
}

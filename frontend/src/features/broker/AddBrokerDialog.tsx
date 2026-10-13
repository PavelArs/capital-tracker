import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import { hiddenAssetsApi } from '@api/hidden-assets.api';
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
  filledPositions,
  freshRates,
  holdingTrade,
  MAX_BROKER_NAME,
  MAX_POSITIONS,
  MAX_TICKER,
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
  /** The asset was made by this form, not an existing cash asset. */
  made: boolean;
  receipt: TradeReceipt | null;
  priced: boolean;
}

interface Saved {
  accountId: string | null;
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
  const saved = useRef<Saved>({ accountId: null, revision: 0, holdings: [] });
  const requests = useRef<{ account: string; holdings: string[][] }>({
    account: newRequestId(),
    holdings: [],
  });
  const startedAt = useRef<Date | null>(null);
  const [locked, setLocked] = useState(false);
  const id = useId();
  const first = useRef<HTMLInputElement>(null);

  // Closing keeps what cannot be taken back: once anything it holds is saved, the account stays
  // and Brokers shows it. An account that holds nothing yet goes rather than stay out of reach.
  // A position whose asset was made but whose buy was not saved would show as an empty asset in
  // Portfolio, so it is hidden first.
  const finish = async () => {
    const done = saved.current;
    const empty = done.holdings.flatMap(({ asset, made, receipt }) =>
      asset && made && !receipt ? [asset.id] : [],
    );
    if (empty.length) {
      setSaving(true);
      await Promise.allSettled(empty.map((asset) => hiddenAssetsApi.hide(asset)));
    }
    if (done.holdings.some((holding) => holding.receipt)) return onAdded();
    if (done.accountId) void accountingApi.removeAccount(done.accountId).catch(() => undefined);
    onClose();
  };
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
    if (currency !== 'USD' && !done.accountId) {
      const fresh = await cachedReads.rates.load().then(
        (report) => freshRates(currency, report, now.toISOString().slice(0, 10)),
        () => undefined,
      );
      if (fresh !== true) {
        setError(
          fresh === undefined
            ? `Could not check the Bank of Russia rate for ${currency}. Nothing was saved; try again.`
            : `No recent Bank of Russia rate is stored, so ${currency} amounts cannot be converted. Nothing was saved; try again later.`,
        );
        setSaving(false);
        return;
      }
    }
    startedAt.current = now;
    setLocked(true);
    const cash = entry.cash.trim();
    const holdings: Holding[] = [
      ...filledPositions(entry).map((position) => ({
        quantity: position.quantity,
        total: times(position.quantity, position.price),
        position,
      })),
      ...(cash ? [{ quantity: cash, total: cash, position: null }] : []),
    ];
    while (requests.current.holdings.length < holdings.length)
      requests.current.holdings.push([newRequestId(), newRequestId(), newRequestId()]);
    while (done.holdings.length < holdings.length)
      done.holdings.push({ asset: null, made: false, receipt: null, priced: false });

    if (!done.accountId) {
      try {
        const account = await accountingApi.createAccount({
          requestId: requests.current.account,
          name: brokerAccountName(entry),
          assetClass: 'broker',
        });
        done.accountId = account.id;
      } catch (caught) {
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
        if (!step.asset) {
          const made = holding.position
            ? {
                asset: await portfolioAssetsApi.create({
                  requestId: assetRequest,
                  ...positionAsset(holding.position, currency),
                }),
                made: true,
              }
            : await cashAsset(currency, assetRequest);
          step.asset = made.asset;
          step.made = made.made;
        }
        if (!step.receipt) {
          step.receipt = await tradesApi.create(
            accountId,
            holdingTrade({ ...holding, currency }, step.asset.id, now, {
              requestId: tradeRequest,
              expectedJournalRevision: done.revision,
            }),
          );
          done.revision = step.receipt.journalRevision;
        }
        // A position starts at the price it was entered with; cash is always worth its amount.
        if (step.asset.priceSource === 'manual' && !step.priced) {
          const trade = step.receipt.trade;
          await manualPricesApi.set(step.asset.id, {
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

/** The owner's cash asset in the currency, made the first time it is needed. */
async function cashAsset(
  currency: ValuationCurrency,
  requestId: string,
): Promise<{ asset: PortfolioAsset; made: boolean }> {
  const assets = await portfolioAssetsApi.listAll();
  const found = assets.find(
    (asset) => asset.assetType === 'fiat' && asset.symbol?.toUpperCase() === currency,
  );
  if (found) return { asset: found, made: false };
  const asset = await portfolioAssetsApi.create({
    requestId,
    name: cashNames[currency],
    symbol: currency,
    assetType: 'fiat',
  });
  return { asset, made: true };
}

import { accountingApi } from '@api/accounting.api';
import { manualPricesApi } from '@api/manual-prices.api';
import {
  type PortfolioAsset,
  portfolioAssetsApi,
  type ValuationCurrency,
} from '@api/portfolio-assets.api';
import { type TradeReceipt, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Affix, Input } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { moscowDate } from '@/utils/dates';
import { answered, requestFailure } from '@/utils/request-failure';
import { newRequestId } from '../accounting/feedback';
import { purchasePrice, unitPrice } from '../portfolio/add-asset';
import { numberProblem } from '../portfolio/add-transaction';
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

const currencies: ValuationCurrency[] = ['USD', 'EUR', 'RUB'];
const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

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
    bought: moscowDate(new Date()),
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
  const all = propertyProblems(entry, moscowDate(new Date()));
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));
  const fieldError = (problem: PropertyProblem, value = '') =>
    found.has(problem) ? numberProblem(value, problemText[problem]) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const now = startedAt.current ?? new Date();
    if (propertyProblems(entry, moscowDate(now)).size) return;
    setSaving(true);
    setError(null);
    const done = saved.current;
    const estimate = entry.estimate.trim();
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
      setError(failure(caught, answered(status(caught)) ? 'Nothing was saved. ' : ''));
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
    // bought today starts at the estimate. Both stay in the currency the property is valued in
    // (AST-MANUAL-VALUE), so an estimate of 9,000,000 RUB stays 9,000,000 RUB.
    const currency = asset.valuationCurrency;
    const estimated = estimate ? { price: unitPrice(estimate, '1'), currency } : null;
    const boughtToday = entry.bought === moscowDate(now);
    const prices = [
      {
        observedAt: trade.occurredAt,
        ...(boughtToday && estimated ? estimated : purchasePrice(trade, currency)),
      },
      ...(estimated && !boughtToday
        ? [{ observedAt: `${now.toISOString().slice(0, 19)}Z`, ...estimated }]
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
        <ModalHeader
          titleId={`${id}-title`}
          title="Add property"
          onClose={finish}
          closeDisabled={saving}
          intro="An apartment, a house, land or parking, valued at your own estimate."
        />
        <ModalBody>
          <div className="ui-field">
            <span id={`${id}-kind`} className="ui-field__label">
              Kind
            </span>
            <SegmentedControl
              name={`${id}-kind`}
              labelledBy={`${id}-kind`}
              options={propertyKinds}
              value={entry.kind}
              wrap
              disabled={locked || saving}
              onChange={(kind) => update({ kind })}
            />
          </div>
          <Field label="Name (optional)" error={fieldError('name')} id={`${id}-name`}>
            {(control) => (
              <Input
                {...control}
                ref={first}
                maxLength={MAX_PROPERTY_NAME}
                autoComplete="off"
                placeholder={entry.kind}
                value={entry.name}
                disabled={locked || saving}
                onChange={(event) => update({ name: event.target.value })}
                onBlur={leave('name')}
              />
            )}
          </Field>
          <div className="ui-field">
            <span id={`${id}-currency`} className="ui-field__label">
              Currency
            </span>
            <SegmentedControl
              name={`${id}-currency`}
              labelledBy={`${id}-currency`}
              options={currencies}
              value={entry.currency}
              disabled={locked || saving}
              onChange={(currency) => update({ currency })}
            />
          </div>
          <div className="ui-field-row">
            <Field label="Purchase price" error={fieldError('cost', entry.cost)} id={`${id}-cost`}>
              {(control) => (
                <Affix suffix={entry.currency}>
                  <Input
                    {...control}
                    numeric
                    placeholder="0"
                    value={entry.cost}
                    disabled={locked || saving}
                    onChange={(event) => update({ cost: event.target.value })}
                    onBlur={leave('cost')}
                  />
                </Affix>
              )}
            </Field>
            <Field label="Bought on" error={fieldError('bought')} id={`${id}-bought`}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={moscowDate(new Date())}
                  value={entry.bought}
                  disabled={locked || saving}
                  onChange={(event) => update({ bought: event.target.value })}
                  onBlur={leave('bought')}
                />
              )}
            </Field>
          </div>
          <div className="ui-field-row">
            <Field
              label="What it is worth now (optional)"
              hint="Your estimate. Update it whenever you like."
              error={fieldError('estimate', entry.estimate)}
              id={`${id}-estimate`}
            >
              {(control) => (
                <Affix suffix={entry.currency}>
                  <Input
                    {...control}
                    numeric
                    placeholder="Same as purchase"
                    value={entry.estimate}
                    disabled={locked || saving}
                    onChange={(event) => update({ estimate: event.target.value })}
                    onBlur={leave('estimate')}
                  />
                </Affix>
              )}
            </Field>
            <Field label="Your share" error={fieldError('share', entry.share)} id={`${id}-share`}>
              {(control) => (
                <Affix suffix="%">
                  <Input
                    {...control}
                    numeric
                    value={entry.share}
                    disabled={locked || saving}
                    onChange={(event) => update({ share: event.target.value })}
                    onBlur={leave('share')}
                  />
                </Affix>
              )}
            </Field>
          </div>
          <Banner tone="info">
            Your share of the purchase price counts as money put in on the day you bought it. Later
            estimates count as market movement.
          </Banner>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={finish} disabled={saving}>
            {saved.current.asset ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            Add property
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

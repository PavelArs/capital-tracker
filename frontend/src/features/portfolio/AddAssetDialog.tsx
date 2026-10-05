import { manualPricesApi } from '@api/manual-prices.api';
import {
  type PortfolioAsset,
  portfolioAssetsApi,
  type ValuationCurrency,
} from '@api/portfolio-assets.api';
import { type TradeReceipt, tradesApi } from '@api/trades.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import { type Account, journalAccounts } from './AddTransactionDialog';
import {
  type AssetEntry,
  type AssetKind,
  type AssetProblem,
  amountRequired,
  assetBody,
  assetKinds,
  assetProblems,
  balanceInstant,
  balanceTrade,
  unitPrice,
} from './add-asset';
import { MAX_COMMENT_LENGTH } from './add-transaction';

const kindHints: Record<AssetKind, string> = {
  cash: 'Cash is worth exactly its amount in its own currency.',
  deposit: 'A bank deposit or savings whose value you enter by hand.',
  crypto:
    'BTC, ETH, SOL, USDT, USDC, ZEC, TRX and XLM get market prices. Other coins are valued by hand.',
  other: 'Anything else whose value you enter by hand.',
};
const namePlaceholders: Record<AssetKind, string> = {
  cash: 'e.g. Cash at home',
  deposit: 'e.g. Bank deposit',
  crypto: 'e.g. Bitcoin',
  other: 'e.g. Car',
};
const currencies: ValuationCurrency[] = ['USD', 'EUR', 'RUB'];
const problemText: Record<AssetProblem, string> = {
  name: 'Enter a name',
  ticker: 'Enter a ticker',
  amount: 'Enter an amount greater than 0',
  value: 'Enter the value as a number',
  account: 'Choose a wallet or account',
  notes: `Keep the notes within ${MAX_COMMENT_LENGTH} characters`,
  'no-accounts': '',
};
// Tab order inside the modal: a radio group is one stop, at its checked radio.
const focusableFields =
  'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="radio"]), input[type="radio"]:checked:not([disabled])';

const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

function assetFailure(error: unknown): string {
  const code = status(error);
  if (code === undefined)
    return 'Could not reach the server. Try again; the same request will not add the asset twice.';
  if (code === 400) return 'Check the fields and try again.';
  if (code === 409) return 'This request conflicts with an asset already saved. Reload the page.';
  if (code === 401) return 'Your session has ended. Sign in again.';
  return 'Could not add the asset. Try again.';
}

function balanceFailure(error: unknown): string {
  const code = status(error);
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  const saved = 'The asset was added, but its balance was not saved.';
  if (code === undefined) return `${saved} Could not reach the server; try again.`;
  if (code === 409 && message.includes('Bank of Russia rate'))
    return `${saved} No Bank of Russia rate is stored for today; enter the value in USD.`;
  if (code === 409 || code === 422) return `${saved} The account was changed elsewhere; try again.`;
  if (code === 401) return 'Your session has ended. Sign in again.';
  return `${saved} Check the amount and value and try again.`;
}

const blankEntry = (): AssetEntry => ({
  kind: 'cash',
  name: '',
  ticker: '',
  amount: '',
  value: '',
  currency: 'USD',
  accountId: '',
  notes: '',
});

interface Props {
  onClose: () => void;
  onAdded: (asset: PortfolioAsset) => void;
}

// "Add asset" from the accepted prototype: the asset, its amount and value in one window
// (AST-3, ADD-ASSET-BALANCE). The balance is a buy at its value, so it counts as a deposit.
export default function AddAssetDialog({ onClose, onAdded }: Props) {
  const [entry, setEntry] = useState<AssetEntry>(blankEntry);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Once saved, the asset is kept: a retry only adds what is still missing.
  const [created, setCreated] = useState<PortfolioAsset | null>(null);
  // One request id per distinct body, so a retry after a lost answer cannot duplicate.
  const assetAttempt = useRef<{ body: string; requestId: string } | null>(null);
  const tradeAttempt = useRef<{ body: string; requestId: string; at: string } | null>(null);
  const receipt = useRef<TradeReceipt | null>(null);
  const priceRequest = useRef<string | null>(null);
  const id = useId();
  const nameField = useRef<HTMLInputElement>(null);

  const dialog = useRef<HTMLDivElement>(null);
  const finish = useRef<() => void>(onClose);
  finish.current = () => (created ? onAdded(created) : onClose());
  const busy = useRef(false);
  busy.current = saving;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nameField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Closing mid-save would let a reopened form send a second request id.
      if (event.key === 'Escape' && !busy.current) finish.current();
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>(focusableFields)];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  const loadAccounts = () =>
    journalAccounts().then(
      (list) => {
        setAccounts(list);
        setLoadFailed(false);
        setEntry((current) =>
          list.some((account) => account.id === current.accountId)
            ? current
            : { ...current, accountId: list[0]?.id ?? '' },
        );
      },
      () => {
        setAccounts([]);
        setLoadFailed(true);
      },
    );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the accounts load once on open.
  useEffect(() => {
    void loadAccounts();
  }, []);

  const update = (changes: Partial<AssetEntry>) =>
    setEntry((current) => ({ ...current, ...changes }));
  const found = tried ? assetProblems(entry, accounts?.length ?? 0) : new Set<AssetProblem>();
  const fieldError = (problem: AssetProblem, text = problemText[problem]) =>
    found.has(problem) && (
      <span className="portfolio-field__error" id={`${id}-${problem}-error`}>
        {text}
      </span>
    );
  const invalid = (problem: AssetProblem) =>
    found.has(problem)
      ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` }
      : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (accounts === null || assetProblems(entry, accounts.length).size) return;
    setSaving(true);
    setError(null);
    let asset = created;
    if (!asset) {
      const body = assetBody(entry);
      const key = JSON.stringify(body);
      if (assetAttempt.current?.body !== key)
        assetAttempt.current = { body: key, requestId: newRequestId() };
      try {
        asset = await portfolioAssetsApi.create({
          requestId: assetAttempt.current.requestId,
          ...body,
        });
        setCreated(asset);
      } catch (caught) {
        setError(assetFailure(caught));
        setSaving(false);
        return;
      }
    }
    if (entry.amount.trim()) {
      const account = accounts.find((item) => item.id === entry.accountId)!;
      if (!receipt.current) {
        const key = JSON.stringify({ ...entry, kind: undefined, name: undefined });
        if (tradeAttempt.current?.body !== key)
          tradeAttempt.current = {
            body: key,
            requestId: newRequestId(),
            at: balanceInstant(new Date()),
          };
        try {
          receipt.current = await tradesApi.create(
            account.id,
            balanceTrade(entry, asset.id, tradeAttempt.current.at, {
              requestId: tradeAttempt.current.requestId,
              expectedJournalRevision: account.journalRevision,
            }),
          );
        } catch (caught) {
          setError(balanceFailure(caught));
          setSaving(false);
          // Nothing was saved under a refused request: the retry gets a new id and, when the
          // journal changed elsewhere, its new revision.
          if (status(caught) === 409) {
            tradeAttempt.current = null;
            await loadAccounts();
          }
          return;
        }
      }
      // A hand-valued asset starts at the price its value implies.
      if (asset.priceSource === 'manual') {
        const trade = receipt.current.trade;
        priceRequest.current ??= newRequestId();
        try {
          await manualPricesApi.set(asset.id, {
            requestId: priceRequest.current,
            expectedRevision: 0,
            observedAt: trade.occurredAt,
            priceUsd: unitPrice(trade.grossUsd, trade.quantity),
            assertReviewed: true,
          });
        } catch {
          setError('The asset and its balance were saved, but its price was not. Try again.');
          setSaving(false);
          return;
        }
      }
    }
    onAdded(asset);
  };

  const { kind } = entry;
  const crypto = kind === 'crypto';
  const locked = created !== null;
  const noAccounts = accounts !== null && accounts.length === 0;
  return (
    <div className="portfolio-scrim">
      <div
        ref={dialog}
        className="portfolio-dialog portfolio-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <form onSubmit={submit} noValidate>
          <div className="portfolio-dialog__head">
            <h2 id={`${id}-title`}>Add asset</h2>
            <p className="shell-note">
              For things the app can't track by itself: cash, a bank deposit, an unsupported coin or
              anything else.
            </p>
          </div>
          <div className="portfolio-dialog__body">
            <div className="portfolio-field">
              <span id={`${id}-type`} className="portfolio-field__label">
                Type
              </span>
              <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-type`}>
                {assetKinds.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${id}-kind`}
                      value={value}
                      checked={kind === value}
                      disabled={locked}
                      onChange={() => update({ kind: value })}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <span className="portfolio-field__hint">{kindHints[kind]}</span>
            </div>
            <div className="portfolio-row">
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor={`${id}-name`}>
                  Name
                </label>
                <input
                  id={`${id}-name`}
                  ref={nameField}
                  className="portfolio-input"
                  maxLength={120}
                  placeholder={namePlaceholders[kind]}
                  value={entry.name}
                  disabled={locked}
                  onChange={(event) => update({ name: event.target.value })}
                  {...invalid('name')}
                />
                {fieldError('name')}
              </div>
              {kind !== 'cash' && (
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor={`${id}-ticker`}>
                    {crypto ? 'Ticker' : 'Ticker (optional)'}
                  </label>
                  <input
                    id={`${id}-ticker`}
                    className="portfolio-input"
                    maxLength={32}
                    placeholder={crypto ? 'e.g. BTC' : ''}
                    value={entry.ticker}
                    disabled={locked}
                    onChange={(event) => update({ ticker: event.target.value })}
                    {...invalid('ticker')}
                  />
                  {fieldError('ticker')}
                </div>
              )}
            </div>
            <div className="portfolio-row">
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor={`${id}-amount`}>
                  {amountRequired(kind) ? 'Amount' : 'Amount (optional)'}
                </label>
                <input
                  id={`${id}-amount`}
                  className="portfolio-input"
                  inputMode="decimal"
                  placeholder="e.g. 150000"
                  value={entry.amount}
                  onChange={(event) => update({ amount: event.target.value })}
                  {...invalid('amount')}
                />
                {fieldError('amount')}
              </div>
              {kind !== 'cash' && (
                <div className="portfolio-field">
                  <label className="portfolio-field__label" htmlFor={`${id}-value`}>
                    {crypto ? 'Total cost' : 'Current value'}
                  </label>
                  <span className="portfolio-affix">
                    <input
                      id={`${id}-value`}
                      className="portfolio-input"
                      inputMode="decimal"
                      placeholder={crypto ? 'e.g. 5000' : 'Same as amount'}
                      value={entry.value}
                      onChange={(event) => update({ value: event.target.value })}
                      {...invalid('value')}
                    />
                    <span className="portfolio-affix__suffix">{entry.currency}</span>
                  </span>
                  {fieldError('value', crypto ? 'Enter what it cost' : problemText.value)}
                </div>
              )}
            </div>
            <div className="portfolio-field">
              <span id={`${id}-currency`} className="portfolio-field__label">
                {kind === 'cash' ? 'Currency' : crypto ? 'Paid in' : 'Value currency'}
              </span>
              <div className="shell-seg" role="radiogroup" aria-labelledby={`${id}-currency`}>
                {currencies.map((code) => (
                  <label key={code}>
                    <input
                      type="radio"
                      name={`${id}-currency`}
                      value={code}
                      checked={entry.currency === code}
                      disabled={locked && !crypto}
                      onChange={() => update({ currency: code })}
                    />
                    {code}
                  </label>
                ))}
              </div>
              <span className="portfolio-field__hint">
                {kind === 'cash'
                  ? 'The amount is in this currency; it is also the ticker.'
                  : crypto
                    ? 'RUB and EUR are converted at the Bank of Russia rate of today.'
                    : 'For cash in the same currency, the amount and the value are the same number.'}
              </span>
            </div>
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-account`}>
                Wallet or account
              </label>
              {accounts === null ? (
                <span className="portfolio-field__hint" role="status">
                  Loading your accounts…
                </span>
              ) : noAccounts ? (
                <p
                  className={found.has('no-accounts') ? 'portfolio-field__error' : 'shell-note'}
                  id={`${id}-no-accounts-error`}
                >
                  {loadFailed ? (
                    'Could not load your accounts, so a balance cannot be added. Close this window and try again.'
                  ) : (
                    <>
                      To give it a balance, add a wallet or account first on the{' '}
                      <Link to="/manual-accounts">manual accounts</Link> page.
                    </>
                  )}
                </p>
              ) : (
                <select
                  id={`${id}-account`}
                  className="portfolio-input"
                  value={entry.accountId}
                  onChange={(event) => update({ accountId: event.target.value })}
                  {...invalid('account')}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
              {fieldError('account')}
            </div>
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor={`${id}-notes`}>
                Notes (optional)
              </label>
              <textarea
                id={`${id}-notes`}
                className="portfolio-input portfolio-textarea"
                value={entry.notes}
                onChange={(event) => update({ notes: event.target.value })}
                {...invalid('notes')}
              />
              {fieldError('notes')}
            </div>
            <p className="portfolio-dialog__info" role="note">
              {crypto
                ? 'An amount entered here is recorded as a buy today and counts as a deposit. For past purchases, leave it empty and use Add transaction.'
                : 'Adding it counts as a deposit. Later price changes count as market movement.'}
            </p>
            {error && (
              <p className="portfolio-dialog__error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="portfolio-dialog__foot">
            <button
              type="button"
              className="shell-button shell-button--ghost"
              onClick={() => finish.current()}
              disabled={saving}
            >
              {created ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="shell-button shell-button--primary"
              disabled={saving || accounts === null}
            >
              Add asset
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

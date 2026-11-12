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
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Affix, Input, Select, Textarea } from '@/ui/inputs';
import Modal, { ModalBody, ModalFooter, ModalHeader } from '@/ui/Modal';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { answered, requestFailure } from '@/utils/request-failure';
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
  MAX_ACCOUNT_NAME,
  NEW_ACCOUNT,
  purchasePrice,
} from './add-asset';
import { bankRate, MAX_COMMENT_LENGTH } from './add-transaction';
import { useFocusFirstProblem } from './focus-problem';

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
  value: 'Enter a value greater than 0',
  account: 'Choose a wallet or account',
  'account-name': 'Enter a name for the account',
  notes: `Keep the notes within ${MAX_COMMENT_LENGTH} characters`,
  'no-accounts': '',
};
const status = (error: unknown) => (isAxiosError(error) ? error.response?.status : undefined);

const assetFailure = (error: unknown) =>
  requestFailure(error, {
    unreachable:
      'Could not reach the server. Try again; the same request will not add the asset twice.',
    status: {
      400: 'Check the fields and try again.',
      409: 'This request conflicts with an asset already saved. Reload the page.',
      401: 'Your session has ended. Sign in again.',
    },
    fallback: 'Could not add the asset. Try again.',
  });

function balanceFailure(error: unknown): string {
  const code = status(error);
  const message = isAxiosError(error) ? String(error.response?.data?.message ?? '') : '';
  const saved = 'The asset was added, but its balance was not saved.';
  if (code === 401) return 'Your session has ended. Sign in again.';
  if (!answered(code))
    return 'The asset was added, but the server did not answer about its balance; reload the page to check it.';
  if (code === 409 && message.includes('Bank of Russia rate'))
    return `${saved} No Bank of Russia rate is stored yet; try again later.`;
  if (code === 409 || code === 422) return `${saved} The account was changed elsewhere; try again.`;
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
  accountName: '',
  notes: '',
});

/** Why a new account for the balance was not made, and whether a retry may make it twice. */
function accountFailure(error: unknown): string {
  const code = status(error);
  if (code === undefined)
    return 'Could not reach the server. Try again; the same request will not make the account twice.';
  return answered(code)
    ? 'Could not make the account. Nothing was saved; try again.'
    : 'Could not make the account. Try again; the same request will not make it twice.';
}

/** What the currency choice is called, and what it means, for each kind. */
const currencyWords: Record<AssetKind, { label: string; hint: string }> = {
  cash: { label: 'Currency', hint: 'The amount is in this currency; it is also the ticker.' },
  crypto: {
    label: 'Paid in',
    hint: 'RUB and EUR are converted at the Bank of Russia rate of today.',
  },
  deposit: {
    label: 'Value currency',
    hint: 'For cash in the same currency, the amount and the value are the same number.',
  },
  other: {
    label: 'Value currency',
    hint: 'For cash in the same currency, the amount and the value are the same number.',
  },
};

/** The problems the form shows, or the fields the owner has left. */
type Found = ReadonlySet<AssetProblem>;

/** The text a Field shows under its control once the problem is found (ids `${id}-<problem>`). */
const problemOf = (found: Found, name: AssetProblem, text = problemText[name]) =>
  found.has(name) ? text : null;
const fieldError = (id: string, found: Found, problem: AssetProblem, text = problemText[problem]) =>
  found.has(problem) && (
    <span className="ui-field__error" id={`${id}-${problem}-error`}>
      {text}
    </span>
  );
const invalid = (id: string, found: Found, problem: AssetProblem) =>
  found.has(problem) ? { 'aria-invalid': true, 'aria-describedby': `${id}-${problem}-error` } : {};

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
  // A new account is made once per name; a retry gets the account it already made.
  const accountAttempt = useRef<{
    name: string;
    requestId: string;
    account: Account | null;
  } | null>(null);
  const priceRequest = useRef<string | null>(null);
  // After a lost answer or a server error the balance may have been saved: until a definite
  // answer, the retry must send the same request, so its fields stay as they were.
  const [balanceUnsure, setBalanceUnsure] = useState(false);
  const id = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const { form, refused } = useFocusFirstProblem();

  // Closing mid-save would let a reopened form send a second request id.
  const finish = () => (created ? onAdded(created) : onClose());

  const loadAccounts = () =>
    journalAccounts().then(
      (list) => {
        setAccounts(list);
        setLoadFailed(false);
        setEntry((current) =>
          list.some((account) => account.id === current.accountId) ||
          (current.accountId === NEW_ACCOUNT && accountAttempt.current === null)
            ? current
            : { ...current, accountId: list[0]?.id ?? NEW_ACCOUNT },
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
  // Fields the owner has left: their problems show on blur and clear as soon as the value is fixed.
  const [left, setLeft] = useState<Found>(new Set());
  const leave = (problem: AssetProblem) => () =>
    setLeft((current) => (current.has(problem) ? current : new Set(current).add(problem)));
  const all = assetProblems(entry, accounts?.length ?? 0);
  const found = tried ? all : new Set([...all].filter((problem) => left.has(problem)));

  // The account the balance goes to; a new one is made first, so nothing else is saved without it.
  const accountFor = async (): Promise<Account | null> => {
    if (entry.accountId !== NEW_ACCOUNT)
      return accounts?.find((item) => item.id === entry.accountId) ?? null;
    const name = entry.accountName.trim();
    if (accountAttempt.current?.name !== name)
      accountAttempt.current = { name, requestId: newRequestId(), account: null };
    const attempt = accountAttempt.current;
    if (!attempt.account) {
      try {
        const saved = await accountingApi.createAccount({ requestId: attempt.requestId, name });
        // A new account has no journal yet, so its first trade starts it at revision 0.
        attempt.account = { id: saved.id, name: saved.name, journalRevision: 0 };
      } catch (caught) {
        setError(accountFailure(caught));
        return null;
      }
    }
    const account = attempt.account;
    setAccounts((list) =>
      list?.some((item) => item.id === account.id) ? list : [...(list ?? []), account],
    );
    update({ accountId: account.id });
    return account;
  };

  // A RUB or EUR balance needs today's Bank of Russia rate. Without one the asset would be
  // saved and its balance refused, so check first and save nothing.
  const rateStored = async (): Promise<boolean> => {
    const { currency } = entry;
    if (created || !entry.amount.trim() || (currency !== 'RUB' && currency !== 'EUR')) return true;
    const rate = await cachedReads.rates.load().then(
      (report) => bankRate(currency, report),
      () => undefined, // Unknown: the balance itself reports a missing rate.
    );
    if (rate !== null) return true;
    setError(
      `No Bank of Russia rate is stored for today yet, so the ${currency} balance cannot be converted. Nothing was saved; try again later.`,
    );
    setSaving(false);
    return false;
  };

  const saveAsset = async (): Promise<PortfolioAsset | null> => {
    const body = assetBody(entry);
    const key = JSON.stringify(body);
    if (assetAttempt.current?.body !== key)
      assetAttempt.current = { body: key, requestId: newRequestId() };
    try {
      const asset = await portfolioAssetsApi.create({
        requestId: assetAttempt.current.requestId,
        ...body,
      });
      setCreated(asset);
      return asset;
    } catch (caught) {
      setError(assetFailure(caught));
      setSaving(false);
      return null;
    }
  };

  /** The balance, as a buy at its value; null when it was not saved. */
  const saveBalance = async (
    account: Account,
    asset: PortfolioAsset,
  ): Promise<TradeReceipt | null> => {
    if (receipt.current) return receipt.current;
    const key = JSON.stringify({
      ...entry,
      accountId: account.id,
      accountName: undefined,
      kind: undefined,
      name: undefined,
    });
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
      setBalanceUnsure(false);
      return receipt.current;
    } catch (caught) {
      const code = status(caught);
      setError(balanceFailure(caught));
      setSaving(false);
      setBalanceUnsure(!answered(code));
      // Nothing was saved under a refused request: the retry gets a new id and, when the
      // journal changed elsewhere, its new revision.
      if (code === 409) {
        tradeAttempt.current = null;
        await loadAccounts();
      }
      return null;
    }
  };

  /** The price of a hand-valued asset; false when it was not saved. */
  const savePrice = async (asset: PortfolioAsset, trade: TradeReceipt['trade']) => {
    priceRequest.current ??= newRequestId();
    try {
      await manualPricesApi.set(asset.id, {
        requestId: priceRequest.current,
        expectedRevision: 0,
        observedAt: trade.occurredAt,
        ...purchasePrice(trade, asset.valuationCurrency),
        assertReviewed: true,
      });
      return true;
    } catch (caught) {
      setError(
        answered(status(caught))
          ? 'The asset and its balance were saved, but its price was not. Try again.'
          : 'The asset and its balance were saved; its price may have been saved too. Try again; the same request will not save it twice.',
      );
      setSaving(false);
      return false;
    }
  };

  /** The balance and, for a hand-valued asset, its price; false when a step was not saved. */
  const saveHolding = async (account: Account, asset: PortfolioAsset) => {
    const saved = await saveBalance(account, asset);
    if (!saved) return false;
    // A hand-valued asset starts at the price its value implies.
    return asset.priceSource !== 'manual' || (await savePrice(asset, saved.trade));
  };

  /** Each step that fails says why and stops; what was saved before it stays for the retry. */
  const save = async (): Promise<PortfolioAsset | null> => {
    if (!(await rateStored())) return null;
    const balance = entry.amount.trim() !== '';
    const account = balance ? await accountFor() : null;
    if (balance && !account) {
      setSaving(false);
      return null;
    }
    const asset = created ?? (await saveAsset());
    if (!asset) return null;
    if (account && !(await saveHolding(account, asset))) return null;
    return asset;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (accounts === null || assetProblems(entry, accounts.length).size) {
      refused();
      return;
    }
    setSaving(true);
    setError(null);
    const asset = await save();
    if (asset) onAdded(asset);
  };

  const { kind } = entry;
  const crypto = kind === 'crypto';
  const locked = created !== null;
  return (
    <Modal
      titleId={`${id}-title`}
      size="wide"
      onEscape={saving ? undefined : finish}
      initialFocus={() => nameField.current}
    >
      <form ref={form} onSubmit={submit} noValidate>
        <ModalHeader
          titleId={`${id}-title`}
          title="Add asset"
          onClose={finish}
          closeDisabled={saving}
          intro="For things the app can't track by itself: cash, a bank deposit, an unsupported coin or anything else."
        />
        <ModalBody>
          <div className="ui-field">
            <span id={`${id}-type`} className="ui-field__label">
              Type
            </span>
            <SegmentedControl
              name={`${id}-kind`}
              labelledBy={`${id}-type`}
              options={assetKinds}
              value={kind}
              disabled={locked}
              onChange={(value) => update({ kind: value })}
            />
            <span className="ui-field__hint">{kindHints[kind]}</span>
          </div>
          <div className="ui-field-row">
            <Field id={`${id}-name`} label="Name" error={problemOf(found, 'name')}>
              {(control) => (
                <Input
                  {...control}
                  ref={nameField}
                  maxLength={120}
                  placeholder={namePlaceholders[kind]}
                  value={entry.name}
                  disabled={locked}
                  onChange={(event) => update({ name: event.target.value })}
                  onBlur={leave('name')}
                />
              )}
            </Field>
            <TickerField
              id={id}
              kind={kind}
              value={entry.ticker}
              locked={locked}
              found={found}
              onChange={(ticker) => update({ ticker })}
              onLeave={leave('ticker')}
            />
          </div>
          <div className="ui-field-row">
            <Field
              id={`${id}-amount`}
              label={amountRequired(kind) ? 'Amount' : 'Amount (optional)'}
              error={problemOf(found, 'amount')}
            >
              {(control) => (
                <Input
                  {...control}
                  numeric
                  placeholder="e.g. 150000"
                  value={entry.amount}
                  disabled={balanceUnsure}
                  onChange={(event) => update({ amount: event.target.value })}
                  onBlur={leave('amount')}
                />
              )}
            </Field>
            <ValueField
              id={id}
              kind={kind}
              value={entry.value}
              currency={entry.currency}
              unsure={balanceUnsure}
              found={found}
              onChange={(value) => update({ value })}
              onLeave={leave('value')}
            />
          </div>
          <div className="ui-field">
            <span id={`${id}-currency`} className="ui-field__label">
              {currencyWords[kind].label}
            </span>
            <SegmentedControl
              name={`${id}-currency`}
              labelledBy={`${id}-currency`}
              options={currencies}
              value={entry.currency}
              disabled={(locked && !crypto) || balanceUnsure}
              onChange={(code) => update({ currency: code })}
            />
            <span className="ui-field__hint">{currencyWords[kind].hint}</span>
          </div>
          <AccountField
            id={id}
            accounts={accounts}
            loadFailed={loadFailed}
            accountId={entry.accountId}
            accountName={entry.accountName}
            unsure={balanceUnsure}
            found={found}
            onChange={update}
            onLeave={leave}
          />
          <Field id={`${id}-notes`} label="Notes (optional)" error={problemOf(found, 'notes')}>
            {(control) => (
              <Textarea
                {...control}
                value={entry.notes}
                disabled={balanceUnsure}
                onChange={(event) => update({ notes: event.target.value })}
                onBlur={leave('notes')}
              />
            )}
          </Field>
          <Banner tone="info">
            {crypto
              ? 'An amount entered here is recorded as a buy today and counts as a deposit. For past purchases, leave it empty and use Add transaction.'
              : 'Adding it counts as a deposit. Later price changes count as market movement.'}
          </Banner>
          {error && <Banner tone="neg">{error}</Banner>}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={finish} disabled={saving}>
            {created ? 'Close' : 'Cancel'}
          </Button>
          <Button type="submit" variant="primary" disabled={saving || accounts === null}>
            Add asset
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

interface TickerFieldProps {
  id: string;
  kind: AssetKind;
  value: string;
  locked: boolean;
  found: Found;
  onChange: (ticker: string) => void;
  onLeave: () => void;
}

/** The ticker: needed for a coin, optional for a deposit or anything else, none for cash. */
function TickerField({ id, kind, value, locked, found, onChange, onLeave }: TickerFieldProps) {
  if (kind === 'cash') return null;
  const crypto = kind === 'crypto';
  return (
    <Field
      id={`${id}-ticker`}
      label={crypto ? 'Ticker' : 'Ticker (optional)'}
      error={problemOf(found, 'ticker')}
    >
      {(control) => (
        <Input
          {...control}
          maxLength={32}
          placeholder={crypto ? 'e.g. BTC' : ''}
          value={value}
          disabled={locked}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onLeave}
        />
      )}
    </Field>
  );
}

interface ValueFieldProps {
  id: string;
  kind: AssetKind;
  value: string;
  currency: ValuationCurrency;
  unsure: boolean;
  found: Found;
  onChange: (value: string) => void;
  onLeave: () => void;
}

/** What the coins cost, or what anything else is worth now; cash is worth its amount. */
function ValueField({
  id,
  kind,
  value,
  currency,
  unsure,
  found,
  onChange,
  onLeave,
}: ValueFieldProps) {
  if (kind === 'cash') return null;
  const crypto = kind === 'crypto';
  return (
    <Field
      id={`${id}-value`}
      label={crypto ? 'Total cost' : 'Current value'}
      error={problemOf(found, 'value', crypto ? 'Enter what it cost' : problemText.value)}
    >
      {(control) => (
        <Affix suffix={currency}>
          <Input
            {...control}
            numeric
            placeholder={crypto ? 'e.g. 5000' : 'Same as amount'}
            value={value}
            disabled={unsure}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onLeave}
          />
        </Affix>
      )}
    </Field>
  );
}

interface AccountFieldProps {
  id: string;
  accounts: readonly Account[] | null;
  loadFailed: boolean;
  accountId: string;
  accountName: string;
  unsure: boolean;
  found: Found;
  onChange: (changes: Partial<AssetEntry>) => void;
  onLeave: (problem: AssetProblem) => () => void;
}

/** The account the balance is kept in: one of the owner's, or a new one named here. */
function AccountField({
  id,
  accounts,
  loadFailed,
  accountId,
  accountName,
  unsure,
  found,
  onChange,
  onLeave,
}: AccountFieldProps) {
  const noAccounts = accounts !== null && accounts.length === 0;
  return (
    <div className="ui-field">
      <label
        className="ui-field__label"
        htmlFor={noAccounts ? `${id}-account-name` : `${id}-account`}
      >
        Wallet or account
      </label>
      {accounts === null ? (
        <span className="ui-field__hint" role="status">
          Loading your accounts…
        </span>
      ) : loadFailed ? (
        <p className="ui-field__error" id={`${id}-no-accounts-error`}>
          Could not load your accounts, so a balance cannot be added. Close this window and try
          again.
        </p>
      ) : noAccounts ? null : (
        <Select
          id={`${id}-account`}
          value={accountId}
          disabled={unsure}
          onChange={(event) => onChange({ accountId: event.target.value })}
          onBlur={onLeave('account')}
          {...invalid(id, found, 'account')}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
          <option value={NEW_ACCOUNT}>New account…</option>
        </Select>
      )}
      {accountId === NEW_ACCOUNT && !loadFailed && accounts !== null && (
        <>
          <Input
            id={`${id}-account-name`}
            aria-label={noAccounts ? undefined : 'Name of the new account'}
            placeholder="e.g. Home safe, Bank"
            maxLength={MAX_ACCOUNT_NAME}
            autoComplete="off"
            value={accountName}
            disabled={unsure}
            onChange={(event) => onChange({ accountName: event.target.value })}
            onBlur={onLeave('account-name')}
            {...invalid(id, found, 'account-name')}
          />
          <span className="ui-field__hint">
            {noAccounts
              ? 'You have no account yet. The balance is kept in this one.'
              : 'The balance is kept in a new account you can use for more assets later.'}
          </span>
          {fieldError(id, found, 'account-name')}
        </>
      )}
      {fieldError(id, found, 'account')}
    </div>
  );
}

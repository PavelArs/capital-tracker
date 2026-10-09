import { accountingApi } from '@api/accounting.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import {
  type AddressTransaction,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { newRequestId } from '../accounting/feedback';
import { age, DASH, quantity } from '../portfolio/format';
import type { WalletAccount } from './AddWalletDialog';
import { networkOf } from './networks';
import { SyncBadge, type SyncRun, syncAge, syncProblem } from './SyncStatus';
import {
  addressValue,
  ConvertNote,
  chainAmounts,
  EarnSection,
  PoolsSection,
  type Prices,
  ReportedBalanceNote,
  StakingSection,
} from './WalletParts';
import { chainBalances, shortAddress } from './wallets';

const NEW = '__new';
const NONE = '';
const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a';
const directionLabels: Record<AddressTransaction['direction'], string> = {
  in: 'Received',
  out: 'Sent',
  self: 'To itself',
};
/**
 * A Bybit record: a spot trade, a deposit or withdrawal (M22), Earn yield (BYBIT-EARN) or a
 * convert (BYBIT-CONVERT).
 */
const recordLabel = (item: AddressTransaction) =>
  item.txid.startsWith('bybit-trade-convert-')
    ? 'Convert'
    : item.txid.startsWith('bybit-trade-')
      ? 'Trade'
      : item.txid.startsWith('bybit-earn-')
        ? 'Earn yield'
        : item.direction === 'out'
          ? 'Withdrawal'
          : 'Deposit';
const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

interface Props {
  address: WalletAddress;
  accounts: readonly WalletAccount[];
  currency: AccountingCurrency;
  /** Latest price of each crypto ticker in `currency`. */
  prices: Prices;
  run: SyncRun | undefined;
  onSync: () => void;
  onSaved: (address: WalletAddress, newAccount: boolean) => void;
  onClose: () => void;
}

// Side drawer of one tracked address (prototype "Trust Wallet · Bitcoin"): balance, facts,
// the wallet it belongs to and its newest blockchain transactions.
export default function AddressDrawer({
  address,
  accounts,
  currency,
  prices,
  run,
  onSync,
  onSaved,
  onClose,
}: Props) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [choice, setChoice] = useState(address.accountId ?? NONE);
  const [newName, setNewName] = useState('');
  const [label, setLabel] = useState(address.label ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // undefined while loading, null when the read failed.
  const [recent, setRecent] = useState<AddressTransaction[] | null | undefined>(undefined);
  const attempt = useRef<{ name: string; requestId: string } | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab' || !drawer.current) return;
      const items = [...drawer.current.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0];
      const last = items[items.length - 1];
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

  const count = address.transactionCount;
  // A sync that stores new transactions changes the count; the newest are read again.
  useEffect(() => {
    if (count === 0) {
      setRecent([]);
      return;
    }
    let live = true;
    walletAddressesApi
      .transactions(address.id)
      .then((page) => live && setRecent(page.items.slice(0, 10)))
      .catch(() => live && setRecent(null));
    return () => {
      live = false;
    };
  }, [address.id, count]);

  const wallet = accounts.find((account) => account.accountId === address.accountId);
  // M21: a Bitcoin account public key and the addresses it derives.
  const key = address.accountKey ?? null;
  // M22: a Bybit account, its balances as Bybit reports them.
  const exchange = address.exchange ?? null;
  const network = networkOf(address);
  const balances = chainBalances(address);
  const value = addressValue(address, prices, currency);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const name = newName.trim();
    if (choice === NEW && !name) {
      setMessage({ error: true, text: 'Enter a name for the new wallet.' });
      return;
    }
    setSaving(true);
    try {
      let accountId: string | null = choice === NONE ? null : choice;
      if (choice === NEW) {
        if (attempt.current?.name !== name) attempt.current = { name, requestId: newRequestId() };
        accountId = (
          await accountingApi.createAccount({ requestId: attempt.current.requestId, name })
        ).id;
      }
      const saved = await walletAddressesApi.update(address.id, {
        accountId,
        label: label.trim() || null,
      });
      onSaved(saved, choice === NEW);
      setChoice(saved.accountId ?? NONE);
      setNewName('');
      setMessage({ error: false, text: 'Saved.' });
    } catch (caught) {
      const status = isAxiosError(caught) ? caught.response?.status : undefined;
      setMessage({
        error: true,
        text:
          status === undefined
            ? 'Could not reach the server. Nothing was changed; try again.'
            : status === 404
              ? 'This wallet or address no longer exists. Reload the page.'
              : 'Could not save. Check the name and try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const running = run?.state === 'running';
  return (
    <>
      <div className="transactions-scrim" aria-hidden="true" onClick={() => close.current()} />
      <div
        ref={drawer}
        className="transactions-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-title"
      >
        <div className="transactions-drawer__head">
          <h2 id="address-title">
            {wallet
              ? `${wallet.name} · ${network.name}`
              : `${network.name} ${exchange ? 'account' : 'address'}`}
          </h2>
          <button
            ref={closeButton}
            type="button"
            className="shell-button shell-button--ghost"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="transactions-drawer__body">
          <div className="transactions-hero">
            <span className="transactions-hero__amount">
              {balances === null
                ? exchange
                  ? DASH
                  : `${DASH} ${network.symbol}`
                : chainAmounts(address)}
            </span>
            <span className="transactions-hero__value">
              {balances === null
                ? 'The balance appears once the whole history is loaded.'
                : value === DASH
                  ? 'No price yet'
                  : value}
            </span>
          </div>
          <dl className="transactions-facts" aria-label="Details">
            <div>
              <dt>Network</dt>
              <dd>{network.name}</dd>
            </div>
            {network.assets.length > 1 && (
              <div>
                <dt>Tracked assets</dt>
                <dd>
                  {exchange
                    ? 'Every coin the account holds; Bybit prices the ones Kraken does not list'
                    : `${network.assets.join(', ')}${network.anyToken ? ' and every other token' : ''}`}
                </dd>
              </div>
            )}
            <div>
              <dt>{key ? 'Public key' : exchange ? 'Bybit UID' : 'Address'}</dt>
              <dd>
                <span className="wallets-mono">{address.address}</span>{' '}
                <button
                  type="button"
                  className="portfolio-link"
                  onClick={() => void navigator.clipboard?.writeText(address.address)}
                >
                  Copy
                </button>
              </dd>
            </div>
            {key && (
              <div>
                <dt>Addresses</dt>
                <dd>{key.usedAddresses} used · new ones are found automatically</dd>
              </div>
            )}
            {exchange && (
              <>
                <div>
                  <dt>API key</dt>
                  <dd>
                    <span className="wallets-mono">…{exchange.keyHint}</span> · read-only, stored
                    encrypted
                  </dd>
                </div>
                <div>
                  <dt>Key expires</dt>
                  <dd>
                    {exchange.ipBound
                      ? 'Never: bound to an IP address'
                      : exchange.keyExpiresAt
                        ? `${dayFormat.format(new Date(exchange.keyExpiresAt))}. Bind it to the server's IP address in Bybit to keep it.`
                        : 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt>History from</dt>
                  <dd>{dayFormat.format(new Date(exchange.historyFrom))}</dd>
                </div>
                {exchange.reportedAt && (
                  <div>
                    <dt>Balances</dt>
                    <dd>As Bybit reported them {age(exchange.reportedAt, new Date())}</dd>
                  </div>
                )}
                {exchange.untracked.length > 0 && (
                  <div>
                    <dt>Not tracked</dt>
                    <dd>
                      {exchange.untracked
                        .map((item) => `${quantity(item.quantity)} ${item.symbol}`)
                        .join(' · ')}
                      <span className="wallets-muted"> · not counted</span>
                    </dd>
                  </div>
                )}
              </>
            )}
            <div>
              <dt>Status</dt>
              <dd>
                <SyncBadge address={address} run={run} />{' '}
                <span className="wallets-muted">{syncAge(address, run)}</span>
              </dd>
            </div>
            <div>
              <dt>Transactions</dt>
              <dd>{count}</dd>
            </div>
            <div>
              <dt>Data source</dt>
              <dd>{network.source}</dd>
            </div>
            <div>
              <dt>Updates</dt>
              <dd>Every hour in the background</dd>
            </div>
          </dl>
          {key && key.alsoTracked.length > 0 && (
            <p className="wallets-message wallets-message--warn" role="alert">
              {key.alsoTracked.length === 1
                ? 'One address of this key is also tracked as its own wallet'
                : `${key.alsoTracked.length} addresses of this key are also tracked as their own wallets`}{' '}
              ({key.alsoTracked.map((item) => item.label ?? shortAddress(item.address)).join(', ')}
              ), so their coins count twice.
            </p>
          )}
          <ReportedBalanceNote address={address} />
          {address.staking && <StakingSection address={address} staking={address.staking} />}
          {address.pools && <PoolsSection pools={address.pools} />}
          {exchange && <EarnSection exchange={exchange} />}
          {exchange && <ConvertNote exchange={exchange} />}
          {syncProblem(address, run) && (
            <p className="wallets-message wallets-message--error" role="alert">
              {syncProblem(address, run)}
            </p>
          )}
          <form className="wallets-edit" onSubmit={save} aria-labelledby="address-wallet">
            <h3 id="address-wallet" className="transactions-section">
              Wallet and name
            </h3>
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor="address-account">
                Wallet
              </label>
              <select
                id="address-account"
                className="portfolio-input"
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                <option value={NONE}>Not chosen</option>
                {accounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.name}
                  </option>
                ))}
                <option value={NEW}>New wallet…</option>
              </select>
            </div>
            {choice === NEW && (
              <div className="portfolio-field">
                <label className="portfolio-field__label" htmlFor="address-new-wallet">
                  New wallet name
                </label>
                <input
                  id="address-new-wallet"
                  className="portfolio-input"
                  maxLength={120}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </div>
            )}
            <div className="portfolio-field">
              <label className="portfolio-field__label" htmlFor="address-label">
                {exchange ? 'Account name' : 'Address name'}{' '}
                <span className="wallets-muted">(optional)</span>
              </label>
              <input
                id="address-label"
                className="portfolio-input"
                maxLength={40}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            {message && (
              <p
                className={`wallets-message${message.error ? ' wallets-message--error' : ''}`}
                role={message.error ? 'alert' : 'status'}
              >
                {message.text}
              </p>
            )}
            <button
              type="submit"
              className="shell-button shell-button--secondary wallets-edit__save"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
          <section aria-labelledby="address-transactions">
            <h3 id="address-transactions" className="transactions-section">
              {exchange ? 'Bybit records' : 'Blockchain transactions'}
            </h3>
            {!recent?.length ? (
              <p className="wallets-muted">
                {count === 0
                  ? 'None loaded yet. They appear here after a sync.'
                  : recent === null
                    ? 'Could not load them; they are in Transactions.'
                    : 'Loading…'}
              </p>
            ) : (
              <ul className="wallets-recent">
                {recent.map((item) => (
                  <li key={item.txid}>
                    <span>
                      {exchange ? recordLabel(item) : directionLabels[item.direction]}{' '}
                      <span className="wallets-muted">
                        {dayFormat.format(new Date(item.blockTime))}
                      </span>
                    </span>
                    <span className="wallets-num">
                      {item.net.startsWith('-') ? '-' : '+'}
                      {quantity(item.net.replace(/^-/, ''))} {item.symbol}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {count > 0 && (
              <Link
                className="portfolio-link"
                to={`/transactions?account=${encodeURIComponent(`wallet:${address.id}`)}`}
              >
                All in Transactions
              </Link>
            )}
          </section>
        </div>
        <div className="transactions-drawer__foot">
          <span className="transactions-grow" />
          <button
            type="button"
            className="shell-button shell-button--secondary"
            disabled={running}
            onClick={onSync}
          >
            {running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
    </>
  );
}

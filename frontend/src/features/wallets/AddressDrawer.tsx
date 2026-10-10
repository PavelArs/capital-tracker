import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { Operation } from '@api/operations.api';
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
import CloseButton from '../shell/CloseButton';
import type { WalletAccount } from './AddWalletDialog';
import KindField, { type KindChoice } from './KindField';
import { networkOf } from './networks';
import RemoveAddress from './RemoveAddress';
import SyncJournal from './SyncJournal';
import { SyncBadge, type SyncRun, syncAge, syncProblem } from './SyncStatus';
import TokensSection from './TokensSection';
import {
  addressValue,
  ConvertNote,
  chainPieces,
  EarnSection,
  MoreCoins,
  PoolsSection,
  type Prices,
  ReportedBalanceNote,
  SHOWN_COINS,
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

/** The newest transactions the drawer lists, once dust is left out. */
const SHOWN_TRANSACTIONS = 10;
/** Pages of the address's history read to find them: a spammed address has long runs of dust. */
const MAX_PAGES = 6;

/**
 * This address's rows of the Transactions list by txid: the row to open and whether it is dust
 * (CLS-DUST). A leg the list folds into a swap or a transfer has no row of its own.
 */
function operationsOf(operations: readonly Operation[], addressId: string) {
  const found = new Map<string, Operation>();
  for (const operation of operations) {
    if (operation.chain && operation.wallet?.id === addressId)
      found.set(operation.chain.txid, operation);
  }
  return found;
}

interface Props {
  address: WalletAddress;
  accounts: readonly WalletAccount[];
  currency: AccountingCurrency;
  /** Latest price of each crypto ticker in `currency`. */
  prices: Prices;
  run: SyncRun | undefined;
  onSync: () => void;
  onSaved: (address: WalletAddress, newAccount: boolean) => void;
  /** WALLET-REMOVE: the address stopped being tracked. */
  onRemoved: (address: WalletAddress) => void;
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
  onRemoved,
  onClose,
}: Props) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [choice, setChoice] = useState(address.accountId ?? NONE);
  const [newName, setNewName] = useState('');
  // W1: how a new wallet is held; null while untouched, so a Bybit account starts as an exchange.
  const [pickedKind, setPickedKind] = useState<KindChoice | null>(null);
  const [label, setLabel] = useState(address.label ?? '');
  const [saving, setSaving] = useState(false);
  const [allCoins, setAllCoins] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // The history read so far, newest first; undefined while loading, null when the read failed.
  const [history, setHistory] = useState<
    { items: AddressTransaction[]; next: number | null } | null | undefined
  >(undefined);
  const [showDust, setShowDust] = useState(false);
  // The Transactions list says which of them are dust and where each one opens; undefined while
  // it loads, null when it cannot be read (every row then shows, none opens).
  const [listed, setListed] = useState<ReadonlyMap<string, Operation> | null | undefined>(() => {
    const kept = cachedReads.operations.last();
    return kept ? operationsOf(kept.operations, address.id) : undefined;
  });
  const reading = useRef(false);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);

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
      setHistory({ items: [], next: null });
      return;
    }
    let live = true;
    walletAddressesApi
      .transactions(address.id)
      .then((page) => live && setHistory({ items: page.items, next: page.nextOffset }))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [address.id, count]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a sync that stores transactions changes what is dust, so the list is asked again.
  useEffect(() => {
    let live = true;
    cachedReads.operations
      .load()
      .then((list) => live && setListed(operationsOf(list.operations, address.id)))
      .catch(() => live && setListed((kept) => kept ?? null));
    return () => {
      live = false;
    };
  }, [address.id, count]);

  const isDust = (item: AddressTransaction) => listed?.get(item.txid)?.status === 'dust';
  const rows = history?.items ?? [];
  const shown = (showDust ? rows : rows.filter((item) => !isDust(item))).slice(
    0,
    SHOWN_TRANSACTIONS,
  );
  const dust = rows.filter(isDust).length;
  // Older pages may hold more dust than the ones read.
  const dustLabel = `${dust}${history?.next ? '+' : ''} dust ${dust === 1 && !history?.next ? 'transaction' : 'transactions'}`;
  const waiting =
    history === undefined || (history !== null && rows.length > 0 && listed === undefined);
  // Dust takes no place in the list, so older pages are read until it is full.
  useEffect(() => {
    if (!history || history.next === null || listed === undefined || reading.current) return;
    if (shown.length >= SHOWN_TRANSACTIONS || rows.length >= MAX_PAGES * 50) return;
    reading.current = true;
    const offset = history.next;
    walletAddressesApi
      .transactions(address.id, offset)
      .then((page) =>
        setHistory((kept) =>
          kept && kept.next === offset
            ? { items: [...kept.items, ...page.items], next: page.nextOffset }
            : kept,
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        reading.current = false;
      });
  }, [history, listed, shown.length, rows.length, address.id]);

  const wallet = accounts.find((account) => account.accountId === address.accountId);
  // M21: a Bitcoin account public key and the addresses it derives.
  const key = address.accountKey ?? null;
  // M22: a Bybit account, its balances as Bybit reports them.
  const exchange = address.exchange ?? null;
  const kind: KindChoice = pickedKind ?? (exchange ? 'exchange' : '');
  const network = networkOf(address);
  const balances = chainBalances(address);
  const value = addressValue(address, prices, currency);
  const pieces = chainPieces(address);

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
        const key = `${name}\n${kind}`;
        if (attempt.current?.key !== key) attempt.current = { key, requestId: newRequestId() };
        accountId = (
          await accountingApi.createAccount({
            requestId: attempt.current.requestId,
            name,
            ...(kind ? { kind } : {}),
          })
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
          <CloseButton buttonRef={closeButton} onClick={onClose} />
        </div>
        <div className="transactions-drawer__body">
          <div className="transactions-hero">
            <span className="transactions-hero__amount">
              {balances === null
                ? exchange
                  ? DASH
                  : `${DASH} ${network.symbol}`
                : (allCoins ? pieces : pieces.slice(0, SHOWN_COINS)).join(' · ')}
            </span>
            <span className="transactions-hero__value">
              {balances === null
                ? 'The balance appears once the whole history is loaded.'
                : value === DASH
                  ? 'No price yet'
                  : value}
            </span>
            {balances !== null && (
              <MoreCoins
                total={pieces.length}
                expanded={allCoins}
                hidden={0}
                onToggle={() => setAllCoins((current) => !current)}
              />
            )}
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
          {address.network === 'tron' && <ReportedBalanceNote address={address} />}
          <TokensSection address={address} onChange={(saved) => onSaved(saved, false)} />
          {address.staking && <StakingSection address={address} staking={address.staking} />}
          {address.pools && <PoolsSection pools={address.pools} />}
          {address.network === 'stellar' && address.reportedBalance && (
            <p className="wallets-message wallets-message--warn" role="note">
              Stellar reports {quantity(address.reportedBalance)} {network.symbol}; the transactions
              read give {quantity(address.chainBalance ?? '0')} {network.symbol}. The app does not
              read offers on the Stellar exchange, claimable balances or liquidity pools, and the
              public server keeps only recent history.
            </p>
          )}
          {address.network === 'zcash' && (
            <p className="wallets-note" role="note">
              This is the balance of the transparent address. Shielded balances are private and the
              app cannot read them: ZEC moved to a shielded address shows as sent.
            </p>
          )}
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
              <>
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
                <KindField id="address-new-kind" value={kind} onChange={setPickedKind} />
              </>
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
            {waiting ? (
              <p className="wallets-muted">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="wallets-muted">
                {history === null
                  ? 'Could not load them; they are in Transactions.'
                  : dust > 0
                    ? 'Only dust in the latest transactions.'
                    : 'None loaded yet. They appear here after a sync.'}
              </p>
            ) : (
              <ul className="wallets-recent">
                {shown.map((item) => {
                  const operation = listed?.get(item.txid);
                  const line = (
                    <>
                      <span>
                        {exchange ? recordLabel(item) : directionLabels[item.direction]}{' '}
                        <span className="wallets-muted">
                          {dayFormat.format(new Date(item.blockTime))}
                          {operation?.status === 'dust' && ' · dust'}
                        </span>
                      </span>
                      <span className="wallets-num">
                        {item.net.startsWith('-') ? '-' : '+'}
                        {quantity(item.net.replace(/^-/, ''))} {item.symbol}
                      </span>
                    </>
                  );
                  return (
                    <li key={item.txid}>
                      {operation ? (
                        <Link
                          className="wallets-recent__open"
                          to={`/transactions?open=${encodeURIComponent(operation.id)}`}
                        >
                          {line}
                        </Link>
                      ) : (
                        line
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="wallets-recent__more">
              {dust > 0 && (
                <button
                  type="button"
                  className="portfolio-link"
                  aria-expanded={showDust}
                  onClick={() => setShowDust((current) => !current)}
                >
                  {showDust ? 'Hide dust' : `Show ${dustLabel}`}
                </button>
              )}
              {count > 0 && (
                <Link
                  className="portfolio-link"
                  to={`/transactions?account=${encodeURIComponent(`wallet:${address.id}`)}`}
                >
                  All in Transactions
                </Link>
              )}
            </div>
          </section>
          <SyncJournal address={address} run={run} />
          <RemoveAddress
            id={address.id}
            exchange={!!exchange}
            onRemoved={() => onRemoved(address)}
          />
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

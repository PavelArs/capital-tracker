import { cachedReads } from '@api/cached-reads';
import type { Operation } from '@api/operations.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import {
  type AddressTransaction,
  type NewWalletAccount,
  type WalletAddress,
  walletAddressesApi,
} from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AmountHero } from '@/ui/AmountHero';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import Drawer, { DrawerFooter, DrawerHeader } from '@/ui/Drawer';
import { Field } from '@/ui/Field';
import { Input, Select } from '@/ui/inputs';
import { KeyValue, KeyValueRow } from '@/ui/KeyValue';
import { dayText } from '@/utils/dates';
import { newRequestId } from '../accounting/feedback';
import { age, DASH, quantity } from '../portfolio/format';
import CopyValue from '../shell/CopyValue';
import LoadMore, { PAGE_SIZE } from '../shell/InfiniteScroll';
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

/** Pages of the address's history read to fill the list: a spammed address has long runs of dust. */
const MAX_PAGES = 10;

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
  const closeButton = useRef<HTMLButtonElement>(null);
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
  // INFINITE: how many of the transactions below are on screen, twenty more each time the end
  // of the list is reached.
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  // The Transactions list says which of them are dust and where each one opens; undefined while
  // it loads, null when it cannot be read (every row then shows, none opens).
  const [listed, setListed] = useState<ReadonlyMap<string, Operation> | null | undefined>(() => {
    const kept = cachedReads.operations.last();
    return kept ? operationsOf(kept.operations, address.id) : undefined;
  });
  const reading = useRef(false);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);

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
  const listedRows = showDust ? rows : rows.filter((item) => !isDust(item));
  const shown = listedRows.slice(0, shownCount);
  // Whether rows wait beyond those on screen: older pages are read until some do, or until
  // the history, or the number of pages read for one list, runs out.
  const more = listedRows.length > shownCount;
  const exhausted = history?.next === null || rows.length >= MAX_PAGES * 50;
  const dust = rows.filter(isDust).length;
  // Older pages may hold more dust than the ones read.
  const dustLabel = `${dust}${history?.next ? '+' : ''} dust ${dust === 1 && !history?.next ? 'transaction' : 'transactions'}`;
  const waiting =
    history === undefined || (history !== null && rows.length > 0 && listed === undefined);
  // Dust takes no place in the list, so older pages are read until the page and the one after
  // it are known.
  useEffect(() => {
    if (!history || history.next === null || listed === undefined || reading.current) return;
    if (more || rows.length >= MAX_PAGES * 50) return;
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
  }, [history, listed, more, rows.length, address.id]);

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
      // WAL-INVALID: a new wallet goes with the move in one request, so a refused save leaves
      // no empty wallet behind.
      let destination: { accountId: string | null } | { newAccount: NewWalletAccount } = {
        accountId: choice === NONE ? null : choice,
      };
      if (choice === NEW) {
        const key = `${name}\n${kind}`;
        if (attempt.current?.key !== key) attempt.current = { key, requestId: newRequestId() };
        destination = {
          newAccount: { requestId: attempt.current.requestId, name, ...(kind ? { kind } : {}) },
        };
      }
      const saved = await walletAddressesApi.update(address.id, {
        ...destination,
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
    <Drawer titleId="address-title" onClose={onClose} initialFocus={() => closeButton.current}>
      <DrawerHeader
        titleId="address-title"
        title={
          wallet
            ? `${wallet.name} · ${network.name}`
            : `${network.name} ${exchange ? 'account' : 'address'}`
        }
        onClose={onClose}
        closeRef={closeButton}
      />
      <div className="ui-drawer__body">
        <div className="wallets-hero">
          <AmountHero
            amount={
              balances === null
                ? exchange
                  ? DASH
                  : `${DASH} ${network.symbol}`
                : (allCoins ? pieces : pieces.slice(0, SHOWN_COINS)).join(' · ')
            }
            detail={
              balances === null
                ? 'The balance appears once the whole history is loaded.'
                : value === DASH
                  ? 'No price yet'
                  : value
            }
          />
          {balances !== null && (
            <MoreCoins
              total={pieces.length}
              expanded={allCoins}
              hidden={0}
              onToggle={() => setAllCoins((current) => !current)}
            />
          )}
        </div>
        <KeyValue label="Details">
          <KeyValueRow term="Network">{network.name}</KeyValueRow>
          {network.assets.length > 1 && (
            <KeyValueRow term="Tracked assets">
              {exchange
                ? 'Every coin the account holds; Bybit prices the ones Kraken does not list'
                : `${network.assets.join(', ')}${network.anyToken ? ' and every other token' : ''}`}
            </KeyValueRow>
          )}
          <KeyValueRow term={key ? 'Public key' : exchange ? 'Bybit UID' : 'Address'}>
            <CopyValue
              value={address.address}
              label={key ? 'Copy public key' : exchange ? 'Copy UID' : 'Copy address'}
            />
          </KeyValueRow>
          {key && (
            <KeyValueRow term="Addresses">
              {key.usedAddresses} used · new ones are found automatically
            </KeyValueRow>
          )}
          {exchange && (
            <>
              <KeyValueRow term="API key">
                <span className="ui-mono">…{exchange.keyHint}</span> · read-only, stored encrypted
              </KeyValueRow>
              <KeyValueRow term="Key expires">
                {exchange.ipBound
                  ? 'Never: bound to an IP address'
                  : exchange.keyExpiresAt
                    ? `${dayText(exchange.keyExpiresAt)}. Bind it to the server's IP address in Bybit to keep it.`
                    : 'Unknown'}
              </KeyValueRow>
              <KeyValueRow term="History from">{dayText(exchange.historyFrom)}</KeyValueRow>
              {exchange.reportedAt && (
                <KeyValueRow term="Balances">
                  As Bybit reported them {age(exchange.reportedAt, new Date())}
                </KeyValueRow>
              )}
              {exchange.untracked.length > 0 && (
                <KeyValueRow term="Not tracked">
                  {exchange.untracked
                    .map((item) => `${quantity(item.quantity)} ${item.symbol}`)
                    .join(' · ')}
                  <span className="ui-muted"> · not counted</span>
                </KeyValueRow>
              )}
            </>
          )}
          <KeyValueRow term="Status">
            <SyncBadge address={address} run={run} />{' '}
            <span className="ui-muted wallets-small">{syncAge(address, run)}</span>
          </KeyValueRow>
          <KeyValueRow term="Transactions">{count}</KeyValueRow>
          <KeyValueRow term="Data source">{network.source}</KeyValueRow>
          <KeyValueRow term="Updates">Every hour in the background</KeyValueRow>
        </KeyValue>
        {key && key.alsoTracked.length > 0 && (
          <Banner tone="warn">
            {key.alsoTracked.length === 1
              ? 'One address of this key is also tracked as its own wallet'
              : `${key.alsoTracked.length} addresses of this key are also tracked as their own wallets`}{' '}
            ({key.alsoTracked.map((item) => item.label ?? shortAddress(item.address)).join(', ')}
            ), so their coins count twice.
          </Banner>
        )}
        {address.network === 'tron' && <ReportedBalanceNote address={address} />}
        <TokensSection address={address} onChange={(saved) => onSaved(saved, false)} />
        {address.staking && <StakingSection address={address} staking={address.staking} />}
        {address.pools && <PoolsSection pools={address.pools} />}
        {address.network === 'stellar' && address.reportedBalance && (
          <Banner tone="warn">
            Stellar reports {quantity(address.reportedBalance)} {network.symbol}; the transactions
            read give {quantity(address.chainBalance ?? '0')} {network.symbol}. The app does not
            read offers on the Stellar exchange, claimable balances or liquidity pools, and the
            public server keeps only recent history.
          </Banner>
        )}
        {address.network === 'zcash' && (
          <Banner tone="info">
            This is the balance of the transparent address. Shielded balances are private and the
            app cannot read them: ZEC moved to a shielded address shows as sent.
          </Banner>
        )}
        {exchange && <EarnSection exchange={exchange} />}
        {exchange && <ConvertNote exchange={exchange} />}
        {syncProblem(address, run) && (
          // wallets-13: an amber note with an alert icon, as on the Wallets row. A sync the owner
          // just ran is said aloud (wallets-02); a failure the background job stored is a note.
          <Banner tone="warn" role={run?.state === 'failed' ? 'alert' : 'note'}>
            {syncProblem(address, run)}
          </Banner>
        )}
        <form className="wallets-edit" onSubmit={save} aria-labelledby="address-wallet">
          <h3 id="address-wallet" className="ui-section-t">
            Wallet and name
          </h3>
          <Field id="address-account" label="Wallet">
            {(control) => (
              <Select
                {...control}
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
              </Select>
            )}
          </Field>
          {choice === NEW && (
            <>
              <Field id="address-new-wallet" label="New wallet name">
                {(control) => (
                  <Input
                    {...control}
                    maxLength={120}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                )}
              </Field>
              <KindField id="address-new-kind" value={kind} onChange={setPickedKind} />
            </>
          )}
          <Field
            id="address-label"
            label={
              <>
                {exchange ? 'Account name' : 'Address name'}{' '}
                <span className="ui-muted">(optional)</span>
              </>
            }
          >
            {(control) => (
              <Input
                {...control}
                maxLength={40}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            )}
          </Field>
          {/* The drawer stays open after Save, so its result is said here (plan 1.5: a toast is
              for a command whose drawer closed). */}
          {message &&
            (message.error ? (
              <Banner tone="neg">{message.text}</Banner>
            ) : (
              <Banner tone="pos">{message.text}</Banner>
            ))}
          <Button type="submit" className="wallets-edit__save" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </form>
        <section aria-labelledby="address-transactions">
          <h3 id="address-transactions" className="ui-section-t">
            {exchange ? 'Bybit records' : 'Blockchain transactions'}
          </h3>
          {waiting ? (
            <p className="ui-muted wallets-small">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="ui-muted wallets-small">
              {history === null
                ? 'Could not load them; they are in Transactions.'
                : dust > 0
                  ? 'Only dust in the latest transactions.'
                  : 'None loaded yet. They appear here after a sync.'}
            </p>
          ) : (
            <ul className="wallets-list wallets-recent">
              {shown.map((item) => {
                const operation = listed?.get(item.txid);
                const line = (
                  <>
                    <span>
                      {exchange ? recordLabel(item) : directionLabels[item.direction]}{' '}
                      <span className="ui-muted">
                        {dayText(item.blockTime)}
                        {operation?.status === 'dust' && ' · dust'}
                      </span>
                    </span>
                    <span className="ui-num ui-nowrap">
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
          {(more || !exhausted) && !waiting && shown.length > 0 && (
            <LoadMore
              shown={shown.length}
              total={history?.next === null ? listedRows.length : undefined}
              busy={!more && !exhausted}
              onMore={() => setShownCount((current) => current + PAGE_SIZE)}
              label="transactions"
            />
          )}
          <div className="wallets-recent__more">
            {dust > 0 && (
              <Button
                variant="link"
                aria-expanded={showDust}
                onClick={() => {
                  setShowDust((current) => !current);
                  setShownCount(PAGE_SIZE);
                }}
              >
                {showDust ? 'Hide dust' : `Show ${dustLabel}`}
              </Button>
            )}
            {count > 0 && (
              <Link
                className="ui-link"
                to={`/transactions?account=${encodeURIComponent(`wallet:${address.id}`)}`}
              >
                All in Transactions
              </Link>
            )}
          </div>
        </section>
        <SyncJournal address={address} run={run} />
        <RemoveAddress id={address.id} exchange={!!exchange} onRemoved={() => onRemoved(address)} />
      </div>
      <DrawerFooter>
        <span className="ui-grow" />
        <Button icon="refresh" disabled={running} onClick={onSync}>
          {running ? 'Syncing…' : 'Sync now'}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

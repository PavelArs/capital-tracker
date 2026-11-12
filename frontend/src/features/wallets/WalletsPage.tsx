import type { WalletKind } from '@api/accounting.api';
import type { AccountingCurrency, PortfolioValuation } from '@api/portfolio-valuation.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { useToast } from '@contexts/ToastContext';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import PageIntro from '@/ui/PageIntro';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import { withCurrency } from '../portfolio/currency';
import { money } from '../portfolio/format';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { PageSkeleton } from '../shell/Skeleton';
import AddressDrawer from './AddressDrawer';
import AddWalletDialog, { type WalletAccount } from './AddWalletDialog';
import { useWallets } from './useWallets';
import {
  AddressRow,
  connectsBybit,
  type Holding,
  holdingsOf,
  ManualRow,
  networksText,
  ReconcileNote,
  subtitle,
  trackedSymbols,
  withoutHiddenTokens,
} from './WalletParts';
import { gapAddress, isCoin, PENDING, pricesOf, type Reconciliation, reconcile } from './wallets';
import '../shell/shell-page.css';
import './wallets.css';

/** The addresses of one wallet, twenty to a page; the page is only shown when there are more. */
function PagedSources({
  items,
  label,
  row,
  children,
}: {
  items: WalletAddress[];
  label: string;
  row: (address: WalletAddress) => ReactNode;
  children?: ReactNode;
}) {
  const paged = useInfinite(items);
  return (
    <>
      <ul className="wallets-sources">
        {paged.rows.map(row)}
        {children}
      </ul>
      {paged.more && <LoadMore {...paged.more} label={label} />}
    </>
  );
}

type WalletAccountValue = PortfolioValuation['accounts'][number];

/** Each wallet with its addresses and holdings: wallets with addresses first, then by value, then by name. */
function walletCards(
  portfolio: PortfolioValuation | null,
  walletAccounts: WalletAccountValue[],
  list: WalletAddress[],
) {
  if (!portfolio) return [];
  return walletAccounts
    .map((account) => ({
      account,
      addresses: list.filter((address) => address.accountId === account.accountId),
      holdings: holdingsOf(portfolio, account.accountId),
    }))
    .sort(
      (left, right) =>
        Number(right.addresses.length > 0) - Number(left.addresses.length > 0) ||
        Number(right.account.pricedValue ?? 0) - Number(left.account.pricedValue ?? 0) ||
        left.account.name.localeCompare(right.account.name, 'en'),
    );
}

function UnassignedCard({
  items,
  row,
}: {
  items: WalletAddress[];
  row: (address: WalletAddress) => ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <Card variant="flush" className="wallets-card" labelledBy="wallets-unassigned">
      <div className="wallets-card__head">
        <span className="wallets-card__icon" aria-hidden="true">
          <Icon name="wallets" />
        </span>
        <div className="wallets-card__title">
          <h2 id="wallets-unassigned">Not in a wallet yet</h2>
          <span>Open an address and choose the wallet it belongs to.</span>
        </div>
      </div>
      <PagedSources items={items} label="addresses" row={row} />
    </Card>
  );
}

/** One wallet: its tracked addresses, the coins entered by hand, and whether the chain agrees. */
function WalletCard({
  account,
  own,
  holdings: all,
  kind,
  currency,
  narrow,
  asked,
  row,
  reconciliation,
  target,
  onConnect,
  onCounted,
}: {
  account: WalletAccountValue;
  own: WalletAddress[];
  holdings: Holding[];
  kind: WalletKind | null;
  currency: AccountingCurrency;
  narrow: boolean;
  asked: AccountingCurrency | undefined;
  row: (address: WalletAddress) => ReactNode;
  reconciliation: Reconciliation;
  target: WalletAddress | null;
  onConnect: () => void;
  onCounted: () => void;
}) {
  const holdings = withoutHiddenTokens(all, own);
  const tracked = trackedSymbols(own);
  const manual = holdings.filter(
    (holding) => ![...tracked].some((symbol) => isCoin(holding.asset, symbol)),
  );
  const headingId = `wallet-${account.accountId}`;
  return (
    <Card variant="flush" className="wallets-card" labelledBy={headingId}>
      {/* The whole head opens the wallet (prototype): the link's area covers it, and its
          name stays the wallet's name. */}
      <div className="wallets-card__head wallets-card__head--link">
        <span className="wallets-card__icon" aria-hidden="true">
          <Icon name={kind ?? 'wallets'} />
        </span>
        <div className="wallets-card__title">
          <h2 id={headingId}>
            <Link
              className="wallets-card__link"
              to={withCurrency(`/wallets/${account.accountId}`, asked)}
            >
              {account.name}
            </Link>
          </h2>
          <span>{subtitle(own, kind)}</span>
        </div>
        <div className="wallets-card__total">
          <strong className="ui-num">{money(account.pricedValue, currency)}</strong>
          <span>{networksText(own)}</span>
        </div>
      </div>
      {own.length > 0 || manual.length > 0 ? (
        <PagedSources items={own} label={`addresses of ${account.name}`} row={row}>
          {manual.length > 0 && (
            <ManualRow
              holdings={manual}
              currency={currency}
              narrow={narrow}
              onConnect={connectsBybit(account.name, own, kind) ? onConnect : undefined}
            />
          )}
        </PagedSources>
      ) : (
        <p className="wallets-empty-row">Nothing in this wallet yet.</p>
      )}
      <ReconcileNote result={reconciliation} target={target} onCounted={onCounted} />
    </Card>
  );
}

// Wallets grouped the way the owner holds them (prototype "Wallets", M10): each account with
// its tracked addresses, the coins entered by hand, and whether the chain agrees.
export default function WalletsPage() {
  const {
    portfolio,
    addresses,
    kinds,
    classed,
    hiddenSymbols,
    failed,
    load,
    replace,
    forget,
    runs,
    sync,
    setSyncEnabled,
    asked,
  } = useWallets();
  const toast = useToast();
  // true opens Add wallet on its first step; a wallet's id opens it on that wallet's Bybit key.
  const [adding, setAdding] = useState<boolean | string>(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // wallets-07: the wallet just added gets the keyboard once its card is on the page.
  const [arrived, setArrived] = useState<string | null>(null);
  // wallets-21: a wallet removed on its own page is named in a toast, and the keyboard lands on
  // this page's heading (plan 1.5: the row it was on is gone).
  const page = useRef<HTMLDivElement>(null);
  const [focusHeading, setFocusHeading] = useState(false);
  // Crypto in Portfolio's Add to portfolio comes here and opens Add wallet once the wallets are
  // known, so a duplicate address is still caught; the request is cleared so Back does not repeat it.
  const location = useLocation();
  const navigate = useNavigate();
  const addRequested = Boolean((location.state as { addWallet?: boolean } | null)?.addWallet);
  useEffect(() => {
    if (!addRequested || addresses === null) return;
    setAdding(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [addRequested, addresses, navigate, location.pathname, location.search]);
  const removed = (location.state as { removedWallet?: unknown } | null)?.removedWallet;
  useEffect(() => {
    if (typeof removed !== 'string') return;
    toast.show({ tone: 'success', title: `${removed} was removed` });
    setFocusHeading(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [removed, toast, navigate, location.pathname, location.search]);
  useEffect(() => {
    const heading = focusHeading ? page.current?.querySelector<HTMLElement>('h1') : null;
    if (!heading) return;
    heading.focus();
    setFocusHeading(false);
  });
  useEffect(() => {
    if (!arrived) return;
    const link = document.getElementById(`wallet-${arrived}`)?.querySelector('a');
    setArrived(null);
    if (!link) return;
    link.scrollIntoView?.({ block: 'center' });
    link.focus({ preventScroll: true });
  });
  const narrow = useNarrowScreen();
  // Property and broker accounts (v8) are listed in their own sections, not here.
  const walletAccounts = (portfolio?.accounts ?? []).filter(
    ({ accountId }) => !classed.has(accountId),
  );
  const accounts: WalletAccount[] = walletAccounts.map(({ accountId, name }) => ({
    accountId,
    name,
  }));
  const list = addresses ?? [];
  const currency = portfolio?.currency ?? 'USD';
  const prices = pricesOf(portfolio);
  const open = list.find((address) => address.id === openId);
  const unassigned = list.filter(
    (address) => !address.accountId || !accounts.some((a) => a.accountId === address.accountId),
  );
  const cards = walletCards(portfolio, walletAccounts, list);

  // PAGES: twenty wallets a page.
  const pagedCards = useInfinite(cards);
  const addButton = (
    <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
      Add wallet
    </Button>
  );
  const row = (address: WalletAddress) => (
    <AddressRow
      key={address.id}
      address={address}
      run={runs[address.id]}
      narrow={narrow}
      prices={prices}
      currency={currency}
      onOpen={() => setOpenId(address.id)}
      onSync={() => void sync(address.id)}
      onSyncEnabled={(enabled) => setSyncEnabled(address.id, enabled)}
    />
  );

  return (
    <div ref={page} className="shell-page">
      <PageHeader title="Wallets" currency={portfolio?.currency} />
      {failed ? (
        <ErrorState what="your wallets" onRetry={() => void load()} />
      ) : portfolio === null || addresses === null ? (
        <PageSkeleton label="Loading wallets" show={['cards']} />
      ) : cards.length === 0 && list.length === 0 ? (
        <EmptyState
          id="wallets-empty"
          title="No wallets connected"
          icon={<Icon name="wallets" />}
          actions={addButton}
        >
          Add a Bitcoin, Ethereum or Solana address. The app only reads public data and never asks
          for a seed phrase.
        </EmptyState>
      ) : (
        <>
          <PageIntro action={addButton}>
            Wallets are read-only. The app stores only public addresses and read-only exchange keys;
            it never asks for a seed phrase or a private key.
          </PageIntro>
          <UnassignedCard items={unassigned} row={row} />
          {pagedCards.rows.map(({ account, addresses: own, holdings }) => (
            <WalletCard
              key={account.accountId}
              account={account}
              own={own}
              holdings={holdings}
              kind={kinds[account.accountId] ?? null}
              currency={currency}
              narrow={narrow}
              asked={asked}
              row={row}
              reconciliation={
                hiddenSymbols
                  ? reconcile(list, portfolio, account.accountId, hiddenSymbols)
                  : PENDING
              }
              target={gapAddress(list, account.accountId)}
              onConnect={() => setAdding(account.accountId)}
              onCounted={() => void load(true)}
            />
          ))}
          {pagedCards.more && <LoadMore {...pagedCards.more} label="wallets" />}
        </>
      )}
      {adding !== false && (
        <AddWalletDialog
          accounts={accounts}
          addresses={list}
          {...(typeof adding === 'string' ? { network: 'bybit' as const, accountId: adding } : {})}
          onClose={() => setAdding(false)}
          onOpenExisting={(address) => {
            setAdding(false);
            setOpenId(address.id);
          }}
          onAdded={async (address, created) => {
            setAdding(false);
            const wallet = accounts.find((item) => item.accountId === address.accountId);
            // wallets-07: a toast says what was added and that its history now loads (plan 1.5:
            // a process that finishes later), and a new wallet's address waits for its card
            // instead of showing as not in a wallet meanwhile.
            if (created)
              toast.show({
                tone: 'info',
                title: wallet ? `Added to ${wallet.name}` : 'Wallet added',
                detail: 'Syncing transactions…',
              });
            if (address.accountId && !wallet) {
              // A reload that fails leaves the saved address on the page rather than nothing.
              await load(true);
              replace(address);
            } else {
              replace(address);
              void load(true);
            }
            if (created) {
              setArrived(address.accountId);
              void sync(address.id);
            } else setOpenId(address.id);
            // A Bybit account added again carries a new key: read it at once.
            if (!created && address.network === 'bybit') void sync(address.id);
          }}
        />
      )}
      {open && portfolio && (
        <AddressDrawer
          key={open.id}
          address={open}
          accounts={accounts}
          currency={currency}
          prices={prices}
          run={runs[open.id]}
          onSync={() => void sync(open.id)}
          onSyncEnabled={(enabled) => setSyncEnabled(open.id, enabled)}
          onSaved={(address, newAccount) => {
            replace(address);
            if (newAccount) void load(true);
          }}
          onRemoved={(address) => {
            setOpenId(null);
            forget(address.id);
            void load(true);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

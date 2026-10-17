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
  holdingsOf,
  ManualRow,
  ReconcileNote,
  subtitle,
  trackedSymbols,
  withoutHiddenTokens,
} from './WalletParts';
import { gapAddress, isCoin, PENDING, pricesOf, reconcile } from './wallets';
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
  const cards = portfolio
    ? walletAccounts
        .map((account) => ({
          account,
          addresses: list.filter((address) => address.accountId === account.accountId),
          holdings: holdingsOf(portfolio, account.accountId),
        }))
        // Wallets with addresses first, then by value, then by name.
        .sort(
          (left, right) =>
            Number(right.addresses.length > 0) - Number(left.addresses.length > 0) ||
            Number(right.account.pricedValue ?? 0) - Number(left.account.pricedValue ?? 0) ||
            left.account.name.localeCompare(right.account.name, 'en'),
        )
    : [];

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
    />
  );

  return (
    <div ref={page} className="shell-page">
      <PageHeader title="Wallets" currency={portfolio?.currency} />
      {failed ? (
        <ErrorState onRetry={() => void load()}>
          Could not load your wallets. Your data is safe; try again.
        </ErrorState>
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
          {unassigned.length > 0 && (
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
              <PagedSources items={unassigned} label="addresses" row={row} />
            </Card>
          )}
          {pagedCards.rows.map(({ account, addresses: own, holdings: all }) => {
            const holdings = withoutHiddenTokens(all, own);
            const tracked = trackedSymbols(own);
            const manual = holdings.filter(
              (holding) => ![...tracked].some((symbol) => isCoin(holding.asset, symbol)),
            );
            const headingId = `wallet-${account.accountId}`;
            const kind = kinds[account.accountId] ?? null;
            return (
              <Card
                key={account.accountId}
                variant="flush"
                className="wallets-card"
                labelledBy={headingId}
              >
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
                    <span>{holdings.length === 1 ? '1 asset' : `${holdings.length} assets`}</span>
                  </div>
                </div>
                {own.length > 0 || manual.length > 0 ? (
                  <PagedSources items={own} label={`addresses of ${account.name}`} row={row}>
                    {manual.length > 0 && (
                      <ManualRow
                        holdings={manual}
                        currency={currency}
                        narrow={narrow}
                        onConnect={
                          connectsBybit(account.name, own, kinds[account.accountId] ?? null)
                            ? () => setAdding(account.accountId)
                            : undefined
                        }
                      />
                    )}
                  </PagedSources>
                ) : (
                  <p className="wallets-empty-row">Nothing in this wallet yet.</p>
                )}
                <ReconcileNote
                  result={
                    hiddenSymbols
                      ? reconcile(list, portfolio, account.accountId, hiddenSymbols)
                      : PENDING
                  }
                  target={gapAddress(list, account.accountId)}
                  onCounted={() => void load(true)}
                />
              </Card>
            );
          })}
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

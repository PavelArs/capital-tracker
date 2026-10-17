import { accountingApi } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { Operation, OperationList } from '@api/operations.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { announceSyncChange } from '@api/sync-status.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { useToast } from '@contexts/ToastContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Badge from '@/ui/Badge';
import { Banner } from '@/ui/Banner';
import { Button, ButtonLink } from '@/ui/Button';
import { Card, CardHeader } from '@/ui/Card';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import EmptyState from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Crumb, PageHead } from '@/ui/PageHead';
import { Stat, Stats } from '@/ui/Stats';
import { useNarrowScreen } from '@/ui/useMediaQuery';
import { requestFailure } from '@/utils/request-failure';
import { withCurrency } from '../portfolio/currency';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import LoadMore, { useInfinite } from '../shell/InfiniteScroll';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { InlineSkeleton, PageSkeleton } from '../shell/Skeleton';
import { onlyChain, tokenChains, withChains } from '../shell/token-chains';
import { day, signedAmount, statusLabels, typeLabel } from '../transactions/operation-format';
import AddressDrawer from './AddressDrawer';
import AddWalletDialog, { type WalletAccount } from './AddWalletDialog';
import EditWalletDialog from './EditWalletDialog';

import { SyncBadge, type SyncRun, syncAge } from './SyncStatus';
import { useWallets } from './useWallets';
import {
  AddressRow,
  connectsBybit,
  holdingsOf,
  ReconcileNote,
  subtitle,
  withoutHiddenTokens,
} from './WalletParts';
import { gapAddress, holdingShare, PENDING, pricesOf, reconcile } from './wallets';
import '../shell/shell-page.css';
import './wallets.css';

type OperationsState = OperationList | 'loading' | 'failed';

/**
 * What happened in the account, newest first: its own rows, transfers in and chain rows. Dust
 * stays on the Transactions page under its own filter.
 */
export function accountOperations(operations: readonly Operation[], accountId: string) {
  return operations
    .filter(
      (operation) =>
        operation.status !== 'dust' &&
        (operation.account?.id === accountId ||
          // A blockchain row to classify only suggests its other side (M13).
          (operation.type === 'transfer' && operation.counterAccount?.id === accountId)),
    )
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.orderWithinTimestamp - left.orderWithinTimestamp,
    );
}

/** The least recent state across the addresses: one failing or loading address shows. */
function LastSync({
  addresses,
  runs,
}: {
  addresses: WalletAddress[];
  runs: Record<string, SyncRun>;
}) {
  const order = (address: WalletAddress) => {
    const run = runs[address.id];
    if (run?.state === 'failed' || (!run && address.sync.status === 'failed')) return 0;
    if (run?.state === 'running' || address.sync.status === 'syncing') return 1;
    if (address.sync.status === 'delayed') return 2;
    return { never: 3, partial: 4, complete: 5 }[address.sync.state];
  };
  const worst = [...addresses].sort(
    (left, right) =>
      order(left) - order(right) ||
      (left.sync.completedAt ?? '').localeCompare(right.sync.completedAt ?? ''),
  )[0];
  if (!worst) return <span className="ui-muted wallets-small">Tracked by hand</span>;
  const when = syncAge(worst, runs[worst.id]);
  return (
    <span className="wallets-status">
      <SyncBadge address={worst} run={runs[worst.id]} />
      {when && <span className="ui-muted wallets-small">{when}</span>}
    </span>
  );
}

function WalletTransactions({
  accountId,
  asked,
  operations,
  onRetry,
}: {
  accountId: string;
  asked: AccountingCurrency | undefined;
  operations: OperationsState;
  onRetry: () => void;
}) {
  const own =
    typeof operations === 'object' ? accountOperations(operations.operations, accountId) : [];
  // PAGES: twenty transactions a page.
  const pagedOwn = useInfinite(own);
  return (
    <Card labelledBy="wallet-transactions">
      <CardHeader
        id="wallet-transactions"
        title="Transactions"
        sub={typeof operations === 'object' ? own.length : undefined}
      />
      {operations === 'failed' ? (
        // The card stays; the failure and Try again are inside it (no card in a card).
        <Banner
          tone="neg"
          action={
            <Button size="sm" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          }
        >
          Could not load this wallet's transactions.
        </Banner>
      ) : operations === 'loading' ? (
        <InlineSkeleton label="Loading transactions" />
      ) : own.length === 0 ? (
        <EmptyState id="wallet-transactions-none" title="No transactions yet." compact />
      ) : (
        <>
          <ul className="wallets-list wallets-holdings">
            {pagedOwn.rows.map((operation) => (
              <li key={operation.id}>
                <Link
                  className="wallets-holdings__open"
                  to={`/transactions?open=${encodeURIComponent(operation.id)}${asked ? `&currency=${asked}` : ''}`}
                >
                  <span className="wallets-holdings__main">
                    {operation.status === 'needs-classification' ? (
                      <Badge tone="warn" dot>
                        {statusLabels[operation.status]}
                      </Badge>
                    ) : (
                      typeLabel(operation)
                    )}
                    <span className="ui-sub">
                      {day(operation.occurredAt)}
                      {operation.type === 'transfer' && operation.counterAccount
                        ? ` · ${operation.account?.name ?? ''} → ${operation.counterAccount.name}`
                        : ''}
                    </span>
                  </span>
                  <span className="ui-num wallets-holdings__side">
                    {signedAmount(operation)}
                    {operation.value !== null && typeof operations === 'object' && (
                      <span className="ui-sub">
                        {money(operation.value, operations.quoteCurrency)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {pagedOwn.more && <LoadMore {...pagedOwn.more} label="transactions" />}
          <Link
            className="ui-link wallets-all"
            to={`/transactions?account=${encodeURIComponent(accountId)}`}
          >
            Open in Transactions
          </Link>
        </>
      )}
    </Card>
  );
}

/** WALLET-REMOVE: the reason the server gave, or a plain sentence for what went wrong. */
const removalFailure = (error: unknown) =>
  requestFailure(error, {
    unreachable: 'Could not reach the server. Nothing was changed; try again.',
    status: {
      409: (message) => message ?? 'Could not remove the wallet. Nothing was changed; try again.',
      404: 'This wallet no longer exists. Reload the page.',
    },
    fallback: 'Could not remove the wallet. Nothing was changed; try again.',
  });

// One wallet (account): its value, addresses, assets and transactions (prototype "wallet").
export default function WalletPage() {
  const { accountId = '' } = useParams();
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
  const navigate = useNavigate();
  const [adding, setAdding] = useState<boolean | 'bybit'>(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const narrow = useNarrowScreen();

  const [operations, setOperations] = useState<OperationsState>(
    () => cachedReads.operations.last(asked) ?? 'loading',
  );
  const latestOperations = useRef(0);
  const loadOperations = useCallback(async () => {
    const request = ++latestOperations.current;
    // What was kept stays on screen while the fresh list loads.
    const kept = cachedReads.operations.last(asked);
    setOperations(kept ?? 'loading');
    try {
      const list = await cachedReads.operations.load(asked);
      if (request === latestOperations.current) setOperations(list);
    } catch {
      if (request === latestOperations.current && !kept) setOperations('failed');
    }
  }, [asked]);
  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const account = portfolio?.accounts.find((item) => item.accountId === accountId);
  const kind = kinds[accountId] ?? null;
  // A broker account or a property (v8) is never offered as a wallet to put an address in.
  const accounts: WalletAccount[] = (portfolio?.accounts ?? [])
    .filter((item) => !classed.has(item.accountId))
    .map(({ accountId: id, name }) => ({ accountId: id, name }));
  const list = addresses ?? [];
  const own = list.filter((address) => address.accountId === accountId);
  const currency = portfolio?.currency ?? 'USD';
  const prices = pricesOf(portfolio);
  const holdings = portfolio ? withoutHiddenTokens(holdingsOf(portfolio, accountId), own) : [];
  const chains = tokenChains(addresses, accountId);
  const total = account?.pricedValue ?? null;
  const open = list.find((address) => address.id === openId);
  const syncing = own.some((address) => runs[address.id]?.state === 'running');
  // PAGES: twenty addresses and twenty assets a page.
  const pagedAddresses = useInfinite(own);
  const pagedHoldings = useInfinite(holdings);
  const refresh = () => {
    void load(true);
    void loadOperations();
  };
  const syncAll = async () => {
    for (const address of own) await sync(address.id);
    void loadOperations();
  };

  return (
    <div className="shell-page">
      <PageHeader title="Wallets" currency={portfolio?.currency} />
      <div className="wallets-crumbs">
        <Crumb to={withCurrency('/wallets', asked)}>Wallets</Crumb>
      </div>
      {failed ? (
        <ErrorState onRetry={() => void load()}>
          Could not load this wallet. Your data is safe; try again.
        </ErrorState>
      ) : portfolio === null || addresses === null ? (
        <PageSkeleton label="Loading wallet" show={['stats', 'rows']} />
      ) : !account ? (
        <EmptyState
          id="wallet-missing"
          title="Wallet not found"
          actions={<ButtonLink to={withCurrency('/wallets', asked)}>Open Wallets</ButtonLink>}
        >
          It may belong to another owner or the link is wrong.
        </EmptyState>
      ) : (
        <>
          <PageHead
            icon={
              <span className="wallets-card__icon wallets-card__icon--lg">
                <Icon name={kind ?? 'wallets'} />
              </span>
            }
            title={account.name}
            subtitle={subtitle(own, kind)}
            actions={
              <>
                <Button variant="ghost" icon="edit" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="ghost" destructive onClick={() => setRemoving(true)}>
                  Remove
                </Button>
                {own.length > 0 && (
                  // wallets-02: the button stays focusable while it runs, so the keyboard stays on it.
                  <Button
                    icon="refresh"
                    aria-disabled={syncing}
                    onClick={() => {
                      if (!syncing) void syncAll();
                    }}
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </Button>
                )}
              </>
            }
          />
          <Card className="wallet-overview" label="Summary">
            <Stats size="lg">
              <Stat lead label="Total value" value={money(total, currency)} />
              <Stat label="Assets" value={holdings.length} />
              <Stat label="Tracked addresses" value={own.length || 'None'} />
              <Stat label="Last sync" value={<LastSync addresses={own} runs={runs} />} />
            </Stats>
            <ReconcileNote
              result={
                hiddenSymbols ? reconcile(list, portfolio, accountId, hiddenSymbols) : PENDING
              }
              target={gapAddress(list, accountId)}
              onCounted={() => void load(true)}
            />
          </Card>
          {own.length > 0 && (
            <Card variant="flush" className="wallets-card" labelledBy="wallet-addresses">
              <CardHeader
                id="wallet-addresses"
                title="Addresses"
                actions={
                  <Button variant="ghost" size="sm" icon="plus" onClick={() => setAdding(true)}>
                    Add address
                  </Button>
                }
              />
              <ul className="wallets-sources">
                {pagedAddresses.rows.map((address) => (
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
                ))}
              </ul>
              {pagedAddresses.more && <LoadMore {...pagedAddresses.more} label="addresses" />}
            </Card>
          )}
          <div className="wallets-split">
            <Card labelledBy="wallet-assets">
              <CardHeader id="wallet-assets" title="Assets" />
              {holdings.length === 0 ? (
                <EmptyState id="wallet-assets-none" title="No assets in this wallet." compact />
              ) : (
                <ul className="wallets-list wallets-holdings">
                  {pagedHoldings.rows.map((holding) => (
                    <li key={holding.asset.instrumentId}>
                      <Link
                        className="wallets-asset wallets-holdings__asset"
                        to={withCurrency(`/portfolio/${holding.asset.instrumentId}`, asked)}
                      >
                        <AssetIcon
                          symbol={holding.asset.symbol}
                          name={holding.asset.name}
                          assetType={holding.asset.assetType}
                          network={onlyChain(holding.asset.symbol, chains)}
                          size="sm"
                        />
                        <span>
                          {holding.asset.name}
                          <span className="ui-sub">
                            {withChains(
                              `${quantity(holding.quantity)} ${holding.asset.symbol ?? ''}`.trim(),
                              holding.asset.symbol,
                              chains,
                            )}
                          </span>
                        </span>
                      </Link>
                      <span className="ui-num wallets-holdings__side">
                        {holding.value === null ? DASH : money(holding.value, currency)}
                        {holding.value !== null && total !== null && Number(total) > 0 && (
                          <span className="ui-sub">{holdingShare(holding.value, total)}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {pagedHoldings.more && <LoadMore {...pagedHoldings.more} label="assets" />}
            </Card>
            <WalletTransactions
              accountId={accountId}
              asked={asked}
              operations={operations}
              onRetry={() => void loadOperations()}
            />
          </div>
          {own.length === 0 && (
            <Card as="div">
              {connectsBybit(account.name, own, kind) ? (
                // wallets-08: a Bybit account kept by hand can read itself with a read-only key.
                <p className="ui-soft wallets-text">
                  {account.name} is tracked by hand: balances come from the transactions you add.{' '}
                  <Button variant="link" onClick={() => setAdding('bybit')}>
                    Connect Bybit API
                  </Button>{' '}
                  to read its balances and history with a read-only key.
                </p>
              ) : (
                <p className="ui-soft wallets-text">
                  {account.name} is tracked by hand: balances come from the transactions you add.{' '}
                  <Button variant="link" onClick={() => setAdding(true)}>
                    Add a wallet address
                  </Button>{' '}
                  to compare them with the blockchain.
                </p>
              )}
            </Card>
          )}
        </>
      )}
      {adding && account && (
        <AddWalletDialog
          accounts={accounts}
          addresses={list}
          accountId={accountId}
          network={adding === 'bybit' ? 'bybit' : undefined}
          onClose={() => setAdding(false)}
          onOpenExisting={(address) => {
            setAdding(false);
            setOpenId(address.id);
          }}
          onAdded={(address, created) => {
            setAdding(false);
            // wallets-07: a toast says what was added and that its history now loads.
            if (created)
              toast.show({
                tone: 'info',
                title:
                  address.accountId === accountId
                    ? `Added to ${account.name}. Syncing transactions…`
                    : 'Wallet added. Syncing transactions…',
              });
            replace(address);
            void load(true);
            if (created || address.network === 'bybit')
              void sync(address.id).then(() => void loadOperations());
            if (!created) setOpenId(address.id);
          }}
        />
      )}
      {editing && account && (
        <EditWalletDialog
          accountId={account.accountId}
          name={account.name}
          kind={kind}
          onClose={() => setEditing(false)}
          onSaved={(changes) => {
            setEditing(false);
            // wallets-21: a toast says what was saved; the keyboard goes back to Edit.
            toast.show({
              tone: 'success',
              title: 'name' in changes ? 'Wallet renamed.' : 'Wallet saved.',
            });
            refresh();
          }}
        />
      )}
      {removing && account && (
        <ConfirmDialog
          title={`Remove ${account.name}?`}
          confirmLabel="Remove wallet"
          busyLabel="Removing…"
          failure={removalFailure}
          onConfirm={async () => {
            await accountingApi.removeAccount(account.accountId);
            announceSyncChange();
            // wallets-21: Wallets says what was removed and takes the keyboard there.
            navigate(withCurrency('/wallets', asked), { state: { removedWallet: account.name } });
          }}
          onClose={() => setRemoving(false)}
        >
          {own.length > 0
            ? `${account.name} leaves your wallets and its ${own.length === 1 ? 'address stops' : `${own.length} addresses stop`} syncing. A wallet that holds recorded transactions cannot be removed, because they are your history; remove its addresses instead.`
            : `${account.name} leaves your wallets. A wallet that holds recorded transactions cannot be removed, because they are your history.`}
        </ConfirmDialog>
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
            if (newAccount || address.accountId !== accountId) refresh();
          }}
          onRemoved={(address) => {
            setOpenId(null);
            forget(address.id);
            refresh();
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

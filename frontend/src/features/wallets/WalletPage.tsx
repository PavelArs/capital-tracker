import { type Operation, type OperationList, operationsApi } from '@api/operations.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { withCurrency } from '../portfolio/currency';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { day, signedAmount, statusLabels, typeLabel } from '../transactions/operation-format';
import { useNarrowScreen } from '../transactions/useNarrowScreen';
import AddressDrawer from './AddressDrawer';
import AddWalletDialog, { type WalletAccount } from './AddWalletDialog';
import RenameWalletDialog from './RenameWalletDialog';
import { SyncBadge, type SyncRun, syncAge } from './SyncStatus';
import { useWallets } from './useWallets';
import { AddressRow, holdingsOf, ReconcileNote, subtitle } from './WalletParts';
import { isBitcoin, reconcile } from './wallets';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import '../transactions/transactions.css';
import './wallets.css';

const SHOWN_OPERATIONS = 10;

type OperationsState = OperationList | 'loading' | 'failed';

/** What happened in the account, newest first: its own rows, transfers in and chain rows. */
export function accountOperations(operations: readonly Operation[], accountId: string) {
  return operations
    .filter(
      (operation) =>
        operation.account?.id === accountId || operation.counterAccount?.id === accountId,
    )
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.orderWithinTimestamp - left.orderWithinTimestamp,
    );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="portfolio-stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
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
  if (!worst) return <span className="wallets-muted">Tracked by hand</span>;
  const when = syncAge(worst, runs[worst.id]);
  return (
    <span className="wallets-status">
      <SyncBadge address={worst} run={runs[worst.id]} />
      {when && <span className="wallets-muted">{when}</span>}
    </span>
  );
}

function WalletTransactions({
  accountId,
  operations,
  onRetry,
}: {
  accountId: string;
  operations: OperationsState;
  onRetry: () => void;
}) {
  const own =
    typeof operations === 'object' ? accountOperations(operations.operations, accountId) : [];
  return (
    <section className="shell-card" aria-labelledby="wallet-transactions">
      <div className="portfolio-toolbar">
        <h2 id="wallet-transactions">Transactions</h2>
        {typeof operations === 'object' && <span className="portfolio-sub">{own.length}</span>}
      </div>
      {operations === 'failed' ? (
        <div className="portfolio-state" role="alert">
          <p>Could not load this wallet's transactions.</p>
          <button type="button" className="shell-button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : operations === 'loading' ? (
        <p className="portfolio-none" role="status">
          Loading transactions…
        </p>
      ) : own.length === 0 ? (
        <p className="portfolio-none">No transactions yet.</p>
      ) : (
        <>
          <ul className="portfolio-holdings portfolio-operations">
            {own.slice(0, SHOWN_OPERATIONS).map((operation) => (
              <li key={operation.id}>
                <span>
                  {operation.status === 'needs-classification' ? (
                    <span className="portfolio-pill">{statusLabels[operation.status]}</span>
                  ) : (
                    typeLabel(operation)
                  )}
                  <span className="portfolio-sub">
                    {day(operation.occurredAt)}
                    {operation.counterAccount
                      ? ` · ${operation.account?.name ?? ''} → ${operation.counterAccount.name}`
                      : ''}
                  </span>
                </span>
                <span className="portfolio-num">
                  {signedAmount(operation)}
                  {operation.value !== null && typeof operations === 'object' && (
                    <span className="portfolio-sub">
                      {money(operation.value, operations.quoteCurrency)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Link
            className="portfolio-link portfolio-operations__all"
            to={`/transactions?account=${encodeURIComponent(accountId)}`}
          >
            {own.length > SHOWN_OPERATIONS ? `Show all ${own.length}` : 'Open in Transactions'}
          </Link>
        </>
      )}
    </section>
  );
}

// One wallet (account): its value, addresses, assets and transactions (prototype "wallet").
export default function WalletPage() {
  const { accountId = '' } = useParams();
  const { portfolio, addresses, failed, load, replace, runs, sync, asked } = useWallets();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const narrow = useNarrowScreen();

  const [operations, setOperations] = useState<OperationsState>('loading');
  const latestOperations = useRef(0);
  const loadOperations = useCallback(async () => {
    const request = ++latestOperations.current;
    setOperations('loading');
    try {
      const list = await operationsApi.list(asked);
      if (request === latestOperations.current) setOperations(list);
    } catch {
      if (request === latestOperations.current) setOperations('failed');
    }
  }, [asked]);
  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  const account = portfolio?.accounts.find((item) => item.accountId === accountId);
  const accounts: WalletAccount[] = (portfolio?.accounts ?? []).map(({ accountId: id, name }) => ({
    accountId: id,
    name,
  }));
  const list = addresses ?? [];
  const own = list.filter((address) => address.accountId === accountId);
  const currency = portfolio?.currency ?? 'USD';
  const btcPrice = portfolio?.assets.find(isBitcoin)?.price?.value ?? null;
  const holdings = portfolio ? holdingsOf(portfolio, accountId) : [];
  const total = account?.pricedValue ?? null;
  const open = list.find((address) => address.id === openId);
  const syncing = own.some((address) => runs[address.id]?.state === 'running');
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
      <PageHeader
        title={account?.name ?? 'Wallet'}
        currency={portfolio?.currency}
        onTransactionSaved={refresh}
      />
      <div className="portfolio-crumbs">
        <Link className="portfolio-crumb" to={withCurrency('/wallets', asked)}>
          ← Wallets
        </Link>
      </div>
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load this wallet. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null || addresses === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading wallet…
        </section>
      ) : !account ? (
        <section className="shell-card shell-empty" aria-labelledby="wallet-missing">
          <h2 id="wallet-missing">Wallet not found</h2>
          <p>It may belong to another owner or the link is wrong.</p>
          <Link className="shell-button" to={withCurrency('/wallets', asked)}>
            Open Wallets
          </Link>
        </section>
      ) : (
        <>
          <div className="portfolio-head">
            <span className="wallets-card__icon wallets-card__icon--lg" aria-hidden="true">
              <Icon name="wallets" />
            </span>
            <div className="portfolio-head__title">
              <h2>{account.name}</h2>
              <span className="portfolio-sub">{subtitle(own)}</span>
            </div>
            <div className="wallets-actions">
              <button
                type="button"
                className="shell-button shell-button--ghost"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
              {own.length > 0 && (
                <button
                  type="button"
                  className="shell-button shell-button--secondary"
                  disabled={syncing}
                  onClick={() => void syncAll()}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
              )}
            </div>
          </div>
          <section className="shell-card wallet-overview" aria-label="Summary">
            <dl className="portfolio-stats">
              <Stat label="Total value">{money(total, currency)}</Stat>
              <Stat label="Assets">{holdings.length}</Stat>
              <Stat label="Tracked addresses">{own.length || 'None'}</Stat>
              <Stat label="Last sync">
                <LastSync addresses={own} runs={runs} />
              </Stat>
            </dl>
            <ReconcileNote result={reconcile(list, portfolio, accountId)} />
          </section>
          {own.length > 0 && (
            <section className="shell-card wallets-card" aria-labelledby="wallet-addresses">
              <div className="portfolio-toolbar wallets-card__toolbar">
                <h2 id="wallet-addresses">Addresses</h2>
                <button
                  type="button"
                  className="shell-button shell-button--ghost"
                  onClick={() => setAdding(true)}
                >
                  <Icon name="plus" className="shell-icon shell-icon--sm" />
                  Add address
                </button>
              </div>
              <ul className="wallets-sources">
                {own.map((address) => (
                  <AddressRow
                    key={address.id}
                    address={address}
                    run={runs[address.id]}
                    narrow={narrow}
                    btcPrice={btcPrice}
                    currency={currency}
                    onOpen={() => setOpenId(address.id)}
                    onSync={() => void sync(address.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          <div className="portfolio-split">
            <section className="shell-card" aria-labelledby="wallet-assets">
              <div className="portfolio-toolbar">
                <h2 id="wallet-assets">Assets</h2>
              </div>
              {holdings.length === 0 ? (
                <p className="portfolio-none">No assets in this wallet.</p>
              ) : (
                <ul className="portfolio-holdings">
                  {holdings.map((holding) => (
                    <li key={holding.asset.instrumentId}>
                      <Link
                        className="wallets-asset"
                        to={withCurrency(`/portfolio/${holding.asset.instrumentId}`, asked)}
                      >
                        <AssetIcon
                          symbol={holding.asset.symbol}
                          name={holding.asset.name}
                          assetType={holding.asset.assetType}
                          size="sm"
                        />
                        <span>
                          {holding.asset.name}
                          <span className="portfolio-sub">
                            {quantity(holding.quantity)} {holding.asset.symbol ?? ''}
                          </span>
                        </span>
                      </Link>
                      <span className="portfolio-num">
                        {holding.value === null ? DASH : money(holding.value, currency)}
                        {holding.value !== null && total !== null && Number(total) > 0 && (
                          <span className="portfolio-sub">
                            {((Number(holding.value) / Number(total)) * 100).toFixed(1)}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <WalletTransactions
              accountId={accountId}
              operations={operations}
              onRetry={() => void loadOperations()}
            />
          </div>
          {own.length === 0 && (
            <section className="shell-card">
              <p className="wallets-soft">
                {account.name} is tracked by hand: balances come from the transactions you add.{' '}
                <button type="button" className="portfolio-link" onClick={() => setAdding(true)}>
                  Add a Bitcoin address
                </button>{' '}
                to compare them with the blockchain.
              </p>
            </section>
          )}
        </>
      )}
      {adding && account && (
        <AddWalletDialog
          accounts={accounts}
          addresses={list}
          wallet={account.name}
          onClose={() => setAdding(false)}
          onOpenExisting={(address) => {
            setAdding(false);
            setOpenId(address.id);
          }}
          onAdded={(address, created) => {
            setAdding(false);
            replace(address);
            void load(true);
            if (created) void sync(address.id).then(() => void loadOperations());
            else setOpenId(address.id);
          }}
        />
      )}
      {renaming && account && (
        <RenameWalletDialog
          accountId={account.accountId}
          name={account.name}
          onClose={() => setRenaming(false)}
          onRenamed={() => {
            setRenaming(false);
            refresh();
          }}
        />
      )}
      {open && portfolio && (
        <AddressDrawer
          key={open.id}
          address={open}
          accounts={accounts}
          currency={currency}
          btcPrice={btcPrice}
          run={runs[open.id]}
          onSync={() => void sync(open.id)}
          onSaved={(address, newAccount) => {
            replace(address);
            if (newAccount || address.accountId !== accountId) refresh();
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

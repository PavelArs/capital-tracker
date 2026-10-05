import {
  type AccountingCurrency,
  type AssetValuation,
  type PortfolioValuation,
  portfolioValuationApi,
} from '@api/portfolio-valuation.api';
import { announceSyncChange } from '@api/sync-status.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAskedCurrency } from '../portfolio/currency';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { Icon } from '../shell/icons';
import PageHeader from '../shell/PageHeader';
import { useNarrowScreen } from '../transactions/useNarrowScreen';
import AddressDrawer from './AddressDrawer';
import AddWalletDialog, { type WalletAccount } from './AddWalletDialog';
import {
  failureMessages,
  SyncBadge,
  type SyncRun,
  syncAge,
  syncBadge,
  syncProblem,
} from './SyncStatus';
import { isBitcoin, type Reconciliation, reconcile, shortAddress, sum } from './wallets';
import '../shell/shell-page.css';
import '../portfolio/portfolio.css';
import '../transactions/transactions.css';
import './wallets.css';

// One sync request reads at most ten provider pages; a long history needs several requests.
const MAX_SYNC_REQUESTS = 40;
// While the background job loads a history, the page looks again this often.
const BACKGROUND_REFRESH_MS = 10_000;

interface Holding {
  asset: AssetValuation;
  quantity: string;
  value: string | null;
}

function holdingsOf(portfolio: PortfolioValuation, accountId: string): Holding[] {
  return portfolio.assets.flatMap((asset) =>
    asset.holdings
      .filter((holding) => holding.accountId === accountId && Number(holding.quantity) !== 0)
      .map((holding) => ({ asset, quantity: holding.quantity, value: holding.value })),
  );
}

const ticker = (asset: AssetValuation) => asset.symbol ?? asset.name;

function addressValue(
  address: WalletAddress,
  btcPrice: string | null,
  currency: AccountingCurrency,
): string {
  // Display only: the exact chain balance is the BTC amount next to it.
  if (address.chainBalance === null || btcPrice === null) return DASH;
  return money(String(Number(address.chainBalance) * Number(btcPrice)), currency);
}

function AddressRow({
  address,
  run,
  narrow,
  btcPrice,
  currency,
  onOpen,
  onSync,
}: {
  address: WalletAddress;
  run: SyncRun | undefined;
  narrow: boolean;
  btcPrice: string | null;
  currency: AccountingCurrency;
  onOpen: () => void;
  onSync: () => void;
}) {
  const name = address.label ?? 'Bitcoin';
  const amount = address.chainBalance === null ? DASH : `${quantity(address.chainBalance)} BTC`;
  const when = syncAge(address, run);
  const problem = syncProblem(address, run);
  const loading =
    address.sync.state !== 'complete' &&
    (run?.state === 'running' || (run === undefined && address.sync.status === 'syncing'));
  const message = loading ? (
    <div className="wallets-message">
      Loading the transaction history. A long history takes a few minutes; it keeps loading in the
      background, so you can leave this page.
    </div>
  ) : problem ? (
    <div className="wallets-message wallets-message--error">
      <span>{problem}</span>
      <button type="button" className="shell-button shell-button--secondary" onClick={onSync}>
        Retry now
      </button>
    </div>
  ) : run === undefined && address.sync.state !== 'complete' ? (
    <div className="wallets-message">
      <span>
        {address.sync.state === 'partial'
          ? 'Part of the history is loaded; the balance appears when the rest is.'
          : 'The transaction history is not loaded yet.'}
      </span>
      <button type="button" className="shell-button shell-button--secondary" onClick={onSync}>
        {address.sync.state === 'partial' ? 'Continue loading' : 'Load history'}
      </button>
    </div>
  ) : null;
  const label = `${name} ${address.address}`;
  if (narrow) {
    return (
      <li className="wallets-source">
        <button type="button" className="transactions-item" aria-label={label} onClick={onOpen}>
          <AssetIcon symbol="BTC" name="Bitcoin" assetType="crypto" />
          <span className="transactions-item__main">
            <span className="transactions-item__title">{name}</span>
            <span className="transactions-item__detail">
              {shortAddress(address.address)} · {syncBadge(address, run).label}
            </span>
          </span>
          <span className="transactions-item__side">
            <span className="transactions-item__amount">{amount}</span>
            <span className="transactions-item__value">
              {addressValue(address, btcPrice, currency)}
            </span>
          </span>
        </button>
        {message}
      </li>
    );
  }
  return (
    <li className="wallets-source">
      <button type="button" className="wallets-source__open" aria-label={label} onClick={onOpen}>
        <span className="wallets-asset">
          <AssetIcon symbol="BTC" name="Bitcoin" assetType="crypto" size="sm" />
          <span className="wallets-asset__name">{name}</span>
        </span>
        <span className="wallets-mono wallets-soft">{shortAddress(address.address)}</span>
        <span className="wallets-num">{amount}</span>
        <span className="wallets-num wallets-right">
          {addressValue(address, btcPrice, currency)}
        </span>
        <span className="wallets-right wallets-status">
          <SyncBadge address={address} run={run} />
          {when && <span className="wallets-muted">{when}</span>}
        </span>
      </button>
      {message}
    </li>
  );
}

function ManualRow({
  holdings,
  currency,
  narrow,
}: {
  holdings: Holding[];
  currency: AccountingCurrency;
  narrow: boolean;
}) {
  const names = holdings.map((holding) => ticker(holding.asset)).join(', ');
  // Each coin is one unbreakable piece, so a long list wraps between coins inside its column.
  const amounts = holdings.flatMap((holding, index) => [
    index ? ' ' : null,
    <span key={holding.asset.instrumentId} className="wallets-num">
      {quantity(holding.quantity)} {ticker(holding.asset)}
      {index < holdings.length - 1 && ' ·'}
    </span>,
  ]);
  const known = holdings.flatMap((holding) => (holding.value === null ? [] : [holding.value]));
  const value = known.length ? money(sum(known), currency) : DASH;
  const icons = (
    <span className="wallets-icons" aria-hidden="true">
      {holdings.slice(0, 4).map((holding) => (
        <AssetIcon
          key={holding.asset.instrumentId}
          symbol={holding.asset.symbol}
          name={holding.asset.name}
          assetType={holding.asset.assetType}
          size="sm"
        />
      ))}
    </span>
  );
  if (narrow) {
    return (
      <li className="wallets-source wallets-source--manual">
        <div className="transactions-item">
          {icons}
          <span className="transactions-item__main">
            <span className="transactions-item__title">{names}</span>
            <span className="transactions-item__detail">Tracked by hand</span>
          </span>
          <span className="transactions-item__side">
            <span className="transactions-item__amount">{value}</span>
          </span>
        </div>
      </li>
    );
  }
  return (
    <li className="wallets-source wallets-source--manual">
      <div className="wallets-source__open">
        {icons}
        <span>{names} tracked by hand</span>
        <span className="wallets-amounts">{amounts}</span>
        <span className="wallets-num wallets-right">{value}</span>
        <span className="wallets-right wallets-muted">From your transactions</span>
      </div>
    </li>
  );
}

function ReconcileNote({ result }: { result: Reconciliation }) {
  if (result.state !== 'differs') return null;
  const difference = result.difference.replace(/^-/, '');
  return (
    <p className="wallets-message wallets-message--warn" role="note">
      Balance differs by {quantity(difference)} BTC. The blockchain shows {quantity(result.chain)}{' '}
      BTC; your transactions in this wallet give {quantity(result.recorded)} BTC. Add the missing
      transactions or check that every address belongs here.
    </p>
  );
}

function subtitle(addresses: WalletAddress[]): string {
  if (addresses.length === 0) return 'Tracked by hand';
  return addresses.length === 1 ? 'Bitcoin · 1 address' : `Bitcoin · ${addresses.length} addresses`;
}

// Wallets grouped the way the owner holds them (prototype "Wallets", M10): each account with
// its tracked addresses, the coins entered by hand, and whether the chain agrees.
export default function WalletsPage() {
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [addresses, setAddresses] = useState<WalletAddress[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, SyncRun>>({});
  const [asked] = useAskedCurrency();
  const narrow = useNarrowScreen();
  const latest = useRef(0);
  const running = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Only the newest request may change the page; a quiet refresh keeps what is shown.
  const load = useCallback(
    async (quiet = false) => {
      const request = ++latest.current;
      setFailed(false);
      if (!quiet) setPortfolio(null);
      try {
        const [nextPortfolio, nextAddresses] = await Promise.all([
          portfolioValuationApi.get(asked),
          walletAddressesApi.list(),
        ]);
        if (request !== latest.current) return;
        setPortfolio(nextPortfolio);
        setAddresses(nextAddresses);
      } catch {
        if (request === latest.current && !quiet) setFailed(true);
      }
    },
    [asked],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((address: WalletAddress) => {
    setAddresses((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === address.id)
        ? list.map((item) => (item.id === address.id ? address : item))
        : [...list, address];
    });
  }, []);
  const setRun = useCallback((id: string, run: SyncRun | null) => {
    setRuns((current) => {
      const next = { ...current };
      if (run) next[id] = run;
      else delete next[id];
      return next;
    });
  }, []);

  // "Sync now": loads the history in bounded requests until it is complete or the source fails.
  // The background job (M11) does the same every hour without the page.
  const sync = useCallback(
    async (id: string) => {
      if (running.current.has(id)) return;
      running.current.add(id);
      setRun(id, { state: 'running' });
      try {
        for (let request = 0; request < MAX_SYNC_REQUESTS; request++) {
          const result = await walletAddressesApi.sync(id);
          if (!mounted.current) return;
          replace(result.address);
          if (result.outcome === 'provider_error') {
            setRun(id, {
              state: 'failed',
              message:
                result.address.sync.errorMessage ?? failureMessages[result.reason ?? 'unavailable'],
            });
            return;
          }
          if (result.outcome === 'complete') break;
        }
        setRun(id, null);
        // A list asked for while the history loaded may be older than the last page.
        void load(true);
        announceSyncChange();
      } catch (error) {
        if (!mounted.current) return;
        const status = isAxiosError(error) ? error.response?.status : undefined;
        setRun(id, {
          state: 'failed',
          message: failureMessages[status === 409 ? 'busy' : 'server'],
        });
      } finally {
        announceSyncChange();
        running.current.delete(id);
      }
    },
    [load, replace, setRun],
  );

  // The background job is loading a history: show its progress without a reload.
  const backgroundSyncing =
    addresses?.some((address) => address.sync.status === 'syncing' && !runs[address.id]) ?? false;
  useEffect(() => {
    if (!backgroundSyncing) return;
    const timer = window.setInterval(() => void load(true), BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [backgroundSyncing, load]);

  const accounts: WalletAccount[] = (portfolio?.accounts ?? []).map(({ accountId, name }) => ({
    accountId,
    name,
  }));
  const list = addresses ?? [];
  const currency = portfolio?.currency ?? 'USD';
  const btcPrice = portfolio?.assets.find(isBitcoin)?.price?.value ?? null;
  const open = list.find((address) => address.id === openId);
  const unassigned = list.filter(
    (address) => !address.accountId || !accounts.some((a) => a.accountId === address.accountId),
  );
  const cards = portfolio
    ? portfolio.accounts
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

  const addButton = (
    <button
      type="button"
      className="shell-button shell-button--primary"
      onClick={() => setAdding(true)}
    >
      <Icon name="plus" className="shell-icon shell-icon--sm" />
      Add wallet
    </button>
  );
  const rows = (items: WalletAddress[]) =>
    items.map((address) => (
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
    ));

  return (
    <div className="shell-page">
      <PageHeader
        title="Wallets"
        currency={portfolio?.currency}
        onTransactionSaved={() => void load(true)}
      />
      {failed ? (
        <section className="shell-card portfolio-state" role="alert">
          <p>Could not load your wallets. Your data is safe; try again.</p>
          <button type="button" className="shell-button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      ) : portfolio === null || addresses === null ? (
        <section className="shell-card portfolio-state" role="status">
          Loading wallets…
        </section>
      ) : cards.length === 0 && list.length === 0 ? (
        <section className="shell-card shell-empty" aria-labelledby="wallets-empty">
          <span className="shell-empty__ill" aria-hidden="true">
            <Icon name="wallets" />
          </span>
          <h2 id="wallets-empty">No wallets connected</h2>
          <p>
            Add a Bitcoin address. The app only reads public data and never asks for a seed phrase.
          </p>
          {addButton}
        </section>
      ) : (
        <>
          <div className="wallets-intro">
            <p className="wallets-soft">
              Wallets are read-only. The app stores only public addresses; it never asks for a seed
              phrase or a private key.
            </p>
            {addButton}
          </div>
          {unassigned.length > 0 && (
            <section className="shell-card wallets-card" aria-labelledby="wallets-unassigned">
              <div className="wallets-card__head">
                <span className="wallets-card__icon" aria-hidden="true">
                  <Icon name="wallets" />
                </span>
                <div className="wallets-card__title">
                  <h2 id="wallets-unassigned">Not in a wallet yet</h2>
                  <span>Open an address and choose the wallet it belongs to.</span>
                </div>
              </div>
              <ul className="wallets-sources">{rows(unassigned)}</ul>
            </section>
          )}
          {cards.map(({ account, addresses: own, holdings }) => {
            const manual = own.length
              ? holdings.filter((holding) => !isBitcoin(holding.asset))
              : holdings;
            const headingId = `wallet-${account.accountId}`;
            return (
              <section
                key={account.accountId}
                className="shell-card wallets-card"
                aria-labelledby={headingId}
              >
                <div className="wallets-card__head">
                  <span className="wallets-card__icon" aria-hidden="true">
                    <Icon name="wallets" />
                  </span>
                  <div className="wallets-card__title">
                    <h2 id={headingId}>{account.name}</h2>
                    <span>{subtitle(own)}</span>
                  </div>
                  <div className="wallets-card__total">
                    <strong>{money(account.pricedValue, currency)}</strong>
                    <span>{holdings.length === 1 ? '1 asset' : `${holdings.length} assets`}</span>
                  </div>
                </div>
                {own.length > 0 || manual.length > 0 ? (
                  <ul className="wallets-sources">
                    {rows(own)}
                    {manual.length > 0 && (
                      <ManualRow holdings={manual} currency={currency} narrow={narrow} />
                    )}
                  </ul>
                ) : (
                  <p className="wallets-empty-row">Nothing in this wallet yet.</p>
                )}
                <ReconcileNote result={reconcile(list, portfolio, account.accountId)} />
              </section>
            );
          })}
        </>
      )}
      {adding && (
        <AddWalletDialog
          accounts={accounts}
          addresses={list}
          onClose={() => setAdding(false)}
          onOpenExisting={(address) => {
            setAdding(false);
            setOpenId(address.id);
          }}
          onAdded={(address, created) => {
            setAdding(false);
            replace(address);
            void load(true);
            if (created) void sync(address.id);
            else setOpenId(address.id);
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
            if (newAccount) void load(true);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

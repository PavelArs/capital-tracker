import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { SyncBadge, type SyncRun, syncAge, syncBadge, syncProblem } from './SyncStatus';
import { type Reconciliation, shortAddress, sum } from './wallets';

// Rows shared by the Wallets list and a wallet's own page (prototype "wallets", srcRow).

export interface Holding {
  asset: AssetValuation;
  quantity: string;
  value: string | null;
}

export function holdingsOf(portfolio: PortfolioValuation, accountId: string): Holding[] {
  return portfolio.assets.flatMap((asset) =>
    asset.holdings
      .filter((holding) => holding.accountId === accountId && Number(holding.quantity) !== 0)
      .map((holding) => ({ asset, quantity: holding.quantity, value: holding.value })),
  );
}

const ticker = (asset: AssetValuation) => asset.symbol ?? asset.name;

export function addressValue(
  address: WalletAddress,
  btcPrice: string | null,
  currency: AccountingCurrency,
): string {
  // Display only: the exact chain balance is the BTC amount next to it.
  if (address.chainBalance === null || btcPrice === null) return DASH;
  return money(String(Number(address.chainBalance) * Number(btcPrice)), currency);
}

export function AddressRow({
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

export function ManualRow({
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

export function ReconcileNote({ result }: { result: Reconciliation }) {
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

export function subtitle(addresses: WalletAddress[]): string {
  if (addresses.length === 0) return 'Tracked by hand';
  return addresses.length === 1 ? 'Bitcoin · 1 address' : `Bitcoin · ${addresses.length} addresses`;
}

import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import type { StakeState, Staking, WalletAddress } from '@api/wallet-addresses.api';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { networkOf, networks } from './networks';
import { SyncBadge, type SyncRun, syncAge, syncBadge, syncProblem } from './SyncStatus';
import { chainBalances, type Reconciliation, shortAddress, sum } from './wallets';

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

/** Latest price of each crypto ticker, in the shown currency. */
export type Prices = ReadonlyMap<string, string>;

export function addressValue(
  address: WalletAddress,
  prices: Prices,
  currency: AccountingCurrency,
): string {
  // Display only: the exact chain balances are the amounts next to it. A held asset without a
  // price leaves the value unknown rather than too low.
  const balances = chainBalances(address);
  if (balances === null) return DASH;
  const held = balances.filter((balance) => Number(balance.quantity) !== 0);
  if (held.some((balance) => !prices.has(balance.symbol))) return DASH;
  const total = held.reduce(
    (value, balance) => value + Number(balance.quantity) * Number(prices.get(balance.symbol)),
    0,
  );
  return money(String(total), currency);
}

/** ["1.5 ETH", "250 USDC"]: the network's coin always, a token when the wallet holds it. */
function chainPieces(address: WalletAddress): string[] {
  const balances = chainBalances(address);
  if (balances === null) return [DASH];
  return balances
    .filter((balance, index) => index === 0 || Number(balance.quantity) !== 0)
    .map((balance) => `${quantity(balance.quantity)} ${balance.symbol}`);
}

/** SOL-STAKE-BALANCE: "14.5 SOL staked", the part of the balance above held in stake accounts. */
function stakedPiece(address: WalletAddress): string | null {
  const staking = address.staking;
  if (!staking || Number(staking.quantity) === 0) return null;
  return `${quantity(staking.quantity)} ${staking.symbol} staked`;
}

const stakeStates: Record<
  StakeState,
  { label: string; tone: 'pos' | 'info' | 'warn' | 'neutral' }
> = {
  activating: { label: 'Activating', tone: 'info' },
  active: { label: 'Active', tone: 'pos' },
  deactivating: { label: 'Unstaking', tone: 'warn' },
  inactive: { label: 'Not staked', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'neutral' },
};

/**
 * SOL-STAKE-BALANCE: a Solana address's stake accounts in its drawer. What each holds is already
 * in the balance above; "available" is the rest.
 */
export function StakingSection({ address, staking }: { address: WalletAddress; staking: Staking }) {
  const own = chainBalances(address)?.find((balance) => balance.symbol === staking.symbol);
  const available = own ? sum([own.quantity, `-${staking.quantity}`]) : null;
  const symbol = staking.symbol;
  return (
    <section aria-labelledby="address-staking">
      <h3 id="address-staking" className="transactions-section">
        Staking
      </h3>
      <dl className="transactions-facts">
        {available !== null && (
          <div>
            <dt>Available</dt>
            <dd className="wallets-num">
              {quantity(available)} {symbol}
            </dd>
          </div>
        )}
        <div>
          <dt>Staked</dt>
          <dd className="wallets-num">
            {quantity(staking.quantity)} {symbol}
          </dd>
        </div>
        <div>
          <dt>Rewards so far</dt>
          <dd className="wallets-num">
            {quantity(staking.rewards)} {symbol}
          </dd>
        </div>
      </dl>
      <ul className="wallets-stake" aria-label="Stake accounts">
        {staking.accounts.map((item) => {
          const state = item.state ? stakeStates[item.state] : null;
          return (
            <li key={item.account}>
              <span className="wallets-stake__main">
                <span className="wallets-mono">{shortAddress(item.account)}</span>
                <span className="wallets-muted">
                  {item.validator
                    ? `Validator ${shortAddress(item.validator)}`
                    : 'Not delegated to a validator'}
                </span>
              </span>
              <span className="wallets-stake__side">
                <span className="wallets-num">
                  {quantity(item.quantity)} {symbol}
                </span>
                {state ? (
                  <span className={`wallets-badge wallets-badge--${state.tone}`}>
                    {state.label}
                  </span>
                ) : (
                  <span className="wallets-muted">Checked on the next sync</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="wallets-muted wallets-stake__note">
        Staked {symbol} stays in this wallet: it counts in the balance and in net worth, and moving
        it into a stake account or back is not a sale. Rewards count as received coins without a
        purchase price, not as deposits.
      </p>
    </section>
  );
}

/** "1.5 ETH · 250 USDC". */
export const chainAmounts = (address: WalletAddress): string => chainPieces(address).join(' · ');

// Each coin is one unbreakable piece: a row wraps between coins, a phone stacks them.
// Staked SOL is already in the SOL amount; a muted line under it says how much.
function ChainAmounts({ address, stacked }: { address: WalletAddress; stacked: boolean }) {
  const pieces = chainPieces(address);
  const staked = stakedPiece(address);
  const note = staked && <span className="wallets-muted wallets-amounts__staked">{staked}</span>;
  if (stacked)
    return (
      <span className="transactions-item__amount wallets-stack">
        {pieces.map((piece) => (
          <span key={piece}>{piece}</span>
        ))}
        {note}
      </span>
    );
  return (
    <span className="wallets-amounts">
      {pieces.flatMap((piece, index) => [
        index ? ' ' : null,
        <span key={piece} className="wallets-num">
          {piece}
          {index < pieces.length - 1 && ' ·'}
        </span>,
      ])}
      {note}
    </span>
  );
}

export function AddressRow({
  address,
  run,
  narrow,
  prices,
  currency,
  onOpen,
  onSync,
}: {
  address: WalletAddress;
  run: SyncRun | undefined;
  narrow: boolean;
  prices: Prices;
  currency: AccountingCurrency;
  onOpen: () => void;
  onSync: () => void;
}) {
  const network = networkOf(address);
  const name = address.label ?? network.name;
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
          <AssetIcon symbol={network.symbol} name={network.name} assetType="crypto" />
          <span className="transactions-item__main">
            <span className="transactions-item__title">{name}</span>
            <span className="transactions-item__detail">
              {shortAddress(address.address)} · {syncBadge(address, run).label}
            </span>
          </span>
          <span className="transactions-item__side">
            <ChainAmounts address={address} stacked />
            <span className="transactions-item__value">
              {addressValue(address, prices, currency)}
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
          <AssetIcon symbol={network.symbol} name={network.name} assetType="crypto" size="sm" />
          <span className="wallets-asset__name">{name}</span>
        </span>
        <span className="wallets-mono wallets-soft">{shortAddress(address.address)}</span>
        <ChainAmounts address={address} stacked={false} />
        <span className="wallets-num wallets-right">{addressValue(address, prices, currency)}</span>
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
  const lines = result.assets.map(({ symbol, chain, recorded, difference }) => {
    const by = quantity(difference.replace(/^-/, ''));
    return `Balance differs by ${by} ${symbol}. The blockchain shows ${quantity(chain)} ${symbol}; your transactions in this wallet give ${quantity(recorded)} ${symbol}.`;
  });
  return (
    <p className="wallets-message wallets-message--warn" role="note">
      {lines.join(' ')} Add the missing transactions or check that every address belongs here.
    </p>
  );
}

export function subtitle(addresses: WalletAddress[]): string {
  if (addresses.length === 0) return 'Tracked by hand';
  const names = (Object.keys(networks) as WalletAddress['network'][])
    .filter((network) => addresses.some((address) => address.network === network))
    .map((network) => networks[network].name)
    .join(', ');
  return addresses.length === 1
    ? `${names} · 1 address`
    : `${names} · ${addresses.length} addresses`;
}

/** Holdings the account's addresses already show from the chain are not listed again. */
export function trackedSymbols(addresses: WalletAddress[]): Set<string> {
  return new Set(addresses.flatMap((address) => networkOf(address).assets));
}

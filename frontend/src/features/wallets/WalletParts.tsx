import type {
  AccountingCurrency,
  AssetValuation,
  PortfolioValuation,
} from '@api/portfolio-valuation.api';
import type {
  ChainBalance,
  EarnHolding,
  ExchangeAccount,
  StakeAccount,
  StakeState,
  Staking,
  WalletAddress,
} from '@api/wallet-addresses.api';
import { walletAddressesApi } from '@api/wallet-addresses.api';
import { useRef, useState } from 'react';
import { newRequestId } from '../accounting/feedback';
import { DASH, money, quantity } from '../portfolio/format';
import AssetIcon from '../shell/AssetIcon';
import { addressAssets, networkIcon, networkOf, networks } from './networks';
import { SyncBadge, type SyncRun, syncAge, syncBadge, syncProblem } from './SyncStatus';
import { chainBalances, keyAddresses, type Reconciliation, shortAddress, sum } from './wallets';

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
  // Display only: the exact chain balances are the amounts next to it. The priced coins add up;
  // a held coin without a price is counted aloud ("+ 1 unpriced") instead of zeroing the rest.
  const balances = chainBalances(address);
  if (balances === null) return DASH;
  const held = balances.filter((balance) => Number(balance.quantity) !== 0);
  const priced = held.filter((balance) => prices.has(balance.symbol));
  if (priced.length === 0 && held.length > 0) return DASH;
  const total = priced.reduce(
    (value, balance) => value + Number(balance.quantity) * Number(prices.get(balance.symbol)),
    0,
  );
  const unpriced = held.length - priced.length;
  return `${money(String(total), currency)}${unpriced > 0 ? ` + ${unpriced} unpriced` : ''}`;
}

/**
 * ["1.5 ETH", "250 USDC"]: the network's coin always, a token when the wallet holds it. An
 * exchange account has no coin of its own: the coins it holds, or "0 USDT".
 */
export function chainPieces(address: WalletAddress): string[] {
  const balances = chainBalances(address);
  if (balances === null) return [DASH];
  const network = networkOf(address);
  const held = balances.filter((balance, index) =>
    network.exchange
      ? Number(balance.quantity) !== 0
      : index === 0 || Number(balance.quantity) !== 0,
  );
  const shown = held.length > 0 ? held : [{ symbol: network.symbol, quantity: '0' }];
  return shown.map((balance) => `${quantity(balance.quantity)} ${balance.symbol}`);
}

/**
 * SOL-STAKE-BALANCE, ETH-STAKE-BALANCE: "14.5 SOL staked", the part of the balance above held in
 * stake accounts or staking pools.
 */
function stakedPiece(address: WalletAddress): string | null {
  const staking = address.staking;
  if (!staking || Number(staking.quantity) === 0) return null;
  return `${quantity(staking.quantity)} ${staking.symbol} staked`;
}

/** POOL-DEPOSIT: "1 ETH · 3000 USDC in pools", the part of the balance above in liquidity pools. */
function pooledPiece(address: WalletAddress): string | null {
  const pools = (address.pools ?? []).filter((item) => Number(item.quantity) !== 0);
  if (pools.length === 0) return null;
  return `${pools.map((item) => `${quantity(item.quantity)} ${item.symbol}`).join(' · ')} in pools`;
}

/** BYBIT-EARN: "200 USDT · 0.5 SOL in Earn", the part of a Bybit account's balance in Earn. */
function earnPiece(address: WalletAddress): string | null {
  const coins = earnByCoin(address.exchange?.earn ?? []);
  if (coins.length === 0) return null;
  return `${coins.map((item) => `${quantity(item.quantity)} ${item.symbol}`).join(' · ')} in Earn`;
}

/** One line per coin, the products added up, in Bybit's order. */
function earnByCoin(earn: EarnHolding[]): ChainBalance[] {
  const coins: ChainBalance[] = [];
  for (const item of earn) {
    const known = coins.find((coin) => coin.symbol === item.symbol);
    if (known) known.quantity = sum([known.quantity, item.quantity]);
    else coins.push({ symbol: item.symbol, quantity: item.quantity });
  }
  return coins.filter((item) => Number(item.quantity) !== 0);
}

const earnProducts: Record<EarnHolding['product'], string> = {
  flexible: 'Flexible Savings',
  onchain: 'On-chain Earn',
  fixed: 'Fixed-term savings',
};

/**
 * BYBIT-EARN: the coins a Bybit account holds in Earn, per product, in its drawer; already in
 * the balance above. A key that cannot read Earn says how to let it.
 */
export function EarnSection({ exchange }: { exchange: ExchangeAccount }) {
  if (exchange.earnAllowed === false)
    return (
      <p className="wallets-message wallets-message--warn" role="note">
        This key cannot read Earn, so coins in Bybit Earn are not counted. In Bybit, edit the key,
        tick Earn under Read-Only and press Sync now; no need to add the account again.
      </p>
    );
  const earn = (exchange.earn ?? []).filter((item) => Number(item.quantity) !== 0);
  if (earn.length === 0) return null;
  return (
    <section aria-labelledby="address-earn">
      <h3 id="address-earn" className="transactions-section">
        Earn
      </h3>
      <dl className="transactions-facts">
        {earn.map((item) => (
          <div key={`${item.product}-${item.symbol}`}>
            <dt>{earnProducts[item.product]}</dt>
            <dd className="wallets-num">
              {quantity(item.quantity)} {item.symbol}
            </dd>
          </div>
        ))}
      </dl>
      <p className="wallets-muted wallets-stake__note">
        Coins in Bybit Earn stay yours: they count in this balance and in net worth. Yield Bybit
        paid in the last three months is recorded as staking income by itself; Bybit lists no older
        yield.
      </p>
    </section>
  );
}

/**
 * BYBIT-CONVERT: a key that cannot read convert history says how to let it; coins converted on
 * Bybit are missing from the records until then.
 */
export function ConvertNote({ exchange }: { exchange: ExchangeAccount }) {
  if (exchange.convertAllowed !== false) return null;
  return (
    <p className="wallets-message wallets-message--warn" role="note">
      This key cannot read convert history, so coins converted on Bybit are missing from the
      records. In Bybit, edit the key, tick Exchange History under Read-Only and press Sync now; no
      need to add the account again.
    </p>
  );
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

/** What one stake account or pool is: its validator, or the pool's token. */
function stakeDetail(item: StakeAccount, pools: boolean): string {
  if (pools) return item.pool ? `${item.pool} staking pool` : 'Staking pool';
  return item.validator
    ? `Validator ${shortAddress(item.validator)}`
    : 'Not delegated to a validator';
}

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** TRON-STAKE-STATE: staked TRX has no account of its own; the row names what it is for. */
function tronStake(item: StakeAccount): { name: string; detail: string } {
  if (item.kind === 'energy')
    return { name: 'Staked for energy', detail: 'Energy pays for token transfers' };
  if (item.kind === 'bandwidth')
    return { name: 'Staked for bandwidth', detail: 'Bandwidth pays for plain transfers' };
  if (item.kind === 'unstaking')
    return {
      name: 'Unstaking',
      detail: item.availableAt
        ? `Back to the balance on ${dayFormat.format(new Date(item.availableAt))}`
        : 'Back to the balance after 14 days',
    };
  return { name: 'Staked TRX', detail: 'Split by resource after the next sync' };
}

/**
 * TRON-STAKE-STATE: the chain reports a different TRX total than the transactions explain, as
 * when TRX arrived in a way TronGrid does not list. The balance keeps the transactions.
 */
export function ReportedBalanceNote({ address }: { address: WalletAddress }) {
  const reported = address.reportedBalance;
  if (!reported || address.chainBalance === null) return null;
  const symbol = networkOf(address).symbol;
  const missing = sum([reported, `-${address.chainBalance}`]);
  const more = !missing.startsWith('-');
  return (
    <p className="wallets-message wallets-message--warn">
      Tron reports {quantity(reported)} {symbol} at this address, staked included; its transactions
      explain {quantity(address.chainBalance)} {symbol}.{' '}
      {more
        ? `${quantity(missing)} ${symbol} arrived in transfers TronGrid does not list, such as a payout made by a contract, so they are not in the balance or net worth.`
        : `${quantity(missing.slice(1))} ${symbol} left in transfers TronGrid does not list, so the balance and net worth still count them.`}
    </p>
  );
}

/**
 * SOL-STAKE-BALANCE, ETH-STAKE-BALANCE, TRON-STAKE-BALANCE: a Solana address's stake accounts,
 * an Ethereum address's staking pools, or a Tron address's staked TRX, in its drawer. What each holds is already in the balance above;
 * "available" is the rest.
 */
export function StakingSection({ address, staking }: { address: WalletAddress; staking: Staking }) {
  const own = chainBalances(address)?.find((balance) => balance.symbol === staking.symbol);
  const available = own ? sum([own.quantity, `-${staking.quantity}`]) : null;
  const symbol = staking.symbol;
  const pools = address.network === 'ethereum';
  const tron = address.network === 'tron';
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
          <dt>{tron ? 'Rewards claimed' : 'Rewards so far'}</dt>
          <dd className="wallets-num">
            {quantity(staking.rewards)} {symbol}
          </dd>
        </div>
        {staking.unclaimedRewards && (
          <div>
            <dt>Not claimed yet</dt>
            <dd className="wallets-num">
              {quantity(staking.unclaimedRewards)} {symbol}
            </dd>
          </div>
        )}
      </dl>
      <ul
        className="wallets-stake"
        aria-label={tron ? 'Staked TRX' : pools ? 'Staking pools' : 'Stake accounts'}
      >
        {staking.accounts.map((item) => {
          const state = item.state ? stakeStates[item.state] : null;
          const resource = tron ? tronStake(item) : null;
          return (
            <li key={item.account}>
              <span className="wallets-stake__main">
                {resource ? (
                  <span>{resource.name}</span>
                ) : (
                  <span className="wallets-mono">{shortAddress(item.account)}</span>
                )}
                <span className="wallets-muted">
                  {resource ? resource.detail : stakeDetail(item, pools)}
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
      {staking.reportedQuantity && (
        <p className="wallets-muted wallets-stake__note">
          Tron reports {quantity(staking.reportedQuantity)} {symbol} staked; the wallet's
          transactions explain {quantity(staking.quantity)} {symbol}. The balance follows the
          transactions.
        </p>
      )}
      {tron ? (
        <p className="wallets-muted wallets-stake__note">
          Staked {symbol} stays in this wallet: it counts in the balance and in net worth, and
          staking or unstaking is not a sale. Energy and bandwidth are not assets. Claimed vote
          rewards are recorded as Staking reward income; rewards not claimed yet are not counted.
        </p>
      ) : (
        <p className="wallets-muted wallets-stake__note">
          Staked {symbol} stays in this wallet: it counts in the balance and in net worth, and
          moving it into a {pools ? 'staking pool' : 'stake account'} or back is not a sale. Rewards
          count as received coins without a purchase price, not as deposits.
        </p>
      )}
    </section>
  );
}

/**
 * POOL-DEPOSIT: what the address has in liquidity pools, in its drawer. It is already in the
 * balance above, by the transactions classified as Pool deposit and not yet withdrawn.
 */
export function PoolsSection({ pools }: { pools: ChainBalance[] }) {
  return (
    <section aria-labelledby="address-pools">
      <h3 id="address-pools" className="transactions-section">
        Liquidity pools
      </h3>
      <dl className="transactions-facts">
        {pools.map((item) => (
          <div key={item.symbol}>
            <dt>In pools</dt>
            <dd className="wallets-num">
              {quantity(item.quantity)} {item.symbol}
            </dd>
          </div>
        ))}
      </dl>
      <p className="wallets-muted wallets-stake__note">
        Coins you put into a liquidity pool stay yours: they count in this balance and in net worth
        with their purchase price until a pool withdrawal returns them. What comes back above the
        deposit is pool income; less is a loss.
      </p>
    </section>
  );
}

// TOKEN-SHOW-MORE: an address lists this many coins; the rest wait behind "Show N more".
export const SHOWN_COINS = 2;

/** "Show 3 more" / "Show less" under a list of coins, and how many tokens the address hides. */
export function MoreCoins({
  total,
  expanded,
  hidden,
  onToggle,
}: {
  total: number;
  expanded: boolean;
  hidden: number;
  onToggle: () => void;
}) {
  const extra = total - SHOWN_COINS;
  if (extra <= 0 && hidden === 0) return null;
  return (
    <div className="wallets-more">
      {extra > 0 && (
        <button
          type="button"
          className="portfolio-link"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? 'Show less' : `Show ${extra} more`}
        </button>
      )}
      {hidden > 0 && (
        <span className="wallets-muted">
          {hidden} hidden {hidden === 1 ? 'token' : 'tokens'}
        </span>
      )}
    </div>
  );
}

// Each coin is one unbreakable piece: a row wraps between coins, a phone stacks them.
// Staked SOL and coins in liquidity pools are already in the amounts; muted lines under them
// say how much.
function ChainAmounts({
  address,
  stacked,
  expanded,
}: {
  address: WalletAddress;
  stacked: boolean;
  expanded: boolean;
}) {
  const all = chainPieces(address);
  const pieces = expanded ? all : all.slice(0, SHOWN_COINS);
  const notes = [stakedPiece(address), pooledPiece(address), earnPiece(address)].filter(
    (piece): piece is string => piece !== null,
  );
  const note =
    notes.length > 0 &&
    notes.map((piece) => (
      <span key={piece} className="wallets-muted wallets-amounts__staked">
        {piece}
      </span>
    ));
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
  const [expanded, setExpanded] = useState(false);
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
  const more = (
    <MoreCoins
      total={chainPieces(address).length}
      expanded={expanded}
      hidden={address.hiddenTokens?.length ?? 0}
      onToggle={() => setExpanded((current) => !current)}
    />
  );
  // M21: an account key stands for many addresses; the row says how many were used.
  const derived = keyAddresses(address);
  if (narrow) {
    return (
      <li className="wallets-source">
        <button type="button" className="transactions-item" aria-label={label} onClick={onOpen}>
          <AssetIcon {...networkIcon(network)} />
          <span className="transactions-item__main">
            <span className="transactions-item__title">{name}</span>
            <span className="transactions-item__detail">
              {derived ?? place(address)} · {syncBadge(address, run).label}
            </span>
          </span>
          <span className="transactions-item__side">
            <ChainAmounts address={address} stacked expanded={expanded} />
            <span className="transactions-item__value">
              {addressValue(address, prices, currency)}
            </span>
          </span>
        </button>
        {more}
        {message}
      </li>
    );
  }
  return (
    <li className="wallets-source">
      <button type="button" className="wallets-source__open" aria-label={label} onClick={onOpen}>
        <span className="wallets-asset">
          <AssetIcon {...networkIcon(network)} size="sm" />
          <span className="wallets-asset__text">
            <span className="wallets-asset__name">{name}</span>
            {derived && <span className="portfolio-sub">{derived}</span>}
          </span>
        </span>
        <span className="wallets-mono wallets-soft">{place(address)}</span>
        <ChainAmounts address={address} stacked={false} expanded={expanded} />
        <span className="wallets-num wallets-right">{addressValue(address, prices, currency)}</span>
        <span className="wallets-right wallets-status">
          <SyncBadge address={address} run={run} />
          {when && <span className="wallets-muted">{when}</span>}
        </span>
      </button>
      {more}
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

export function ReconcileNote({
  result,
  target = null,
  onCounted,
}: {
  result: Reconciliation;
  /** The Bybit account whose difference can be counted (BYBIT-COUNT-GAP); null for any other. */
  target?: WalletAddress | null;
  onCounted?: () => void;
}) {
  const [counting, setCounting] = useState(false);
  const [failed, setFailed] = useState(false);
  // One request id per coin and difference, kept for a retry after a lost answer.
  const attempts = useRef(new Map<string, string>());
  if (result.state !== 'differs') return null;
  const lines = result.assets.map(({ symbol, chain, recorded, difference, exchange }) => {
    const by = quantity(difference.replace(/^-/, ''));
    const source = exchange ? 'Bybit reports' : 'The blockchain shows';
    return `Balance differs by ${by} ${symbol}. ${source} ${quantity(chain)} ${symbol}; your transactions in this wallet give ${quantity(recorded)} ${symbol}.`;
  });
  // BYBIT-GAPS: what the API never lists, such as P2P purchases, is entered by hand.
  const advice = result.assets.every((item) => item.exchange)
    ? 'Add what Bybit does not report, such as P2P purchases or Earn yield older than three months, as transactions by hand.'
    : 'Add the missing transactions or check that every address belongs here.';
  const countable = target && result.assets.every((item) => item.exchange);
  const count = async () => {
    if (!target) return;
    setCounting(true);
    setFailed(false);
    try {
      for (const { symbol, chain, difference } of result.assets) {
        const key = `${symbol}:${difference}`;
        const requestId = attempts.current.get(key) ?? newRequestId();
        attempts.current.set(key, requestId);
        await walletAddressesApi.countGap(target.id, {
          requestId,
          coin: symbol,
          direction: difference.startsWith('-') ? 'out' : 'in',
          quantity: difference.replace(/^-/, ''),
          reported: chain,
        });
        attempts.current.delete(key);
      }
      onCounted?.();
    } catch {
      setFailed(true);
      onCounted?.();
    } finally {
      setCounting(false);
    }
  };
  return (
    <div className="wallets-message wallets-message--warn" role="note">
      <p>
        {lines.join(' ')} {advice}
      </p>
      {countable && (
        <>
          <p>
            Or count the difference now: each coin becomes one record of this account, without a
            purchase price, that you can answer later as a purchase, a deposit or anything else.
          </p>
          <button
            type="button"
            className="shell-button shell-button--secondary"
            disabled={counting}
            onClick={() => void count()}
          >
            {counting ? 'Counting…' : 'Count the difference'}
          </button>
          {failed && (
            <p role="alert">
              Could not count every coin. Bybit may have reported another balance; reload and try
              again.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Where a row's coins are: an address, or a Bybit account by its user ID. */
function place(address: WalletAddress): string {
  return networkOf(address).exchange ? `UID ${address.address}` : shortAddress(address.address);
}

export function subtitle(addresses: WalletAddress[]): string {
  if (addresses.length === 0) return 'Tracked by hand';
  const names = (Object.keys(networks) as WalletAddress['network'][])
    .filter((network) => addresses.some((address) => address.network === network))
    .map((network) => networks[network].name)
    .join(', ');
  if (addresses.every((address) => networkOf(address).exchange))
    return addresses.length === 1
      ? `${names} · 1 account`
      : `${names} · ${addresses.length} accounts`;
  return addresses.length === 1
    ? `${names} · 1 address`
    : `${names} · ${addresses.length} addresses`;
}

/**
 * TOKEN-HIDE: holdings of tokens an address leaves out (spam, dust or hidden by the owner) are
 * not listed again as coins tracked by hand: they are not the owner's own entries.
 */
export function withoutHiddenTokens(holdings: Holding[], addresses: WalletAddress[]): Holding[] {
  const hidden = new Set(
    addresses.flatMap((address) => (address.hiddenTokens ?? []).map((token) => token.symbol)),
  );
  if (hidden.size === 0) return holdings;
  return holdings.filter(
    ({ asset }) =>
      asset.assetType !== 'crypto' || !asset.symbol || !hidden.has(asset.symbol.toUpperCase()),
  );
}

/**
 * TOKEN-HIDE: the tickers of tokens every address that holds them leaves out. Their coins are
 * no assets to pick: tickers are unique per token, so a real coin never matches.
 */
export function hiddenTokenSymbols(addresses: WalletAddress[]): Set<string> {
  const hidden = new Set(
    addresses.flatMap((address) => (address.hiddenTokens ?? []).map((token) => token.symbol)),
  );
  for (const address of addresses)
    for (const balance of address.balances ?? []) hidden.delete(balance.symbol);
  return hidden;
}

/** Holdings the account's addresses already show from the chain are not listed again. */
export function trackedSymbols(addresses: WalletAddress[]): Set<string> {
  return new Set(addresses.flatMap(addressAssets));
}

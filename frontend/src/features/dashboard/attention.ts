import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import type { SyncSource } from '@api/sync-status.api';
import type { WalletAddress } from '@api/wallet-addresses.api';
import { age, quantity } from '../portfolio/format';
import { networkOf } from '../wallets/networks';
import { reconcile } from '../wallets/wallets';

/** What the dashboard knows; null where it could not be read. */
export interface AttentionInput {
  toClassify: number | null;
  sources: SyncSource[] | null;
  wallets: WalletAddress[] | null;
  portfolio: PortfolioValuation | null;
  now: Date;
}

export interface AttentionItem {
  key: string;
  tone: 'warn' | 'neg';
  icon: 'clock' | 'tag' | 'alert' | 'scale';
  title: string;
  detail: string;
  /** A path inside the app, without the currency. */
  action?: { label: string; to: string };
}

export interface Attention {
  items: AttentionItem[];
  /** Every check could run; only then may the dashboard say all is well. */
  checked: boolean;
  /** When prices last updated, while they are fresh. */
  pricesUpdatedAt: string | null;
}

const failing = (state: SyncSource['state']) => state === 'failed' || state === 'delayed';
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** "2 hours old", "3 days old": how long ago the last price arrived. */
function oldness(since: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} old`;
  return `${Math.floor(hours / 24)} days old`;
}

const oldest = (dates: string[]) => [...dates].sort().at(0) ?? null;

// PRC-OUTAGE: the price job failing, or a held asset whose market price is older than two
// hours even when the job has not reported yet.
function pricesItem(input: AttentionInput): AttentionItem | null {
  const source = input.sources?.find((item) => item.kind === 'prices');
  const stale = (input.portfolio?.assets ?? [])
    .filter((asset) => Number(asset.quantity) !== 0 && asset.price?.status === 'stale')
    .flatMap((asset) => (asset.price?.observedAt ? [asset.price.observedAt] : []));
  const down = source !== undefined && failing(source.state);
  if (!down && stale.length === 0) return null;
  const since = down ? source.lastSuccessAt : oldest(stale);
  const reason = sentence(
    (down && source.errorMessage) || 'Market data is temporarily unavailable',
  );
  return {
    key: 'prices',
    tone: 'warn',
    icon: 'clock',
    title: since ? `Prices are ${oldness(since, input.now)}` : 'Prices have not loaded yet',
    detail: since ? `${reason} Values use the last stored prices.` : reason,
  };
}

function ratesItem(input: AttentionInput): AttentionItem | null {
  const source = input.sources?.find((item) => item.kind === 'fx');
  if (!source || !failing(source.state)) return null;
  const reason = sentence(source.errorMessage ?? 'The Bank of Russia did not answer');
  const last = source.lastSuccessAt
    ? ` Last success ${age(source.lastSuccessAt, input.now)}; EUR and RUB use the last stored rate.`
    : '';
  return {
    key: 'fx',
    tone: 'warn',
    icon: 'clock',
    title: 'Bank of Russia rates are not updating',
    detail: `${reason}${last}`,
  };
}

function classifyItem(count: number | null): AttentionItem | null {
  if (!count) return null;
  return {
    key: 'classify',
    tone: 'warn',
    icon: 'tag',
    title:
      count === 1
        ? '1 blockchain transaction needs classification'
        : `${count} blockchain transactions need classification`,
    detail: 'Found by wallet sync',
    action: { label: 'Review', to: '/transactions?status=needs-classification' },
  };
}

const walletPath = (accountId: string | null) => (accountId ? `/wallets/${accountId}` : '/wallets');

// SYNC-ISOLATION: each wallet that failed or waits for its source, with the readable reason.
function walletItems(wallets: readonly WalletAddress[], now: Date): AttentionItem[] {
  return wallets
    .filter((wallet) => failing(wallet.sync.status))
    .map((wallet) => {
      const network = networkOf(wallet);
      const failed = wallet.sync.status === 'failed';
      const reason = sentence(
        wallet.sync.errorMessage ?? `${network.name} data is temporarily unavailable`,
      );
      const last = wallet.sync.lastSuccessAt
        ? `Last success ${age(wallet.sync.lastSuccessAt, now)}.`
        : 'Never synced.';
      return {
        key: `wallet:${wallet.id}`,
        tone: failed ? 'neg' : 'warn',
        icon: 'alert',
        title: `${network.name} wallet sync ${failed ? 'failed' : 'delayed'}`,
        detail: `${wallet.label ?? network.defaultWallet} · ${reason} ${last}`,
        action: { label: 'Open', to: walletPath(wallet.accountId) },
      } satisfies AttentionItem;
    });
}

// SYNC-RECONCILE: an account whose addresses hold other amounts than its transactions say.
function balanceItems(
  wallets: readonly WalletAddress[],
  portfolio: PortfolioValuation,
): AttentionItem[] {
  return portfolio.accounts.flatMap((account) => {
    const result = reconcile(wallets, portfolio, account.accountId);
    if (result.state !== 'differs') return [];
    const detail = result.assets
      .map(({ symbol, difference }) => {
        const amount = `${quantity(difference.replace(/^-/, ''))} ${symbol}`;
        return difference.startsWith('-')
          ? `Your transactions show ${amount} more than the blockchain.`
          : `The blockchain shows ${amount} more than your transactions.`;
      })
      .join(' ');
    return [
      {
        key: `balance:${account.accountId}`,
        tone: 'warn',
        icon: 'scale',
        title: `Balance differs in ${account.name}`,
        detail,
        action: { label: 'Open', to: walletPath(account.accountId) },
      } satisfies AttentionItem,
    ];
  });
}

/**
 * DASH-ATTENTION: everything that needs the owner, most urgent kind first (prototype "Needs
 * your attention"): old prices and rates, transactions to classify, wallets that did not
 * sync and wallets whose balance differs. An empty list collapses to one quiet line.
 */
export function collectAttention(input: AttentionInput): Attention {
  const { sources, wallets, portfolio, now } = input;
  const items = [
    pricesItem(input),
    ratesItem(input),
    classifyItem(input.toClassify),
    ...walletItems(wallets ?? [], now),
    ...(wallets && portfolio ? balanceItems(wallets, portfolio) : []),
  ].filter((item): item is AttentionItem => item !== null);
  const prices = sources?.find((item) => item.kind === 'prices');
  return {
    items,
    checked:
      sources !== null && wallets !== null && portfolio !== null && input.toClassify !== null,
    pricesUpdatedAt:
      prices?.state === 'synced' && !items.some((item) => item.key === 'prices')
        ? prices.lastSuccessAt
        : null,
  };
}

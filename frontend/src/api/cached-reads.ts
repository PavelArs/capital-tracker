import { type AccountSummary, accountingApi } from './accounting.api';
import { type AssetHistory, assetHistoryApi } from './asset-history.api';
import { type AuditHistory, auditHistoryApi } from './audit-history.api';
import { type DepositDetail, type DepositList, depositsApi } from './deposits.api';
import { type FxRatesReport, fxRatesApi } from './fx-rates.api';
import { type Goal, type GoalForecast, type GoalList, goalsApi } from './goals.api';
import { type HiddenAsset, hiddenAssetsApi } from './hidden-assets.api';
import {
  CLASSIFICATION_CHANGED,
  type DuplicateProposals,
  type OperationList,
  operationsApi,
  type TransferProposals,
} from './operations.api';
import { type OwnerSettings, ownerSettingsApi } from './owner-settings.api';
import { type PortfolioHistory, portfolioHistoryApi } from './portfolio-history.api';
import { portfolioValuationApi } from './portfolio-valuation.api';
import {
  forgetReads,
  generationNow,
  recall,
  refreshFailed,
  remember,
  rememberFailure,
} from './read-cache';
import { SYNC_CHANGED, type SyncSource, syncStatusApi } from './sync-status.api';
import { type WalletAddress, walletAddressesApi } from './wallet-addresses.api';

// How long a page opened right after a prefetch takes that answer instead of asking again.
const PREFETCH_USE_MS = 30_000;

// Reads on their way, by key. Callers asking for the same thing meanwhile share one request.
const inFlight = new Map<string, { generation: number; promise: Promise<unknown> }>();

/**
 * A read whose last answer is kept for the session: `last` is what to paint on arrival,
 * `load` asks the server and keeps the answer. The page always loads; the cache only decides
 * what it shows meanwhile. Loads asked while an identical one is on its way (the shell and a
 * page both need the sync status, say) wait for that one answer instead of sending another.
 */
function cachedRead<A extends unknown[], T>(name: string, read: (...args: A) => Promise<T>) {
  // load() and load(undefined) ask the same question.
  const key = (args: A) => {
    const asked = [...args];
    while (asked.length && asked[asked.length - 1] === undefined) asked.pop();
    return `${name}:${JSON.stringify(asked)}`;
  };
  // Answers of prefetch() waiting for the page that was about to open: when, by key.
  const prefetched = new Map<string, number>();
  // Prefetches still on their way that no page has joined yet, each with its own token so an
  // older one settling late cannot take the place of a newer one.
  const unclaimed = new Map<string, object>();
  const ask = (args: A, byPage: boolean): Promise<T> => {
    const id = key(args);
    if (byPage) {
      // A page that joins a prefetch on its way has had its answer.
      unclaimed.delete(id);
      // A page opened right after a prefetch uses its answer once; later loads ask again.
      const warmAt = prefetched.get(id);
      if (warmAt !== undefined) {
        prefetched.delete(id);
        const warm = Date.now() - warmAt < PREFETCH_USE_MS ? recall<T>(id) : undefined;
        if (warm !== undefined && !inFlight.has(id)) return Promise.resolve(warm);
      }
    }
    const startedIn = generationNow();
    const shared = inFlight.get(id);
    // An answer to a question asked before a change is not shared with one asked after it.
    if (shared && shared.generation === startedIn) return shared.promise as Promise<T>;
    const promise = (async () => {
      try {
        const value = await read(...args);
        remember(id, value, startedIn);
        return value;
      } catch (failure) {
        rememberFailure(id, startedIn);
        throw failure;
      }
    })();
    const entry = { generation: startedIn, promise };
    inFlight.set(id, entry);
    const done = () => {
      if (inFlight.get(id) === entry) inFlight.delete(id);
    };
    promise.then(done, done);
    return promise;
  };
  return {
    last: (...args: A): T | undefined => recall<T>(key(args)),
    /** The last answer is still shown because asking again failed (also before a reload). */
    failed: (...args: A): boolean => refreshFailed(key(args)),
    load: (...args: A): Promise<T> => ask(args, true),
    /**
     * `load` for a page that may open next: if it does within a few seconds it takes this
     * answer instead of sending the same request again.
     */
    prefetch: (...args: A): Promise<T> => {
      const id = key(args);
      // An answer already waiting for a page is not asked for a second time (the same read is
      // behind two menu links).
      const warmAt = prefetched.get(id);
      if (warmAt !== undefined && Date.now() - warmAt < PREFETCH_USE_MS) {
        const warm = recall<T>(id);
        if (warm !== undefined) return Promise.resolve(warm);
      }
      // Joining a read someone else already started leaves nothing to hand over later.
      const joined = inFlight.get(id)?.generation === generationNow();
      const promise = ask(args, false);
      if (joined) return promise;
      const mine = {};
      unclaimed.set(id, mine);
      const settle = (answered: boolean) => {
        if (unclaimed.get(id) !== mine) return;
        unclaimed.delete(id);
        if (answered) prefetched.set(id, Date.now());
      };
      promise.then(
        () => settle(true),
        () => settle(false),
      );
      return promise;
    },
  };
}

/** Every account of the owner, page by page. */
async function allAccounts(): Promise<AccountSummary[]> {
  const accounts: AccountSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await accountingApi.listAccounts(cursor);
    accounts.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return accounts;
}

// What the last status said about when each source last succeeded.
let lastSuccesses: string | null = null;

/**
 * A background sync that finished since the last look brought new data: whatever was kept
 * before it is old, so the next page asks the server instead of reusing it.
 */
async function readSources(): Promise<SyncSource[]> {
  const sources = await syncStatusApi.get();
  const successes = JSON.stringify(sources.map((source) => [source.key, source.lastSuccessAt]));
  if (lastSuccesses !== null && lastSuccesses !== successes) forgetReads();
  lastSuccesses = successes;
  return sources;
}

export const cachedReads = {
  accounts: cachedRead('accounts', allAccounts),
  portfolio: cachedRead('portfolio', (currency?: Parameters<typeof portfolioValuationApi.get>[0]) =>
    portfolioValuationApi.get(currency),
  ),
  assetLots: cachedRead('asset-lots', (...args: Parameters<typeof portfolioValuationApi.lots>) =>
    portfolioValuationApi.lots(...args),
  ),
  history: cachedRead(
    'history',
    (...args: Parameters<typeof portfolioHistoryApi.get>): Promise<PortfolioHistory> =>
      portfolioHistoryApi.get(...args),
  ),
  assetHistory: cachedRead(
    'asset-history',
    (...args: Parameters<typeof assetHistoryApi.get>): Promise<AssetHistory> =>
      assetHistoryApi.get(...args),
  ),
  operations: cachedRead(
    'operations',
    (...args: Parameters<typeof operationsApi.list>): Promise<OperationList> =>
      operationsApi.list(...args),
  ),
  transferProposals: cachedRead(
    'transfer-proposals',
    (): Promise<TransferProposals> => operationsApi.transferProposals(),
  ),
  duplicateProposals: cachedRead(
    'duplicate-proposals',
    (): Promise<DuplicateProposals> => operationsApi.duplicateProposals(),
  ),
  toClassify: cachedRead('to-classify', (): Promise<number> => operationsApi.needsClassification()),
  sources: cachedRead('sources', readSources),
  hiddenAssets: cachedRead('hidden-assets', (): Promise<HiddenAsset[]> => hiddenAssetsApi.list()),
  wallets: cachedRead('wallets', (): Promise<WalletAddress[]> => walletAddressesApi.list()),
  settings: cachedRead('settings', (): Promise<OwnerSettings> => ownerSettingsApi.get()),
  rates: cachedRead('rates', (): Promise<FxRatesReport> => fxRatesApi.get()),
  deposits: cachedRead('deposits', (): Promise<DepositList> => depositsApi.list()),
  deposit: cachedRead('deposit', (id: string): Promise<DepositDetail> => depositsApi.get(id)),
  goals: cachedRead('goals', (): Promise<GoalList> => goalsApi.list()),
  goal: cachedRead('goal', (id: string): Promise<Goal> => goalsApi.get(id)),
  goalForecast: cachedRead(
    'goal-forecast',
    (id: string): Promise<GoalForecast> => goalsApi.forecast(id),
  ),
  /** One page of the change history for a filter: the newest, or the one older than `before`. */
  audit: cachedRead(
    'audit',
    (query: Parameters<typeof auditHistoryApi.list>[0], before?: string): Promise<AuditHistory> =>
      before === undefined ? auditHistoryApi.list(query) : auditHistoryApi.list(query, before),
  ),
};

// A sync or a classification changed what the server knows: nothing kept before is current.
if (typeof window !== 'undefined') {
  window.addEventListener(SYNC_CHANGED, forgetReads);
  window.addEventListener(CLASSIFICATION_CHANGED, forgetReads);
}

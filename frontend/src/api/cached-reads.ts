import { type AccountSummary, accountingApi } from './accounting.api';
import { type AssetHistory, assetHistoryApi } from './asset-history.api';
import { type AuditHistory, auditHistoryApi } from './audit-history.api';
import { type FxRatesReport, fxRatesApi } from './fx-rates.api';
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
import { forgetReads, generationNow, recall, remember } from './read-cache';
import { SYNC_CHANGED, type SyncSource, syncStatusApi } from './sync-status.api';
import { type WalletAddress, walletAddressesApi } from './wallet-addresses.api';

/**
 * A read whose last answer is kept for the session: `last` is what to paint on arrival,
 * `load` asks the server and keeps the answer. The page always loads; the cache only decides
 * what it shows meanwhile.
 */
function cachedRead<A extends unknown[], T>(name: string, read: (...args: A) => Promise<T>) {
  const key = (args: A) => `${name}:${JSON.stringify(args)}`;
  return {
    last: (...args: A): T | undefined => recall<T>(key(args)),
    load: async (...args: A): Promise<T> => {
      const startedIn = generationNow();
      const value = await read(...args);
      remember(key(args), value, startedIn);
      return value;
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

export const cachedReads = {
  accounts: cachedRead('accounts', allAccounts),
  portfolio: cachedRead('portfolio', (currency?: Parameters<typeof portfolioValuationApi.get>[0]) =>
    portfolioValuationApi.get(currency),
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
  sources: cachedRead('sources', (): Promise<SyncSource[]> => syncStatusApi.get()),
  wallets: cachedRead('wallets', (): Promise<WalletAddress[]> => walletAddressesApi.list()),
  settings: cachedRead('settings', (): Promise<OwnerSettings> => ownerSettingsApi.get()),
  rates: cachedRead('rates', (): Promise<FxRatesReport> => fxRatesApi.get()),
  /** The newest page of the change history for a filter; older pages are not kept. */
  audit: cachedRead(
    'audit',
    (query: Parameters<typeof auditHistoryApi.list>[0]): Promise<AuditHistory> =>
      auditHistoryApi.list(query),
  ),
};

// A sync or a classification changed what the server knows: nothing kept before is current.
if (typeof window !== 'undefined') {
  window.addEventListener(SYNC_CHANGED, forgetReads);
  window.addEventListener(CLASSIFICATION_CHANGED, forgetReads);
}

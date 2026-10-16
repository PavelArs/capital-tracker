import type { WalletKind } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import type { HiddenAsset } from '@api/hidden-assets.api';
import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { announceSyncChange } from '@api/sync-status.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { useToast } from '@contexts/ToastContext';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAskedCurrency } from '../portfolio/currency';
import { networkOf } from './networks';
import { failureMessage, type SyncRun } from './SyncStatus';
import { classedOf, hiddenSymbolsOf, kindsOf } from './wallets';

// One sync request reads at most ten provider pages; a long history needs several requests.
const MAX_SYNC_REQUESTS = 40;
// While the background job loads a history, the page looks again this often.
const BACKGROUND_REFRESH_MS = 10_000;

/**
 * The portfolio and the tracked addresses behind the Wallets pages, "Sync now", and a quiet
 * refresh while the background job (M11) loads a history.
 */
export function useWallets() {
  const [asked] = useAskedCurrency();
  // Coming back to the page shows the last answers at once; the load below replaces them.
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(
    () => cachedReads.portfolio.last(asked) ?? null,
  );
  const [addresses, setAddresses] = useState<WalletAddress[] | null>(
    () => cachedReads.wallets.last() ?? null,
  );
  // W1: how each wallet is held; a failed read leaves the labels out, not the page.
  const [kinds, setKinds] = useState<Record<string, WalletKind | null>>(() =>
    kindsOf(cachedReads.accounts.last()),
  );
  // Property and broker accounts (v8) have their own sections; known once the accounts are read.
  const [classed, setClassed] = useState<ReadonlySet<string>>(() =>
    classedOf(cachedReads.accounts.last()),
  );
  // ASSET-HIDE: the coins the owner hid are no difference to explain. Until the list is read
  // (or when its read fails) it is unknown, and no balance is compared.
  const [hiddenAssets, setHiddenAssets] = useState<HiddenAsset[] | null>(
    () => cachedReads.hiddenAssets.last() ?? null,
  );
  const [failed, setFailed] = useState(false);
  const [runs, setRuns] = useState<Record<string, SyncRun>>({});
  // wallets-02: a sync the owner started says when it is done, as a toast (plan 1.5).
  const toast = useToast();
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
      const kept = quiet ? undefined : cachedReads.portfolio.last(asked);
      const keptAddresses = cachedReads.wallets.last();
      const keptAccounts = cachedReads.accounts.last();
      if (!quiet) setPortfolio(kept && keptAddresses && keptAccounts ? kept : null);
      try {
        // ASSET-HIDE: the hidden list lands with the balances it is compared against; one that
        // cannot be read leaves the comparison unknown rather than trusting an older list.
        // v8: the accounts land with them too, since their class keeps property out of Wallets.
        const [nextPortfolio, nextAddresses, nextHidden, nextAccounts] = await Promise.all([
          cachedReads.portfolio.load(asked),
          cachedReads.wallets.load(),
          cachedReads.hiddenAssets.load().catch(() => null),
          cachedReads.accounts.load(),
        ]);
        if (request !== latest.current) return;
        setKinds(kindsOf(nextAccounts));
        setClassed(classedOf(nextAccounts));
        setPortfolio(nextPortfolio);
        setAddresses(nextAddresses);
        setHiddenAssets(nextHidden);
      } catch {
        if (request === latest.current && !quiet && !(kept && keptAddresses && keptAccounts))
          setFailed(true);
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
  // WALLET-REMOVE: an address stopped leaves the list at once; the next load confirms it.
  const forget = useCallback((id: string) => {
    setAddresses((current) => (current ? current.filter((item) => item.id !== id) : current));
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
        let synced: WalletAddress | null = null;
        for (let request = 0; request < MAX_SYNC_REQUESTS; request++) {
          const result = await walletAddressesApi.sync(id);
          if (!mounted.current) return;
          replace(result.address);
          synced = result.address;
          if (result.outcome === 'provider_error') {
            setRun(id, {
              state: 'failed',
              message:
                result.address.sync.errorMessage ??
                failureMessage(result.reason ?? 'unavailable', result.address),
            });
            return;
          }
          if (result.outcome === 'complete') break;
        }
        setRun(id, null);
        if (synced?.sync.state === 'complete')
          toast.show({
            tone: 'success',
            title: `${synced.label ?? networkOf(synced).name} is synced.`,
          });
        // A list asked for while the history loaded may be older than the last page.
        void load(true);
        announceSyncChange();
      } catch (error) {
        if (!mounted.current) return;
        // wallets-20: only a request that got no answer could not reach the server.
        const status = isAxiosError(error) ? error.response?.status : undefined;
        setRun(id, {
          state: 'failed',
          message: failureMessage(
            status === undefined
              ? 'server'
              : status === 409
                ? 'busy'
                : status === 401
                  ? 'session'
                  : 'failed',
          ),
        });
      } finally {
        announceSyncChange();
        running.current.delete(id);
      }
    },
    [load, replace, setRun, toast],
  );

  // The background job is loading a history: show its progress without a reload.
  const backgroundSyncing =
    addresses?.some((address) => address.sync.status === 'syncing' && !runs[address.id]) ?? false;
  useEffect(() => {
    if (!backgroundSyncing) return;
    const timer = window.setInterval(() => void load(true), BACKGROUND_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [backgroundSyncing, load]);

  const hiddenSymbols = useMemo(
    () => (hiddenAssets ? hiddenSymbolsOf(hiddenAssets) : null),
    [hiddenAssets],
  );
  return {
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
  };
}

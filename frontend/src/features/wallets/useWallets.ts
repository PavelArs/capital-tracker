import type { PortfolioValuation } from '@api/portfolio-valuation.api';
import { portfolioValuationApi } from '@api/portfolio-valuation.api';
import { announceSyncChange } from '@api/sync-status.api';
import { type WalletAddress, walletAddressesApi } from '@api/wallet-addresses.api';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAskedCurrency } from '../portfolio/currency';
import { failureMessages, type SyncRun } from './SyncStatus';

// One sync request reads at most ten provider pages; a long history needs several requests.
const MAX_SYNC_REQUESTS = 40;
// While the background job loads a history, the page looks again this often.
const BACKGROUND_REFRESH_MS = 10_000;

/**
 * The portfolio and the tracked addresses behind the Wallets pages, "Sync now", and a quiet
 * refresh while the background job (M11) loads a history.
 */
export function useWallets() {
  const [portfolio, setPortfolio] = useState<PortfolioValuation | null>(null);
  const [addresses, setAddresses] = useState<WalletAddress[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [runs, setRuns] = useState<Record<string, SyncRun>>({});
  const [asked] = useAskedCurrency();
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

  return { portfolio, addresses, failed, load, replace, runs, sync, asked };
}

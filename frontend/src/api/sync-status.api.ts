import apiClient from './client';

export type SourceState = 'synced' | 'syncing' | 'delayed' | 'failed';

/** One background source (PR-SYN-1): prices, Bank of Russia rates or one wallet. */
export interface SyncSource {
  key: string;
  kind: 'prices' | 'fx' | 'wallet';
  name: string;
  /** null for a wallet whose first sync has not run yet. */
  state: SourceState | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
}

export const syncStatusApi = {
  get: async (): Promise<SyncSource[]> =>
    (await apiClient.get<{ sources: SyncSource[] }>('/sync-status')).data.sources,
};

// Pages that change a source (a wallet sync) tell the sidebar to read the status again.
export const SYNC_CHANGED = 'capital:sync-changed';
export const announceSyncChange = () => window.dispatchEvent(new Event(SYNC_CHANGED));

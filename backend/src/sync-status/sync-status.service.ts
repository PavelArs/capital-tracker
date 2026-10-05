import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { parseUuid } from '../accounting/input';
import { STALE_AFTER_MS } from '../prices/price-collection';
import { presentSource, type SourceRow, type SourceState } from './sync-source';

export interface SourceSummary {
  key: string;
  kind: 'prices' | 'fx' | 'wallet';
  name: string;
  /** null for a wallet whose first pass has not run yet. */
  state: SourceState | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  errorMessage: string | null;
}

interface KeyedRow extends SourceRow {
  key: string;
}
interface WalletRow {
  id: string;
  network: string;
  label: string | null;
}

const NETWORK_NAMES: Record<string, string> = { bitcoin: 'Bitcoin' };
const latest = (dates: (string | null)[]) =>
  dates
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1) ?? null;

// Kraken and CoinGecko take turns (M3): prices are healthy while either delivered within
// the freshness window, whatever the other one reported.
function prices(rows: KeyedRow[], now: Date): SourceSummary | null {
  if (rows.length === 0) return null;
  const shown = rows.map((row) => presentSource(row, now));
  const lastSuccessAt = latest(shown.map((row) => row.lastSuccessAt));
  const lastAttemptAt = latest(shown.map((row) => row.lastAttemptAt));
  const fresh =
    lastSuccessAt !== null && now.getTime() - Date.parse(lastSuccessAt) <= STALE_AFTER_MS;
  const failing = shown
    .filter((row) => row.errorMessage !== null)
    .sort((a, b) => (a.lastAttemptAt ?? '').localeCompare(b.lastAttemptAt ?? ''))
    .at(-1);
  const state: SourceState = shown.some((row) => row.state === 'syncing')
    ? 'syncing'
    : fresh
      ? 'synced'
      : 'failed';
  return {
    key: 'prices',
    kind: 'prices',
    name: 'Prices',
    state,
    lastAttemptAt,
    lastSuccessAt,
    errorMessage:
      state === 'failed'
        ? (failing?.errorMessage ?? 'Prices have not been updated for more than two hours')
        : null,
  };
}

@Injectable()
export class SyncStatusService {
  constructor(private readonly source: DataSource) {}

  /** PR-SYN-1, SYNC-STATUS: every background source the owner depends on, one state each. */
  async read(ownerId: string, now = new Date()) {
    const owner = parseUuid(ownerId);
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const rows: KeyedRow[] = await manager.query(
        `SELECT * FROM sync_sources WHERE key IN ('prices:kraken', 'prices:coingecko', 'fx:cbr')
          ORDER BY key`,
      );
      const wallets: (WalletRow & { source: KeyedRow | null })[] = await manager.query(
        `SELECT a.id, a.network, a.label, s.key, s.state, s."lastAttemptAt", s."lastSuccessAt",
            s."nextRunAt", s."errorCode", s."errorMessage"
          FROM wallet_addresses a LEFT JOIN sync_sources s ON s.key = 'wallet:' || a.id::text
          WHERE a."ownerId" = $1 ORDER BY a."createdAt", a.id`,
        [owner],
      );
      const sources: SourceSummary[] = [];
      const price = prices(
        rows.filter(({ key }) => key.startsWith('prices:')),
        now,
      );
      if (price) sources.push(price);
      const fx = rows.find(({ key }) => key === 'fx:cbr');
      if (fx) sources.push(summary(fx, 'fx', 'Bank of Russia rates', now));
      for (const wallet of wallets) {
        const name = wallet.label ?? NETWORK_NAMES[wallet.network] ?? wallet.network;
        const key = `wallet:${wallet.id}`;
        const row = wallet as unknown as KeyedRow & { key: string | null };
        sources.push(
          row.key === null
            ? {
                key,
                kind: 'wallet',
                name,
                state: null,
                lastAttemptAt: null,
                lastSuccessAt: null,
                errorMessage: null,
              }
            : summary({ ...row, key }, 'wallet', name, now),
        );
      }
      return { sources };
    });
  }
}

function summary(
  row: KeyedRow,
  kind: SourceSummary['kind'],
  name: string,
  now: Date,
): SourceSummary {
  const shown = presentSource(row, now);
  return {
    key: row.key,
    kind,
    name,
    state: shown.state,
    lastAttemptAt: shown.lastAttemptAt,
    lastSuccessAt: shown.lastSuccessAt,
    errorMessage: shown.errorMessage,
  };
}

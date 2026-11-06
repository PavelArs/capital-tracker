import type { SyncSource } from '@api/sync-status.api';
import { age } from '../portfolio/format';

export interface SyncSummary {
  tone: 'pos' | 'info' | 'warn' | 'neutral';
  title: string;
  detail: string;
  /** Each source that needs attention, with its reason. */
  problems: string[];
}

const latest = (dates: (string | null)[]) =>
  dates
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1) ?? null;

/** SYNC-STATUS: the sidebar's one-line state of every background source (prototype "syncbox"). */
export function summarizeSync(sources: readonly SyncSource[], now = new Date()): SyncSummary {
  const wallets = sources.some((source) => source.kind === 'wallet');
  // Every wallet address is a source from the start, so none at all means no wallet yet.
  if (sources.length === 0) {
    return {
      tone: 'neutral',
      title: 'No wallets yet',
      detail: 'Prices update every hour',
      problems: [],
    };
  }
  // WALLET-SYNC-OFF: a wallet the owner switched off is on purpose and left out; one the app
  // switched off after repeated failures needs attention until it is switched on again.
  const active = sources.filter((source) => source.disabledReason !== 'manual');
  const failing = active.filter(
    (source) =>
      source.disabledReason === 'failures' ||
      source.state === 'failed' ||
      source.state === 'delayed',
  );
  const problems = failing.map((source) => {
    const reason =
      source.disabledReason === 'failures' ? 'Sync switched off after failures.' : null;
    const text = [reason, source.errorMessage].filter(Boolean).join(' ');
    return text ? `${source.name}: ${text}` : source.name;
  });
  const running = active.filter(
    (source) => !failing.includes(source) && (source.state === 'syncing' || source.state === null),
  );
  if (running.length > 0 && failing.length === 0) {
    return {
      tone: 'info',
      title: 'Syncing…',
      detail: running.some((source) => source.kind === 'wallet')
        ? 'Wallet history is loading'
        : 'Updating prices',
      problems,
    };
  }
  if (failing.length > 0) {
    const others = latest(
      active.filter((source) => !failing.includes(source)).map((source) => source.lastSuccessAt),
    );
    return {
      tone: 'warn',
      title:
        failing.length === 1
          ? '1 source needs attention'
          : `${failing.length} sources need attention`,
      detail: others ? `Others synced ${age(others, now)}` : (failing[0].errorMessage ?? ''),
      problems,
    };
  }
  const last = latest(active.map((source) => source.lastSuccessAt));
  return {
    tone: 'pos',
    title: 'All synced',
    detail: `${wallets ? 'Prices and wallets' : 'Prices'}${last ? ` ${age(last, now)}` : ''}`,
    problems,
  };
}

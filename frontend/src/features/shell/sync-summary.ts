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
  if (sources.length === 0) {
    return {
      tone: 'neutral',
      title: 'Not synced yet',
      detail: 'Prices and wallets update every hour',
      problems: [],
    };
  }
  const failing = sources.filter(
    (source) => source.state === 'failed' || source.state === 'delayed',
  );
  const problems = failing.map((source) =>
    source.errorMessage ? `${source.name}: ${source.errorMessage}` : source.name,
  );
  const running = sources.filter((source) => source.state === 'syncing' || source.state === null);
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
      sources.filter((source) => !failing.includes(source)).map((source) => source.lastSuccessAt),
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
  const last = latest(sources.map((source) => source.lastSuccessAt));
  return {
    tone: 'pos',
    title: 'All synced',
    detail: `${wallets ? 'Prices and wallets' : 'Prices'}${last ? ` ${age(last, now)}` : ''}`,
    problems,
  };
}

import type { SourceState } from '../sync-status/sync-source';
import type { ProviderFailure } from './esplora-client';

export type StepOutcome = 'complete' | 'partial' | 'provider_error';

/** One bounded pass over a wallet's history; the next pass continues from its cursor. */
export interface StepResult {
  outcome: StepOutcome;
  reason: ProviderFailure | null;
  imported: number;
}

/**
 * PR-WAL-2: what a network contributes to background sync. Each adapter keeps its own
 * cursor and stores raw chain transactions idempotently; the scheduler only decides when
 * to call it and records the result.
 */
export interface ChainSyncAdapter {
  readonly network: string;
  /** "Bitcoin", for the owner's messages. */
  readonly name: string;
  step(ownerId: string, addressId: string): Promise<StepResult>;
}

export const CHAIN_SYNC_ADAPTERS = Symbol('CHAIN_SYNC_ADAPTERS');

export type SyncFailure = ProviderFailure | 'unsupported' | 'error';

export interface SourceOutcome {
  state: SourceState;
  errorCode: SyncFailure | null;
  errorMessage: string | null;
  /** When the scheduler should look at the wallet again. */
  nextRunAt: Date;
}

const MINUTE_MS = 60_000;
// PR-SYN-1: a synced wallet is checked every hour, a failed one sooner.
export const SYNCED_EVERY_MS = 60 * MINUTE_MS;
export const RETRY_AFTER_MS = 15 * MINUTE_MS;

export function failureMessage(network: string, reason: SyncFailure): string {
  switch (reason) {
    case 'rate_limited':
      return `The ${network} data source is busy. The app tries again in a few minutes.`;
    case 'unavailable':
      return `${network} data is temporarily unavailable.`;
    case 'invalid_response':
      return `The ${network} data source sent an answer the app cannot read.`;
    case 'unsupported':
      return `Syncing ${network} wallets is not supported yet.`;
    case 'error':
      return 'The sync stopped unexpectedly.';
  }
}

/** Maps one pass to the wallet's source state (SyncSource in the product requirements). */
export function outcomeOf(
  network: string,
  result: StepResult | { failure: 'unsupported' | 'error' },
  now: Date,
): SourceOutcome {
  const at = (delay: number) => new Date(now.getTime() + delay);
  if ('failure' in result) {
    return {
      state: 'failed',
      errorCode: result.failure,
      errorMessage: failureMessage(network, result.failure),
      nextRunAt: at(RETRY_AFTER_MS),
    };
  }
  if (result.outcome === 'complete') {
    return { state: 'synced', errorCode: null, errorMessage: null, nextRunAt: at(SYNCED_EVERY_MS) };
  }
  // More history waits behind the page budget: the next tick continues it.
  if (result.outcome === 'partial') {
    return { state: 'syncing', errorCode: null, errorMessage: null, nextRunAt: now };
  }
  const reason = result.reason ?? 'unavailable';
  return {
    state: reason === 'rate_limited' ? 'delayed' : 'failed',
    errorCode: reason,
    errorMessage: failureMessage(network, reason),
    nextRunAt: at(RETRY_AFTER_MS),
  };
}

export const walletSourceKey = (addressId: string) => `wallet:${addressId}`;

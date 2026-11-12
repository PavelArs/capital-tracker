import {
  announceClassificationChange,
  CLASSIFICATION_CHANGED,
  type ClassificationCommand,
  operationsApi,
} from '@api/operations.api';
import { SYNC_CHANGED } from '@api/sync-status.api';
import { useCallback, useEffect, useState } from 'react';
import { useAttempt } from '../accounting/feedback';
import { useInfinite } from '../shell/InfiniteScroll';
import { type Proposals as Kind, takeHandover } from './proposals-handover';

/**
 * The offers of a card above the list (joined transfers, duplicates), twenty a page, and the
 * one-tap answer to one of them. A classification or a sync elsewhere asks for them again.
 */
export function useProposals<T, P>(
  kind: Kind,
  read: {
    last: () => (P & { proposals: T[] }) | undefined;
    load: () => Promise<P & { proposals: T[] }>;
  },
  /** What a failed answer says. */
  failure: (error: unknown) => string,
) {
  const [found, setFound] = useState<(P & { proposals: T[] }) | null>(() => read.last() ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  // A retry of one answer after a lost reply keeps its request id, so it is recorded once.
  const attempt = useAttempt();

  const load = useCallback(async () => {
    try {
      setFound(await read.load());
    } catch {
      // The list is an offer; without it the page works as before.
    }
  }, [read]);
  useEffect(() => {
    // The page read it together with the list a moment ago; asking again would only repeat it.
    // Only an answer that was kept counts: one that landed after a drop was not remembered.
    const handed = takeHandover(kind) && read.last() !== undefined;
    if (!handed) void load();
    window.addEventListener(CLASSIFICATION_CHANGED, load);
    window.addEventListener(SYNC_CHANGED, load);
    return () => {
      window.removeEventListener(CLASSIFICATION_CHANGED, load);
      window.removeEventListener(SYNC_CHANGED, load);
    };
  }, [kind, read, load]);

  const proposals = found?.proposals ?? [];
  // PAGES: twenty proposals a page.
  const paged = useInfinite(proposals);

  /** Answers the chain transaction `txid` of address `addressId`; `done` runs once it is saved. */
  const act = async (
    key: string,
    { addressId, txid }: { addressId: string; txid: string },
    answer: Omit<ClassificationCommand, 'requestId'>,
    done: () => void,
  ) => {
    setBusy(key);
    setProblem(null);
    try {
      await operationsApi.classify({ id: addressId }, txid, {
        requestId: attempt([key, answer]),
        ...answer,
      });
      attempt.done([key, answer]);
      announceClassificationChange();
      done();
    } catch (error) {
      setProblem({ key, text: failure(error) });
    } finally {
      setBusy(null);
    }
  };

  return { found, proposals, paged, busy, problem, act };
}

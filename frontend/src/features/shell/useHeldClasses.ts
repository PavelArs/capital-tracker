import type { AccountClass } from '@api/accounting.api';
import { cachedReads } from '@api/cached-reads';
import { generationNow } from '@api/read-cache';
import { useEffect, useRef, useState } from 'react';

const classesOf = (accounts: readonly { assetClass?: AccountClass | null }[] | undefined) =>
  new Set(
    (accounts ?? []).flatMap((account) => (account.assetClass ? [account.assetClass] : [])),
  ) as ReadonlySet<AccountClass>;

/**
 * The asset classes the owner holds accounts of (v8), for the sections shown only then. Only a
 * change the owner makes can add an account, and every change drops the kept reads: so the
 * accounts are read on arrival and again on the first page after a change, never on every page.
 * A failed read keeps what was known and is tried again on the next page.
 */
export function useHeldClasses(pathname: string): ReadonlySet<AccountClass> {
  const [held, setHeld] = useState(() => classesOf(cachedReads.accounts.last()));
  const readIn = useRef<number | null>(null);
  // A read outlives the page that started it: moving on before it answers must not lose it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page looks for a change.
  useEffect(() => {
    const generation = generationNow();
    if (readIn.current === generation) return;
    readIn.current = generation;
    cachedReads.accounts.load().then(
      // Only the newest read may answer: an older one that lands late knows less.
      (accounts) =>
        mounted.current && readIn.current === generation && setHeld(classesOf(accounts)),
      () => {
        // A failed read is tried again on the next page, not only after the next change.
        if (readIn.current === generation) readIn.current = null;
      },
    );
  }, [pathname]);
  return held;
}

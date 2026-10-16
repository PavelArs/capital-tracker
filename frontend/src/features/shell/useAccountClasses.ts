import { cachedReads } from '@api/cached-reads';
import { useMemo } from 'react';
import type { AccountClasses } from './asset-identity';
import { useCachedRead } from './useCachedRead';

/**
 * Every account's class (v8) by account id, for the colours of the assets they hold. Empty
 * until the accounts are read; a failed read leaves the assets in their type's colours.
 */
export function useAccountClasses(): AccountClasses {
  const { data } = useCachedRead(cachedReads.accounts);
  return useMemo(
    () => Object.fromEntries((data ?? []).map((account) => [account.id, account.assetClass])),
    [data],
  );
}

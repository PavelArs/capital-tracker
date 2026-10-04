/**
 * Whether a read still describes the journal the page shows. A read requested while the
 * journal was still loading (observed `null`) counts when it was computed at the revision
 * that then loaded; any other revision change makes it stale.
 */
export function matchesShownJournal(
  observed: number | null,
  computed: number,
  shown: number | null,
): boolean {
  return shown === observed || (observed === null && computed === shown);
}

/** An error from a read requested before the journal loaded still applies once it loads. */
export function errorMatchesShownJournal(observed: number | null, shown: number | null): boolean {
  return shown === observed || observed === null;
}

/** The journal loading for the same account is not a change to invalidate reads for. */
export function journalChanged(
  previous: { accountId: string; journalRevision: number | null },
  next: { accountId: string; journalRevision: number | null },
): boolean {
  if (previous.accountId !== next.accountId) return true;
  return previous.journalRevision !== null && previous.journalRevision !== next.journalRevision;
}

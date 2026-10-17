import { connection, useConnection } from '@api/connection';
import { keptSince } from '@api/read-cache';
import { clockText } from '@utils/dates';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';

/**
 * The prototype's stale and offline states above every page: when the browser is offline or the
 * server stopped answering reads, the figures on screen are the ones kept from before, and this
 * says so with the time they were loaded and a Retry that draws the page again. A slow read says
 * the figures are being refreshed. The live region is always in the page, so the change is read.
 */
export default function ConnectionBanner() {
  const current = useConnection();
  const since = keptSince();
  const at = since === null ? null : clockText(since);
  const kept = at !== null && (current.offline || current.failing);
  return (
    // A polite live region without the status role, so a page's own status line stays the one
    // status on it.
    <div className="shell-page__state" aria-live="polite" data-connection-state="">
      {kept ? (
        <Banner
          tone="warn"
          role="none"
          title={current.offline ? "You're offline" : "Couldn't refresh"}
          action={
            <Button size="sm" icon="refresh" onClick={() => connection.retry()}>
              Retry
            </Button>
          }
        >
          Showing what was loaded at {at}. Figures may have changed since.
        </Banner>
      ) : at !== null && current.slow ? (
        <Banner tone="info" role="none" busy>
          Refreshing… The figures shown were loaded at {at}.
        </Banner>
      ) : null}
    </div>
  );
}

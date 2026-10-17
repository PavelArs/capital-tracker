import type { ReactNode } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';

/**
 * A page or a card that could not load and has nothing to show: a card with the failure as an
 * alert and, when the read can be repeated, Try again. Data that is still on screen gets a warn
 * Banner instead (see the notification rules in contexts/ToastContext.tsx). A load failure names
 * `what` and gets the one sentence every page uses (prototype): "Couldn't load your portfolio.
 * Nothing you saved is lost."
 */
export function ErrorState({
  what,
  children,
  onRetry,
  retrying = false,
  retryLabel = 'Try again',
}: {
  /** What could not load ("your portfolio"), for the shared sentence. */
  what?: string;
  /** What failed, and what still works, when it is not a plain load failure. */
  children?: ReactNode;
  onRetry?: () => void;
  /** The retry is running: the button is busy. */
  retrying?: boolean;
  retryLabel?: string;
}) {
  return (
    <Card as="div" className="ui-error-state">
      <Banner
        tone="neg"
        role="alert"
        action={
          onRetry && (
            <Button variant="secondary" size="sm" icon="refresh" busy={retrying} onClick={onRetry}>
              {retryLabel}
            </Button>
          )
        }
      >
        {what ? `Couldn't load ${what}. Nothing you saved is lost.` : children}
      </Banner>
    </Card>
  );
}

import type { ReactNode } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import { Card } from './Card';

/**
 * A page or a card that could not load and has nothing to show: a card with the failure as an
 * alert and, when the read can be repeated, Try again. Data that is still on screen gets a warn
 * Banner instead (see the notification rules in contexts/ToastContext.tsx).
 */
export function ErrorState({
  children,
  onRetry,
  retrying = false,
  retryLabel = 'Try again',
}: {
  /** What failed, and what still works. */
  children: ReactNode;
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
        {children}
      </Banner>
    </Card>
  );
}

import { Component, type ReactNode } from 'react';
import { logger } from '../../utils/logger';
import { forgetFailedPages } from './lazy-page';

interface Props {
  children: ReactNode;
  /** When this changes (the path), a failure is forgotten and the screen is tried again. */
  resetKey?: string;
}

interface State {
  failed: boolean;
  key?: string;
}

/**
 * Catches a screen whose file could not be fetched (a dropped connection, or a file the server
 * no longer has after an update) and offers to try again or to reload, instead of replacing the
 * whole application with the last-resort error page.
 */
export default class PageLoadBoundary extends Component<Props, State> {
  public state: State = { failed: false, key: this.props.resetKey };

  public static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.key) return null;
    // A new path asks again for the files that failed (idempotent, so safe to run here).
    forgetFailedPages();
    return { failed: false, key: props.resetKey };
  }

  public static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  public componentDidCatch(error: Error) {
    logger.error('Screen failed to load:', error);
  }

  public render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="shell-card portfolio-state" role="alert">
        <p>This screen could not be loaded. Check your connection and try again.</p>
        <button
          type="button"
          className="shell-button"
          onClick={() => {
            forgetFailedPages();
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>{' '}
        <button type="button" className="shell-button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </section>
    );
  }
}

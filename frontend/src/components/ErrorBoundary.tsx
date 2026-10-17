import { Component, ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '../ui/ErrorState';
import { logger } from '../utils/logger';
import './ErrorBoundary.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/** The last resort: the app failed while drawing. A card says so and offers a reload. */
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <main className="ui-crash">
            <h1 className="ui-crash__title">Something went wrong.</h1>
            <ErrorState retryLabel="Reload the page" onRetry={() => window.location.reload()}>
              The app stopped while drawing this screen. Your data is safe on the server; reload the
              page to try again.
            </ErrorState>
          </main>
        )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

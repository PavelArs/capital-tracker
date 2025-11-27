import { Component, ErrorInfo, type ReactNode } from 'react';
import { logger } from '../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

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
          <div className="p-4 text-center">
            <h1 className="text-2xl font-bold text-red-600">Something went wrong.</h1>
            <p className="text-gray-600">Please try refreshing the page.</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

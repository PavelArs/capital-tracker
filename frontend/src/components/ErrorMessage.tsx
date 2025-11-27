import React from 'react';
import './ErrorMessage.css';

interface ErrorMessageProps {
  message?: string;
  title?: string;
  onRetry?: () => void;
  retryText?: string;
  className?: string;
  type?: 'page' | 'block' | 'inline';
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  message = 'An error occurred',
  title = 'Error',
  onRetry,
  retryText = 'Retry',
  className = '',
  type = 'block',
}) => {
  return (
    <div className={`error-message error-message-${type} ${className}`}>
      <div className="error-message-content">
        <div className="error-icon">⚠️</div>
        <div className="error-text">
          <h3 className="error-title">{title}</h3>
          <p className="error-description">{message}</p>
        </div>
      </div>
      {onRetry && (
        <button className="error-retry-btn" onClick={onRetry}>
          {retryText}
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;

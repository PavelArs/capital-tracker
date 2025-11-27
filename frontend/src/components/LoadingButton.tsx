import React from 'react';
import './LoadingButton.css';

interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: React.ReactNode;
  loadingText?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  loading = false,
  children,
  loadingText,
  className = '',
  disabled,
  variant = 'primary',
  ...props
}) => {
  return (
    <button
      className={`loading-button loading-button-${variant} ${className}`}
      disabled={loading || disabled}
      {...props}
    >
      {loading && (
        <span className="loading-spinner">
          <svg
            className="spinner"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              className="spinner-circle"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
          </svg>
        </span>
      )}
      <span className={loading ? 'loading-button-text-loading' : ''}>
        {loading && loadingText ? loadingText : children}
      </span>
    </button>
  );
};

export default LoadingButton;

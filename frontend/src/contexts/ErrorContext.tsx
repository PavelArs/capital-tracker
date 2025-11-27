import React, { createContext, useContext, useState, useCallback } from 'react';

interface ErrorContextType {
  showError: (message: string) => void;
  clearError: () => void;
  error: string | null;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function ErrorProvider({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((message: string) => {
    setError(message);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setError(null);
    }, 5000);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ showError, clearError, error }}>
      {children}
    </ErrorContext.Provider>
  );
}

export function useError() {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
}

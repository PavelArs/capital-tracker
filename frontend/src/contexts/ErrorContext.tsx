import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface ToastMessage {
  id: number;
  message: string;
}

interface ErrorContextType {
  showError: (message: string) => void;
  dismissToast: (id: number) => void;
  clearError: () => void;
  toasts: readonly ToastMessage[];
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

/** More than this many at once and the oldest goes: a burst of failures stays readable. */
const MAX_TOASTS = 3;
let nextId = 1;

export function ErrorProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);

  const showError = useCallback((message: string) => {
    // The same message again replaces the one on screen, so it is not stacked twice.
    setToasts((current) =>
      [...current.filter((toast) => toast.message !== message), { id: nextId++, message }].slice(
        -MAX_TOASTS,
      ),
    );
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clearError = useCallback(() => setToasts([]), []);

  const value = useMemo(
    () => ({ showError, dismissToast, clearError, toasts }),
    [showError, dismissToast, clearError, toasts],
  );
  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}

export function useError() {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error('useError must be used within an ErrorProvider');
  }
  return context;
}

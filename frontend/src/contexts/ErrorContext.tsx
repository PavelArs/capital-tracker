import { useCallback, useMemo } from 'react';
import { ToastProvider, useToastControls } from './ToastContext';

/**
 * The older error-only API, kept as a thin alias of the toast system (ToastContext.tsx):
 * `showError(message)` is `show({ tone: 'error', title: message })`. The axios handler and the
 * shell's logout use it.
 */
export const ErrorProvider = ToastProvider;

interface ErrorContextType {
  showError: (message: string) => void;
  dismissToast: (id: number) => void;
  clearError: () => void;
}

const missing = () => {
  throw new Error('useError must be used within an ErrorProvider');
};

export function useError(): ErrorContextType {
  const controls = useToastControls();
  const show = controls?.show;
  const showError = useCallback(
    (message: string) => void show?.({ tone: 'error', title: message }),
    [show],
  );
  const value = useMemo(
    () => ({
      showError,
      dismissToast: controls?.dismiss ?? missing,
      clearError: controls?.clear ?? missing,
    }),
    [showError, controls],
  );
  if (!controls) missing();
  return value;
}

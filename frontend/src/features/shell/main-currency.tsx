import { ownerSettingsApi } from '@api/owner-settings.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

interface MainCurrencyState {
  /** The owner's main currency once loaded; undefined while loading or when it failed. */
  main: AccountingCurrency | undefined;
  /** Settings reports a saved choice here, so every page header follows it at once. */
  setMain: (currency: AccountingCurrency) => void;
}

const MainCurrencyContext = createContext<MainCurrencyState>({
  main: undefined,
  setMain: () => undefined,
});

/** Loads the main currency once for the shell; pages without it fall back to their data. */
export function MainCurrencyProvider({ children }: { children: ReactNode }) {
  const [main, setMain] = useState<AccountingCurrency>();
  useEffect(() => {
    let active = true;
    ownerSettingsApi
      .get()
      .then((settings) => {
        // A choice saved meanwhile in Settings is newer than this answer.
        if (active) setMain((current) => current ?? settings.mainCurrency);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const value = useMemo(() => ({ main, setMain }), [main]);
  return <MainCurrencyContext.Provider value={value}>{children}</MainCurrencyContext.Provider>;
}

export function useMainCurrency(): MainCurrencyState {
  return useContext(MainCurrencyContext);
}

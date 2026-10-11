import { cachedReads } from '@api/cached-reads';
import type { InsightRules } from '@api/owner-settings.api';
import type { AccountingCurrency } from '@api/portfolio-valuation.api';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

interface MainCurrencyState {
  /** The owner's main currency once loaded; undefined while loading or when it failed. */
  main: AccountingCurrency | undefined;
  /** Settings reports a saved choice here, so every page header follows it at once. */
  setMain: (currency: AccountingCurrency) => void;
  /** The owner's insight rules (INS-RULES); undefined while loading, null when none are set. */
  insightRules: InsightRules | null | undefined;
  /** Settings reports saved rules here, so the Dashboard follows at once. */
  setInsightRules: (rules: InsightRules | null) => void;
}

const MainCurrencyContext = createContext<MainCurrencyState>({
  main: undefined,
  setMain: () => undefined,
  insightRules: undefined,
  setInsightRules: () => undefined,
});

/** Loads the main currency and the insight rules once for the shell; pages without it fall back to their data. */
export function MainCurrencyProvider({ children }: { children: ReactNode }) {
  const [main, setMain] = useState<AccountingCurrency>();
  const [insightRules, setInsightRules] = useState<InsightRules | null>();
  useEffect(() => {
    let active = true;
    cachedReads.settings
      .load()
      .then((settings) => {
        // A choice saved meanwhile in Settings is newer than this answer.
        if (!active) return;
        setMain((current) => current ?? settings.mainCurrency);
        setInsightRules((current) =>
          current === undefined ? (settings.insightRules ?? null) : current,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const value = useMemo(
    () => ({ main, setMain, insightRules, setInsightRules }),
    [main, insightRules],
  );
  return <MainCurrencyContext.Provider value={value}>{children}</MainCurrencyContext.Provider>;
}

export function useMainCurrency(): MainCurrencyState {
  return useContext(MainCurrencyContext);
}

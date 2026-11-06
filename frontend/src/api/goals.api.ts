import apiClient from './client';
import { HISTORY_TIMEOUT_MS, type MarketMissing } from './portfolio-history.api';
import type { AccountingCurrency } from './portfolio-valuation.api';

// GOAL-TERMS, GOAL-FORECAST: savings goals measured against the whole portfolio. The server
// computes progress, the verdict and the three return cases on every read.

export type GoalCurrency = AccountingCurrency;
export type GoalStatus = 'reached' | 'on-track' | 'behind' | 'overdue' | 'open' | 'unknown';
export type ScenarioKey = 'pessimistic' | 'base' | 'optimistic';

export interface GoalScenario {
  key: ScenarioKey;
  /** The yearly return of the case, in percent. */
  returnPercent: string;
  /** What to add every month to reach the target by the deadline; null without a deadline. */
  requiredMonthly: string | null;
  /** Months of the planned contribution until the target; null when it is never reached. */
  monthsToTarget: number | null;
  reachedOn: string | null;
  projectedAtDeadline: string | null;
  /** Target minus the projection at the deadline; negative is a surplus. */
  gap: string | null;
  /** Whether the unrounded projection reaches the sum by the date; null without a date. */
  metByDeadline?: boolean | null;
  /** The value after ten years of the planned contribution; only for a goal without a date. */
  projectedIn10Years?: string | null;
}

/**
 * GOAL-REAL: the goal read in today's money. The target keeps its value and the contribution
 * stays as entered, and each case's return is the nominal one corrected by the yearly inflation
 * of the goal's currency.
 */
export interface GoalReal {
  /** The yearly inflation the returns were corrected by, in percent. */
  inflationPercent: string;
  /** What that figure rests on beyond the published months: the owner's typed-in or estimated ones. */
  from: { ownMonths: boolean; estimated: boolean };
  /** The base case's return after that inflation, in percent; known even with no cases. */
  returnPercent: string;
  status: GoalStatus;
  scenarios: GoalScenario[];
}

/** One reading per inflation basis; null: that basis has no inflation figure for the currency. */
export interface GoalRealReadings {
  official: GoalReal | null;
  personal: GoalReal | null;
}

export interface Goal {
  id: string;
  name: string;
  currency: GoalCurrency;
  targetAmount: string;
  deadline: string | null;
  expectedReturnPercent: string;
  monthlyContribution: string | null;
  createdAt: string;
  asOf: string;
  progress: {
    /** The portfolio's value in the goal's currency; null when nothing could be valued. */
    current: string | null;
    /** False when an asset without a price or rate is left out of the value. */
    complete: boolean;
    /** The real share of the target, above 100 once it is passed. */
    percent: string | null;
    remaining: string | null;
    /**
     * Held assets valued at a stored market price older than 2 hours. Absent in an answer kept
     * from before the server sent it.
     */
    stalePrices?: number;
  };
  status: GoalStatus;
  /** Empty while the portfolio has no value in the goal's currency. */
  scenarios: GoalScenario[];
  /** Absent in an answer kept from before the server sent it. */
  real?: GoalRealReadings;
}

export interface GoalList {
  asOf: string;
  items: Goal[];
}

/** What the owner enters; amounts are exact decimal strings. */
export interface GoalTerms {
  name: string;
  currency: GoalCurrency;
  targetAmount: string;
  deadline: string | null;
  expectedReturnPercent: string;
  monthlyContribution: string | null;
}

/** What a goal with these terms would show now (GOAL-PREVIEW); nothing is saved. */
export type GoalPreview = Omit<Goal, 'id' | 'name' | 'createdAt'>;

/**
 * GOAL-CHART: the three return cases month by month from today, to the deadline (its own last
 * point, equal to the goal's projection there) or, without one, a year past the month the base
 * case gets there. Projections in the goal's currency; empty while the portfolio has no value in
 * it or once the deadline has passed.
 */
export interface GoalForecast {
  currency: GoalCurrency;
  asOf: string;
  /** False when the forecast excludes assets without a price or rate. */
  complete: boolean;
  /** Held assets valued at a stored market price older than 2 hours, as the forecast valued them. */
  stalePrices?: number;
  points: GoalForecastPoint[];
  /** GOAL-REAL: the same cases in today's money, per basis; null without an inflation figure. */
  real?: { official: GoalForecastPoint[] | null; personal: GoalForecastPoint[] | null };
}

export type GoalForecastPoint = { on: string } & Record<ScenarioKey, string | null>;

export interface NewGoal extends GoalTerms {
  /** One per attempt; a retry of the same attempt returns the goal it made. */
  requestId: string;
}

const path = '/goals';
const one = (id: string) => `${path}/${encodeURIComponent(id)}`;

export interface GoalInsights {
  currency: GoalCurrency;
  asOf: string;
  complete: boolean;
  months: { month: string; net: string | null }[];
  averages: Record<3 | 6 | 12, string | null>;
  paceStatus: 'insufficient-history' | 'missing-value' | 'projected' | 'beyond-horizon';
  paceReachedOn: string | null;
  /** GOAL-REAL: the same pace judged in today's money, per basis. */
  real?: {
    official: { paceStatus: GoalInsights['paceStatus']; paceReachedOn: string | null } | null;
    personal: { paceStatus: GoalInsights['paceStatus']; paceReachedOn: string | null } | null;
  };
  growth: {
    from: string | null;
    contributions: string | null;
    market: string | null;
    // Why market is unknown; absent in an answer saved before it was added.
    marketMissing?: MarketMissing | null;
    // The start values an asset at its nearest trade or later price; absent in an answer saved before it.
    estimated?: boolean;
    total: string | null;
  };
}

export const goalsApi = {
  // The server reads the portfolio history for these, so they wait for the same rebuild.
  insights: (id: string) =>
    apiClient
      .get<GoalInsights>(`/goals/${id}/insights`, { timeout: HISTORY_TIMEOUT_MS })
      .then((response) => response.data),
  list: async (): Promise<GoalList> => (await apiClient.get<GoalList>(path)).data,

  get: async (id: string): Promise<Goal> => (await apiClient.get<Goal>(one(id))).data,

  forecast: async (id: string): Promise<GoalForecast> =>
    (await apiClient.get<GoalForecast>(`${one(id)}/forecast`)).data,

  /**
   * A read sent as a POST so the sums stay out of the address; it saves nothing. The edit dialog
   * names its goal, so a date the goal keeps is judged as saving would judge it.
   */
  preview: async (
    terms: Omit<GoalTerms, 'name'> & { goalId?: string },
    signal?: AbortSignal,
  ): Promise<GoalPreview> =>
    (await apiClient.post<GoalPreview>(`${path}/preview`, terms, { signal, changesNothing: true }))
      .data,

  create: async (goal: NewGoal): Promise<Goal> => (await apiClient.post<Goal>(path, goal)).data,

  update: async (id: string, terms: GoalTerms): Promise<Goal> =>
    (await apiClient.put<Goal>(one(id), terms)).data,

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(one(id));
  },
};

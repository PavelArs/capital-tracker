import apiClient from './client';
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
    percent: string | null;
    remaining: string | null;
  };
  status: GoalStatus;
  /** Empty while the portfolio has no value in the goal's currency. */
  scenarios: GoalScenario[];
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

export interface NewGoal extends GoalTerms {
  /** One per attempt; a retry of the same attempt returns the goal it made. */
  requestId: string;
}

const path = '/goals';
const one = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const goalsApi = {
  list: async (): Promise<GoalList> => (await apiClient.get<GoalList>(path)).data,

  get: async (id: string): Promise<Goal> => (await apiClient.get<Goal>(one(id))).data,

  create: async (goal: NewGoal): Promise<Goal> => (await apiClient.post<Goal>(path, goal)).data,

  update: async (id: string, terms: GoalTerms): Promise<Goal> =>
    (await apiClient.put<Goal>(one(id), terms)).data,

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(one(id));
  },
};

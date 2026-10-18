import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

// DEP-ACCRUAL, DEP-CHECK: bank deposits the owner entered once; interest and value are computed.

export type DepositCurrency = AccountingCurrency;
/** A term deposit runs to an end date at a rate; an account has a balance and no term (DEP-ACCOUNT). */
export type DepositKind = 'term-deposit' | 'account';
/** Quarterly is only on deposits made before it was removed from the form. */
export type PayoutSchedule = 'daily' | 'monthly' | 'quarterly' | 'at-end';
export type DayBasis = 'actual-365' | 'actual-actual';
export type EarlyClose = 'forfeits-interest' | 'keeps-interest';
export type DepositStatus = 'active' | 'matured' | 'closed';
export type MovementKind = 'topup' | 'withdrawal' | 'interest-payout';
export type Values = Record<AccountingCurrency, string | null>;

export interface DepositCheck {
  checkedOn: string;
  bankBalance: string;
  /** What the bank's screen should show: with a capitalizing deposit, without the interest earned since the last interest date. Null for an account whose interest is missing (DEP-ACCOUNT). */
  calculated: string | null;
  difference: string | null;
}

/**
 * A deposit after inflation, in its own currency (INFL-DEPOSIT): the yearly rate less the
 * inflation of a year, and what it earned less the inflation on all the money put in. Each is
 * null where the inflation figures do not reach.
 */
export interface DepositReal {
  inflationPercent: string | null;
  /** Null unless the deposit is active. */
  ratePercent: string | null;
  gain: string | null;
  /** A factor reaches past the latest published month or rests on the owner's own rate. */
  estimated: boolean;
  /** Own-rate reading only: false when the currency has no own rate and this is the official one. */
  ownRate?: boolean;
}

/** One month of a deposit's life (INFL-DEPOSIT-CHART); the real figures are in the money of the day asked. */
export interface DepositChartPoint {
  date: string;
  balance: string;
  invested: string;
  real: {
    official: { balance: string; invested: string; estimated: boolean } | null;
    personal: { balance: string; invested: string; estimated: boolean } | null;
  };
}

export interface Deposit {
  id: string;
  /** Absent in an answer the browser saved before accounts existed: a term deposit. */
  kind?: DepositKind;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: PayoutSchedule;
  capitalized: boolean;
  dayBasis: DayBasis;
  earlyClose: EarlyClose;
  /** Null for an account with no rate entered: no interest is counted for it, and none is shown as a rate. */
  ratePercent: string | null;
  status: DepositStatus;
  closedOn: string | null;
  principal: string;
  /**
   * True for an account with no rate in force on the day: its interest is unknown, not zero, so
   * the interest figures below are null and the balance is only what was put in less what was
   * taken out. Absent in an answer the browser saved before this.
   */
  interestMissing?: boolean;
  accrued: string | null;
  due: string | null;
  balance: string;
  /** All the interest earned, posted or not. Absent in an answer the browser saved before this. */
  interestEarned?: string | null;
  real?: { official: DepositReal | null; personal: DepositReal | null };
  values: Values;
  nextPayout: { date: string; interest: string; treatment: 'capitalized' | 'payable' } | null;
  atMaturity: {
    date: string;
    balance: string;
    interest: string;
    /** The end balance in today's money by each reading; absent in an answer saved before this. */
    inTodaysMoney?: {
      official: { amount: string; estimated: boolean } | null;
      personal: { amount: string; estimated: boolean } | null;
    };
  } | null;
  lastCheck: DepositCheck | null;
}

export interface DepositDetail extends Deposit {
  asOf: string;
  rates: { effectiveFrom: string; ratePercent: string }[];
  movements: {
    id: string;
    date: string;
    kind: MovementKind;
    amount: string;
    comment: string | null;
  }[];
  periods: {
    from: string;
    to: string;
    interest: string;
    treatment: 'capitalized' | 'payable';
    /** The interest less the inflation on the money held at the period's start. */
    afterInflation?: { official: string | null; personal: string | null };
  }[];
  interestPosted: string | null;
  interestPaidOut: string;
  interestForfeited: string;
  checks: (DepositCheck & { id: string })[];
  /** Monthly from the start to the day asked; absent in an answer saved before the chart. */
  chart?: DepositChartPoint[];
}

export interface DepositList {
  asOf: string;
  items: Deposit[];
  /** Accounts holding money with no rate entered, whose interest the totals leave out. */
  interestMissingCount?: number;
  totals: Values;
}

export interface NewDeposit {
  /** One per attempt; a retry of the same attempt returns the deposit it made. */
  requestId: string;
  kind: DepositKind;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: PayoutSchedule;
  capitalized: boolean;
  dayBasis: DayBasis;
  earlyClose: EarlyClose;
  ratePercent: string | null;
  amount: string;
}

/** The terms of a deposit being entered: what adding it sends, without the request id. */
export type DepositTerms = Omit<NewDeposit, 'requestId'>;

/** DEP-PREVIEW: what a deposit being entered would come to, as exact decimal strings. */
export interface DepositPreview {
  /** The balance and its interest on the end date; null for a deposit without a term. */
  atMaturity: { date: string; balance: string; interest: string } | null;
  /** The first interest date and its interest; null when there is none. */
  firstPayout: { date: string; interest: string; treatment: 'capitalized' | 'payable' } | null;
}

const path = '/deposits';
const one = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const depositsApi = {
  list: async (): Promise<DepositList> => (await apiClient.get<DepositList>(path)).data,

  get: async (id: string): Promise<DepositDetail> =>
    (await apiClient.get<DepositDetail>(one(id))).data,

  create: async (deposit: NewDeposit): Promise<DepositDetail> =>
    (await apiClient.post<DepositDetail>(path, deposit)).data,

  /** Computes the figures from the terms; the server keeps nothing, so kept reads stay. */
  preview: async (terms: DepositTerms, signal?: AbortSignal): Promise<DepositPreview> =>
    (
      await apiClient.post<DepositPreview>(`${path}/preview`, terms, {
        signal,
        changesNothing: true,
      })
    ).data,

  remove: async (id: string): Promise<void> => {
    await apiClient.delete(one(id));
  },

  addMovement: async (
    id: string,
    movement: {
      requestId: string;
      date: string;
      kind: MovementKind;
      amount: string;
      comment?: string;
    },
  ): Promise<DepositDetail> =>
    (await apiClient.post<DepositDetail>(`${one(id)}/movements`, movement)).data,

  removeMovement: async (id: string, movementId: string): Promise<DepositDetail> =>
    (
      await apiClient.delete<DepositDetail>(
        `${one(id)}/movements/${encodeURIComponent(movementId)}`,
      )
    ).data,

  addRate: async (
    id: string,
    change: { effectiveFrom: string; ratePercent: string },
  ): Promise<DepositDetail> =>
    (await apiClient.post<DepositDetail>(`${one(id)}/rates`, change)).data,

  addCheck: async (
    id: string,
    check: { requestId: string; checkedOn: string; bankBalance: string },
  ): Promise<DepositDetail> =>
    (await apiClient.post<DepositDetail>(`${one(id)}/checks`, check)).data,
};

import apiClient from './client';
import type { AccountingCurrency } from './portfolio-valuation.api';

// DEP-ACCRUAL, DEP-CHECK: bank deposits the owner entered once; interest and value are computed.

export type DepositCurrency = AccountingCurrency;
export type PayoutSchedule = 'monthly' | 'quarterly' | 'at-end';
export type DayBasis = 'actual-365' | 'actual-actual';
export type EarlyClose = 'forfeits-interest' | 'keeps-interest';
export type DepositStatus = 'active' | 'matured' | 'closed';
export type MovementKind = 'topup' | 'withdrawal' | 'interest-payout';
export type Values = Record<AccountingCurrency, string | null>;

export interface DepositCheck {
  checkedOn: string;
  bankBalance: string;
  /** What the bank has posted: the balance without interest earned since the last interest date. */
  calculated: string;
  difference: string;
}

export interface Deposit {
  id: string;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: PayoutSchedule;
  capitalized: boolean;
  dayBasis: DayBasis;
  earlyClose: EarlyClose;
  ratePercent: string;
  status: DepositStatus;
  closedOn: string | null;
  principal: string;
  accrued: string;
  due: string;
  balance: string;
  values: Values;
  nextPayout: { date: string; interest: string; treatment: 'capitalized' | 'payable' } | null;
  atMaturity: { date: string; balance: string; interest: string } | null;
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
  }[];
  interestPosted: string;
  interestPaidOut: string;
  interestForfeited: string;
  checks: (DepositCheck & { id: string })[];
}

export interface DepositList {
  asOf: string;
  items: Deposit[];
  totals: Values;
}

export interface NewDeposit {
  /** One per attempt; a retry of the same attempt returns the deposit it made. */
  requestId: string;
  name: string;
  bank: string;
  currency: DepositCurrency;
  startDate: string;
  endDate: string | null;
  payout: PayoutSchedule;
  capitalized: boolean;
  dayBasis: DayBasis;
  earlyClose: EarlyClose;
  ratePercent: string;
  amount: string;
}

const path = '/deposits';
const one = (id: string) => `${path}/${encodeURIComponent(id)}`;

export const depositsApi = {
  list: async (): Promise<DepositList> => (await apiClient.get<DepositList>(path)).data,

  get: async (id: string): Promise<DepositDetail> =>
    (await apiClient.get<DepositDetail>(one(id))).data,

  create: async (deposit: NewDeposit): Promise<DepositDetail> =>
    (await apiClient.post<DepositDetail>(path, deposit)).data,

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

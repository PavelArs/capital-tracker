import apiClient from './client';

// BROKER-SETUP: one read-only T-Bank token makes and connects a broker account for each T-Bank
// account the owner picks. The token goes to the server with each request and is never kept here.

export interface TBankAccountOption {
  /** T-Bank's own account number. */
  id: string;
  name: string;
  /** An Invest Box (Инвесткопилка): T-Bank gives no portfolio for it. */
  investBox: boolean;
  /** Already read by one of the owner's broker accounts. */
  connected: boolean;
}

export interface TBankPick {
  brokerAccountId: string;
  /** Names the broker account this pick makes, so a repeat finds it again. */
  requestId: string;
  name: string;
}

export interface TBankConnection {
  accountId: string;
  name: string;
  brokerAccountId: string;
  /** False when the account was made by an earlier request with the same id. */
  created: boolean;
}

export const brokersApi = {
  /** The open T-Bank accounts a read-only token reaches. Nothing is stored. */
  tbankAccounts: async (token: string): Promise<TBankAccountOption[]> => {
    const response = await apiClient.post<{ accounts: TBankAccountOption[] }>(
      '/brokers/tbank/accounts',
      { token },
      { changesNothing: true },
    );
    return response.data.accounts;
  },

  connectTBank: async (token: string, accounts: TBankPick[]): Promise<TBankConnection[]> => {
    const response = await apiClient.post<{ connections: TBankConnection[] }>(
      '/brokers/tbank/connect',
      { token, accounts },
    );
    return response.data.connections;
  },
};

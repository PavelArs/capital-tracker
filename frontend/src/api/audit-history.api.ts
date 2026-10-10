import apiClient from './client';

// GET /accounting/audit-history (audit-history, BR 14): every stored version of the owner's
// journals, newest first, each compared with the version before it.
export type AuditEntity =
  | 'trade'
  | 'transfer'
  | 'swap'
  | 'reward'
  | 'flow'
  | 'price'
  | 'classification';
export type AuditChange = 'created' | 'changed' | 'deleted';
/** The owner, an import of a CSV file, or the app itself (wallet sync, own-transfer links). */
export type AuditActor = 'owner' | 'csv' | 'automatic';

export interface AuditValue {
  kind: 'text' | 'quantity' | 'usd' | 'moment';
  value: string;
  /** What a quantity counts: "BTC", "RUB". */
  unit: string | null;
}

export interface AuditField {
  label: string;
  /** Null when the version brought the value in. */
  before: AuditValue | null;
  /** Null when the version took the value away. */
  after: AuditValue | null;
}

export interface AuditEvent {
  id: string;
  /** When the version was written. */
  at: string;
  entity: AuditEntity;
  entityId: string;
  version: number;
  change: AuditChange;
  actor: AuditActor;
  title: string;
  asset: string | null;
  account: string | null;
  /** When the operation itself happened. */
  occurredAt: string | null;
  fields: AuditField[];
}

export interface AuditHistory {
  at: string;
  events: AuditEvent[];
  /** Pass back as `before` for the next older page. */
  next: string | null;
}

export interface AuditQuery {
  entity?: AuditEntity;
  change?: AuditChange;
  actor?: AuditActor;
  /** Inclusive UTC days, "YYYY-MM-DD". */
  from?: string;
  to?: string;
}

export const auditHistoryApi = {
  list: async (query: AuditQuery, before?: string): Promise<AuditHistory> => {
    const response = await apiClient.get<AuditHistory>('/accounting/audit-history', {
      params: { ...query, ...(before ? { before } : {}) },
    });
    return response.data;
  },
};

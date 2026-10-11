export interface CarryInOrigin {
  accountId: string;
  requestId: string;
  originKind: 'known-cost-carry-in';
  coverageFrom: string;
  openingRevision: number;
  lotCount: number;
  carryInCostUsd: string;
  createdAt: string;
}

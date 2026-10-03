// RED stub: replaced by the implementation in task 2.3.
export const PAGE_SIZE = 25;
export type ProviderFailure = 'rate_limited' | 'unavailable' | 'invalid_response';
export type Direction = 'in' | 'out' | 'self';
export interface ChainObservation {
  txid: string;
  blockHeight: number;
  blockHash: string;
  blockTime: string;
  receivedSats: bigint;
  sentSats: bigint;
  feeSats: bigint;
  direction: Direction;
  raw: Record<string, unknown>;
}
export type PageResult =
  | { ok: true; transactions: ChainObservation[] }
  | { ok: false; reason: ProviderFailure };

export function formatSats(_value: bigint): string {
  return '';
}

export class EsploraClient {
  constructor(_options: { baseUrl?: string; timeoutMs?: number; pauseMs?: number } = {}) {}

  async page(_address: string, _afterTxid: string | null): Promise<PageResult> {
    return { ok: true, transactions: [] };
  }
}

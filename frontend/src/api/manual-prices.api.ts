import type { Instrument } from './accounting.api';
import apiClient from './client';

export interface SetPriceCommand {
  requestId: string;
  expectedRevision: number;
  observedAt: string;
  priceUsd: string;
  assertReviewed: true;
}

export interface VoidPriceCommand {
  requestId: string;
  expectedRevision: number;
  observedAt: string;
  assertReviewed: true;
}

export type PriceReceipt = {
  instrumentId: string;
  revision: number;
  requestId: string;
  observedAt: string;
  createdAt: string;
  source: 'manual';
  quoteCurrency: 'USD';
} & ({ kind: 'set'; priceUsd: string } | { kind: 'void'; priceUsd: null });

export interface PriceBook {
  instrument: Instrument;
  currentRevision: number;
  source: 'manual';
  quoteCurrency: 'USD';
  items: PriceReceipt[];
  nextOffset: number | null;
}

export interface PriceHistory {
  instrumentId: string;
  observedAt: string;
  source: 'manual';
  quoteCurrency: 'USD';
  items: PriceReceipt[];
  nextBeforeRevision: number | null;
}

const path = (instrumentId: string) =>
  `/accounting/instruments/${encodeURIComponent(instrumentId)}/usd-prices`;

export const manualPricesApi = {
  list: async (instrumentId: string, offset = 0, revision?: number): Promise<PriceBook> =>
    (
      await apiClient.get<PriceBook>(path(instrumentId), {
        params: { limit: 50, offset, ...(revision === undefined ? {} : { revision }) },
      })
    ).data,
  set: async (instrumentId: string, command: SetPriceCommand): Promise<PriceReceipt> =>
    (await apiClient.post<PriceReceipt>(path(instrumentId), command)).data,
  void: async (instrumentId: string, command: VoidPriceCommand): Promise<PriceReceipt> =>
    (await apiClient.post<PriceReceipt>(`${path(instrumentId)}/void`, command)).data,
  history: async (
    instrumentId: string,
    observedAt: string,
    beforeRevision?: number,
  ): Promise<PriceHistory> =>
    (
      await apiClient.get<PriceHistory>(`${path(instrumentId)}/history`, {
        params: {
          observedAt,
          limit: 10,
          ...(beforeRevision === undefined ? {} : { beforeRevision }),
        },
      })
    ).data,
};

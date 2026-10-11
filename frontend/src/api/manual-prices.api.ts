import type { Instrument } from './accounting.api';
import apiClient from './client';

export interface SetPriceCommand {
  requestId: string;
  expectedRevision: number;
  observedAt: string;
  priceUsd: string;
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
  instrument: Pick<Instrument, 'id' | 'name' | 'symbol' | 'namespace'>;
  currentRevision: number;
  source: 'manual';
  quoteCurrency: 'USD';
  items: PriceReceipt[];
  nextOffset: number | null;
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
};

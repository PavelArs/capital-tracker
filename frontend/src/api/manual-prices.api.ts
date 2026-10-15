import type { Instrument } from './accounting.api';
import apiClient from './client';
import type { ValuationCurrency } from './portfolio-assets.api';

/**
 * A hand price of one unit. It keeps the currency it was set in (AST-MANUAL-VALUE): a value of
 * 500,000 RUB stays 500,000 RUB whatever the dollar rate does.
 */
export interface SetPriceCommand {
  requestId: string;
  expectedRevision: number;
  observedAt: string;
  price: string;
  currency: ValuationCurrency;
  assertReviewed: true;
}

/** `price` is in `quoteCurrency`; `priceUsd` repeats it for a USD price and is null otherwise. */
export type PriceReceipt = {
  instrumentId: string;
  revision: number;
  requestId: string;
  observedAt: string;
  createdAt: string;
  source: 'manual';
  quoteCurrency: ValuationCurrency;
  priceUsd: string | null;
} & ({ kind: 'set'; price: string } | { kind: 'void'; price: null });

export interface PriceBook {
  instrument: Pick<Instrument, 'id' | 'name' | 'symbol' | 'namespace'>;
  currentRevision: number;
  source: 'manual';
  /** The currency the asset is valued in. */
  quoteCurrency: ValuationCurrency;
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

import apiClient from './client';
import type { ValuationCurrency } from './portfolio-assets.api';

/**
 * PROP-DETAILS: what the owner keeps with a property besides its estimate. The rent is a month's
 * rent in `currency`, the one the property is valued in, and is shown as entered; it is not part
 * of any value. A property with neither has no record.
 */
export interface PropertyDetails {
  instrumentId: string;
  monthlyRent: string | null;
  currency: ValuationCurrency;
  note: string | null;
  updatedAt: string | null;
}

/** The whole record: sending it again changes nothing, and null for both clears it. */
export interface PropertyDetailsInput {
  monthlyRent: string | null;
  note: string | null;
}

export const propertyDetailsApi = {
  list: async (): Promise<PropertyDetails[]> =>
    (await apiClient.get<{ items: PropertyDetails[] }>('/accounting/property-details')).data.items,
  set: async (instrumentId: string, input: PropertyDetailsInput): Promise<PropertyDetails> =>
    (
      await apiClient.put<PropertyDetails>(
        `/accounting/instruments/${encodeURIComponent(instrumentId)}/property`,
        input,
      )
    ).data,
};

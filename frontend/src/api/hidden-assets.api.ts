import apiClient from './client';

/** ASSET-HIDE: an asset the owner hid from the portfolio, its totals and its history. */
export interface HiddenAsset {
  instrumentId: string;
  name: string;
  symbol: string | null;
  hiddenAt: string;
}

const path = '/accounting/hidden-assets';

export const hiddenAssetsApi = {
  list: async (): Promise<HiddenAsset[]> =>
    (await apiClient.get<{ items: HiddenAsset[] }>(path)).data.items,

  hide: async (instrumentId: string): Promise<HiddenAsset> =>
    (await apiClient.put<HiddenAsset>(`${path}/${encodeURIComponent(instrumentId)}`)).data,

  show: async (instrumentId: string): Promise<void> => {
    await apiClient.delete(`${path}/${encodeURIComponent(instrumentId)}`);
  },
};

import apiClient from './client';
import type { Asset, CreateAssetDto, UpdateAssetDto } from '@shared/types';

export const assetsApi = {
  getAll: async (): Promise<Asset[]> => {
    const response = await apiClient.get<Asset[]>('/assets');
    return response.data;
  },

  getById: async (id: string): Promise<Asset> => {
    const response = await apiClient.get<Asset>(`/assets/${id}`);
    return response.data;
  },

  create: async (data: CreateAssetDto): Promise<Asset> => {
    const response = await apiClient.post<Asset>('/assets', data);
    return response.data;
  },

  update: async (id: string, data: UpdateAssetDto): Promise<Asset> => {
    const response = await apiClient.patch<Asset>(`/assets/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/assets/${id}`);
  },
};

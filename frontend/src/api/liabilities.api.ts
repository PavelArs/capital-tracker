import apiClient from './client';
import type { Liability, CreateLiabilityDto, UpdateLiabilityDto } from '@shared/types';

export const liabilitiesApi = {
  getAll: async (): Promise<Liability[]> => {
    const response = await apiClient.get<Liability[]>('/liabilities');
    return response.data;
  },

  getById: async (id: string): Promise<Liability> => {
    const response = await apiClient.get<Liability>(`/liabilities/${id}`);
    return response.data;
  },

  create: async (data: CreateLiabilityDto): Promise<Liability> => {
    const response = await apiClient.post<Liability>('/liabilities', data);
    return response.data;
  },

  update: async (id: string, data: UpdateLiabilityDto): Promise<Liability> => {
    const response = await apiClient.patch<Liability>(`/liabilities/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/liabilities/${id}`);
  },
};

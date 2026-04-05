import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from './client';
import { liabilitiesApi } from './liabilities.api';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('liabilitiesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all liabilities', async () => {
      const mockLiabilities = [
        { id: '1', name: 'Rent', amount: 1500 },
        { id: '2', name: 'Netflix', amount: 15 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockLiabilities });

      const result = await liabilitiesApi.getAll();

      expect(apiClient.get).toHaveBeenCalledWith('/liabilities');
      expect(result).toEqual(mockLiabilities);
    });

    it('should return empty array when no liabilities', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const result = await liabilitiesApi.getAll();

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should fetch liability by id', async () => {
      const mockLiability = { id: '1', name: 'Rent', amount: 1500 };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockLiability });

      const result = await liabilitiesApi.getById('1');

      expect(apiClient.get).toHaveBeenCalledWith('/liabilities/1');
      expect(result).toEqual(mockLiability);
    });
  });

  describe('create', () => {
    it('should create a new liability', async () => {
      const newLiability = { name: 'Car Insurance', amount: 200, currencyId: 'usd' };
      const createdLiability = { id: '3', ...newLiability };
      vi.mocked(apiClient.post).mockResolvedValue({ data: createdLiability });

      const result = await liabilitiesApi.create(newLiability as any);

      expect(apiClient.post).toHaveBeenCalledWith('/liabilities', newLiability);
      expect(result).toEqual(createdLiability);
    });
  });

  describe('update', () => {
    it('should update an existing liability', async () => {
      const updateData = { name: 'Updated Rent', amount: 1600 };
      const updatedLiability = { id: '1', ...updateData };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: updatedLiability });

      const result = await liabilitiesApi.update('1', updateData as any);

      expect(apiClient.patch).toHaveBeenCalledWith('/liabilities/1', updateData);
      expect(result).toEqual(updatedLiability);
    });
  });

  describe('delete', () => {
    it('should delete a liability', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined });

      await liabilitiesApi.delete('1');

      expect(apiClient.delete).toHaveBeenCalledWith('/liabilities/1');
    });
  });
});

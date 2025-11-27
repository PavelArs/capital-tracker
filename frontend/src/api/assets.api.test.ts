import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assetsApi } from './assets.api';
import apiClient from './client';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('assetsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('should fetch all assets', async () => {
      const mockAssets = [
        { id: '1', name: 'Asset 1', amount: 1000 },
        { id: '2', name: 'Asset 2', amount: 2000 },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockAssets });

      const result = await assetsApi.getAll();

      expect(apiClient.get).toHaveBeenCalledWith('/assets');
      expect(result).toEqual(mockAssets);
    });

    it('should return empty array when no assets', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const result = await assetsApi.getAll();

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should fetch asset by id', async () => {
      const mockAsset = { id: '1', name: 'Asset 1', amount: 1000 };
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockAsset });

      const result = await assetsApi.getById('1');

      expect(apiClient.get).toHaveBeenCalledWith('/assets/1');
      expect(result).toEqual(mockAsset);
    });
  });

  describe('create', () => {
    it('should create a new asset', async () => {
      const newAsset = { name: 'New Asset', amount: 5000, currencyId: 'usd' };
      const createdAsset = { id: '3', ...newAsset };
      vi.mocked(apiClient.post).mockResolvedValue({ data: createdAsset });

      const result = await assetsApi.create(newAsset as any);

      expect(apiClient.post).toHaveBeenCalledWith('/assets', newAsset);
      expect(result).toEqual(createdAsset);
    });
  });

  describe('update', () => {
    it('should update an existing asset', async () => {
      const updateData = { name: 'Updated Asset', amount: 7500 };
      const updatedAsset = { id: '1', ...updateData };
      vi.mocked(apiClient.patch).mockResolvedValue({ data: updatedAsset });

      const result = await assetsApi.update('1', updateData as any);

      expect(apiClient.patch).toHaveBeenCalledWith('/assets/1', updateData);
      expect(result).toEqual(updatedAsset);
    });
  });

  describe('delete', () => {
    it('should delete an asset', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined });

      await assetsApi.delete('1');

      expect(apiClient.delete).toHaveBeenCalledWith('/assets/1');
    });
  });
});

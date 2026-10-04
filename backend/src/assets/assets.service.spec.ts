import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Asset, AssetCategory, AssetType } from '../entities/asset.entity';
import { AssetNotFoundException } from '../shared/exceptions';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

describe('AssetsService', () => {
  let service: AssetsService;
  let repository: jest.Mocked<Repository<Asset>>;

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockUserId = 'user-123';
  const mockAssetId = 'asset-456';

  const mockAsset: Asset = {
    id: mockAssetId,
    userId: mockUserId,
    name: 'Test Asset',
    assetType: AssetType.STOCK,
    category: AssetCategory.INVESTMENTS,
    incomeType: null,
    amount: 10000,
    currencyId: 'currency-1',
    currency: { id: 'currency-1', code: 'USD', name: 'US Dollar', symbol: '$' } as any,
    date: new Date('2024-01-15'),
    description: 'Test description',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: getRepositoryToken(Asset),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
    repository = module.get(getRepositoryToken(Asset));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new asset successfully', async () => {
      const createDto: CreateAssetDto = {
        name: 'New Asset',
        assetType: AssetType.STOCK,
        category: AssetCategory.INVESTMENTS,
        amount: 5000,
        currencyId: 'currency-1',
        date: '2024-01-15',
        description: 'A new investment',
      };

      const createdAsset = { ...mockAsset, ...createDto, id: 'new-asset-id' };
      repository.create.mockReturnValue(createdAsset as any);
      repository.save.mockResolvedValue(createdAsset as any);

      const result = await service.create(mockUserId, createDto);

      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        userId: mockUserId,
      });
      expect(repository.save).toHaveBeenCalledWith(createdAsset);
      expect(result).toEqual(createdAsset);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAll', () => {
    it('should return all assets for a user', async () => {
      const assets = [mockAsset, { ...mockAsset, id: 'asset-789', name: 'Another Asset' }];
      repository.find.mockResolvedValue(assets as any);

      const result = await service.findAll(mockUserId);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        relations: { currency: true },
        order: { date: 'DESC' },
      });
      expect(result).toEqual(assets);
    });

    it('should return empty array when user has no assets', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findAll(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return an asset when found', async () => {
      repository.findOne.mockResolvedValue(mockAsset as any);

      const result = await service.findOne(mockAssetId, mockUserId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockAssetId, userId: mockUserId },
        relations: { currency: true },
      });
      expect(result).toEqual(mockAsset);
    });

    it('should throw AssetNotFoundException when asset not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id', mockUserId)).rejects.toThrow(
        AssetNotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an asset successfully', async () => {
      const updateDto: UpdateAssetDto = {
        name: 'Updated Asset Name',
        amount: 15000,
      };

      repository.findOne.mockResolvedValue(mockAsset as any);
      const updatedAsset = { ...mockAsset, ...updateDto };
      repository.save.mockResolvedValue(updatedAsset as any);

      const result = await service.update(mockAssetId, mockUserId, updateDto);

      expect(repository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateDto.name);
      expect(result.amount).toBe(updateDto.amount);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { assetId: mockAssetId },
        'Asset updated successfully',
      );
    });

    it('should throw AssetNotFoundException when updating non-existent asset', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(AssetNotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove an asset successfully', async () => {
      repository.findOne.mockResolvedValue(mockAsset as any);
      repository.remove.mockResolvedValue(mockAsset as any);

      await service.remove(mockAssetId, mockUserId);

      expect(repository.remove).toHaveBeenCalledWith(mockAsset);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { assetId: mockAssetId },
        'Asset removed successfully',
      );
    });

    it('should throw AssetNotFoundException when removing non-existent asset', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id', mockUserId)).rejects.toThrow(
        AssetNotFoundException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Liability, LiabilityCategory, LiabilityFrequency } from '../entities/liability.entity';
import { LiabilityNotFoundException } from '../shared/exceptions';
import { CreateLiabilityDto } from './dto/create-liability.dto';
import { UpdateLiabilityDto } from './dto/update-liability.dto';
import { LiabilitiesService } from './liabilities.service';

describe('LiabilitiesService', () => {
  let service: LiabilitiesService;
  let repository: jest.Mocked<Repository<Liability>>;

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockUserId = 'user-123';
  const mockLiabilityId = 'liability-456';

  const mockLiability: Liability = {
    id: mockLiabilityId,
    userId: mockUserId,
    name: 'Test Liability',
    category: LiabilityCategory.SUBSCRIPTIONS,
    amount: 100,
    currencyId: 'currency-1',
    currency: { id: 'currency-1', code: 'USD', name: 'US Dollar', symbol: '$' } as any,
    date: new Date('2024-01-15'),
    description: 'Test subscription',
    frequency: LiabilityFrequency.MONTHLY,
    deadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiabilitiesService,
        {
          provide: getRepositoryToken(Liability),
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

    service = module.get<LiabilitiesService>(LiabilitiesService);
    repository = module.get(getRepositoryToken(Liability));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new liability successfully', async () => {
      const createDto: CreateLiabilityDto = {
        name: 'Netflix Subscription',
        category: LiabilityCategory.SUBSCRIPTIONS,
        amount: 15.99,
        currencyId: 'currency-1',
        date: '2024-01-15',
        description: 'Monthly streaming subscription',
        frequency: LiabilityFrequency.MONTHLY,
      };

      const createdLiability = { ...mockLiability, ...createDto, id: 'new-liability-id' };
      repository.create.mockReturnValue(createdLiability as any);
      repository.save.mockResolvedValue(createdLiability as any);

      const result = await service.create(mockUserId, createDto);

      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        userId: mockUserId,
      });
      expect(repository.save).toHaveBeenCalledWith(createdLiability);
      expect(result).toEqual(createdLiability);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should create a liability with a deadline for loans', async () => {
      const createDto: CreateLiabilityDto = {
        name: 'Car Loan',
        category: LiabilityCategory.LOANS,
        amount: 500,
        currencyId: 'currency-1',
        date: '2024-01-15',
        description: 'Monthly car payment',
        deadline: '2027-01-15',
      };

      const createdLiability = { ...mockLiability, ...createDto, id: 'new-loan-id' };
      repository.create.mockReturnValue(createdLiability as any);
      repository.save.mockResolvedValue(createdLiability as any);

      const result = await service.create(mockUserId, createDto);

      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        userId: mockUserId,
      });
      expect(result.category).toBe(LiabilityCategory.LOANS);
    });
  });

  describe('findAll', () => {
    it('should return all liabilities for a user', async () => {
      const liabilities = [
        mockLiability,
        { ...mockLiability, id: 'liability-789', name: 'Another Liability' },
      ];
      repository.find.mockResolvedValue(liabilities as any);

      const result = await service.findAll(mockUserId);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        relations: ['currency'],
        order: { date: 'DESC' },
      });
      expect(result).toEqual(liabilities);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when user has no liabilities', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findAll(mockUserId);

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('findOne', () => {
    it('should return a liability when found', async () => {
      repository.findOne.mockResolvedValue(mockLiability as any);

      const result = await service.findOne(mockLiabilityId, mockUserId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockLiabilityId, userId: mockUserId },
        relations: ['currency'],
      });
      expect(result).toEqual(mockLiability);
    });

    it('should throw LiabilityNotFoundException when liability not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id', mockUserId)).rejects.toThrow(
        LiabilityNotFoundException,
      );
    });

    it('should throw LiabilityNotFoundException when liability belongs to different user', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockLiabilityId, 'different-user')).rejects.toThrow(
        LiabilityNotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a liability successfully', async () => {
      const updateDto: UpdateLiabilityDto = {
        name: 'Updated Subscription',
        amount: 19.99,
      };

      repository.findOne.mockResolvedValue(mockLiability as any);
      const updatedLiability = { ...mockLiability, ...updateDto };
      repository.save.mockResolvedValue(updatedLiability as any);

      const result = await service.update(mockLiabilityId, mockUserId, updateDto);

      expect(repository.save).toHaveBeenCalled();
      expect(result.name).toBe(updateDto.name);
      expect(result.amount).toBe(updateDto.amount);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { liabilityId: mockLiabilityId },
        'Liability updated successfully',
      );
    });

    it('should update only provided fields', async () => {
      const updateDto: UpdateLiabilityDto = {
        description: 'Updated description only',
      };

      repository.findOne.mockResolvedValue(mockLiability as any);
      const updatedLiability = { ...mockLiability, ...updateDto };
      repository.save.mockResolvedValue(updatedLiability as any);

      const result = await service.update(mockLiabilityId, mockUserId, updateDto);

      expect(result.description).toBe(updateDto.description);
      expect(result.name).toBe(mockLiability.name);
    });

    it('should throw LiabilityNotFoundException when updating non-existent liability', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(LiabilityNotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove a liability successfully', async () => {
      repository.findOne.mockResolvedValue(mockLiability as any);
      repository.remove.mockResolvedValue(mockLiability as any);

      await service.remove(mockLiabilityId, mockUserId);

      expect(repository.remove).toHaveBeenCalledWith(mockLiability);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { liabilityId: mockLiabilityId },
        'Liability removed successfully',
      );
    });

    it('should throw LiabilityNotFoundException when removing non-existent liability', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id', mockUserId)).rejects.toThrow(
        LiabilityNotFoundException,
      );
    });
  });
});

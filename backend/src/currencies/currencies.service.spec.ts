import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency, CurrencyType } from '../entities/currency.entity';
import { UserCurrencyPreference } from '../entities/UserCurrencyPreference.entity';
import { CurrenciesService } from './currencies.service';
import { CurrencyUpdateService } from './currency-update.service';

describe('CurrenciesService', () => {
  let service: CurrenciesService;
  let currencyRepository: jest.Mocked<Repository<Currency>>;
  let userCurrencyPreferenceRepository: jest.Mocked<Repository<UserCurrencyPreference>>;
  let currencyUpdateService: jest.Mocked<CurrencyUpdateService>;

  const mockUserId = 'user-123';

  const mockCurrencies: Currency[] = [
    {
      id: 'currency-1',
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      type: CurrencyType.FIAT,
      isActive: true,
      isDefault: true,
      isSystem: true,
      contractAddress: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'currency-2',
      code: 'EUR',
      name: 'Euro',
      symbol: '€',
      type: CurrencyType.FIAT,
      isActive: true,
      isDefault: false,
      isSystem: true,
      contractAddress: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'currency-3',
      code: 'BTC',
      name: 'Bitcoin',
      symbol: '₿',
      type: CurrencyType.CRYPTO,
      isActive: true,
      isDefault: false,
      isSystem: true,
      contractAddress: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockExchangeRates = {
    USD: 1,
    EUR: 0.92,
    RUB: 91.5,
    BTC: 0.000017,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrenciesService,
        {
          provide: getRepositoryToken(Currency),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserCurrencyPreference),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: CurrencyUpdateService,
          useValue: {
            getExchangeRates: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CurrenciesService>(CurrenciesService);
    currencyRepository = module.get(getRepositoryToken(Currency));
    userCurrencyPreferenceRepository = module.get(getRepositoryToken(UserCurrencyPreference));
    currencyUpdateService = module.get(CurrencyUpdateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all active currencies when no userId provided', async () => {
      currencyRepository.find.mockResolvedValue(mockCurrencies);

      const result = await service.findAll();

      expect(currencyRepository.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { code: 'ASC' },
      });
      expect(result).toEqual(mockCurrencies);
    });

    it('should filter out hidden currencies for user', async () => {
      currencyRepository.find.mockResolvedValue(mockCurrencies);
      userCurrencyPreferenceRepository.find.mockResolvedValue([
        { userId: mockUserId, currencyId: 'currency-2', isHidden: true } as any,
      ]);

      const result = await service.findAll(mockUserId);

      expect(result).toHaveLength(2);
      expect(result.find((c) => c.code === 'EUR')).toBeUndefined();
    });

    it('should return all currencies when user has no hidden preferences', async () => {
      currencyRepository.find.mockResolvedValue(mockCurrencies);
      userCurrencyPreferenceRepository.find.mockResolvedValue([]);

      const result = await service.findAll(mockUserId);

      expect(result).toEqual(mockCurrencies);
    });
  });

  describe('findByCode', () => {
    it('should return currency by code', async () => {
      const usdCurrency = mockCurrencies[0];
      currencyRepository.findOne.mockResolvedValue(usdCurrency);

      const result = await service.findByCode('USD');

      expect(currencyRepository.findOne).toHaveBeenCalledWith({ where: { code: 'USD' } });
      expect(result).toEqual(usdCurrency);
    });

    it('should throw NotFoundException when currency not found', async () => {
      currencyRepository.findOne.mockResolvedValue(null);

      await expect(service.findByCode('INVALID')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getExchangeRates', () => {
    it('should return exchange rates from update service', async () => {
      currencyUpdateService.getExchangeRates.mockResolvedValue(mockExchangeRates);

      const result = await service.getExchangeRates('USD');

      expect(currencyUpdateService.getExchangeRates).toHaveBeenCalledWith('USD');
      expect(result).toEqual(mockExchangeRates);
    });

    it('should use USD as default base currency', async () => {
      currencyUpdateService.getExchangeRates.mockResolvedValue(mockExchangeRates);

      await service.getExchangeRates();

      expect(currencyUpdateService.getExchangeRates).toHaveBeenCalledWith('USD');
    });
  });

  describe('convert', () => {
    beforeEach(() => {
      currencyUpdateService.getExchangeRates.mockResolvedValue(mockExchangeRates);
    });

    it('should return same amount when converting same currency', async () => {
      const result = await service.convert(100, 'USD', 'USD');

      expect(result).toBe(100);
      expect(currencyUpdateService.getExchangeRates).not.toHaveBeenCalled();
    });

    it('should convert USD to EUR correctly', async () => {
      const result = await service.convert(100, 'USD', 'EUR');

      // 100 USD / 1 (USD rate) * 0.92 (EUR rate) = 92 EUR
      expect(result).toBe(92);
    });

    it('should convert EUR to USD correctly', async () => {
      const result = await service.convert(92, 'EUR', 'USD');

      // 92 EUR / 0.92 (EUR rate) * 1 (USD rate) = 100 USD
      expect(result).toBe(100);
    });

    it('should convert EUR to RUB correctly', async () => {
      const result = await service.convert(100, 'EUR', 'RUB');

      // 100 EUR / 0.92 * 91.5 = ~9945.65 RUB
      expect(result).toBeCloseTo(9945.65, 0);
    });

    it('should throw error when source currency not found', async () => {
      await expect(service.convert(100, 'INVALID', 'USD')).rejects.toThrow();
    });

    it('should throw error when target currency not found', async () => {
      await expect(service.convert(100, 'USD', 'INVALID')).rejects.toThrow();
    });
  });

  describe('getAllCurrencies', () => {
    it('should return all currency codes', async () => {
      currencyUpdateService.getExchangeRates.mockResolvedValue(mockExchangeRates);

      const result = await service.getAllCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'RUB', 'BTC']);
    });
  });

  describe('hideCurrency', () => {
    it('should hide a system currency for user', async () => {
      currencyRepository.findOne.mockResolvedValue(mockCurrencies[0]);
      userCurrencyPreferenceRepository.findOne.mockResolvedValue(null);
      userCurrencyPreferenceRepository.create.mockReturnValue({
        userId: mockUserId,
        currencyId: 'currency-1',
        isHidden: true,
      } as any);
      userCurrencyPreferenceRepository.save.mockResolvedValue({} as any);

      await service.hideCurrency(mockUserId, 'currency-1');

      expect(userCurrencyPreferenceRepository.create).toHaveBeenCalledWith({
        userId: mockUserId,
        currencyId: 'currency-1',
        isHidden: true,
      });
      expect(userCurrencyPreferenceRepository.save).toHaveBeenCalled();
    });

    it('should update existing preference to hidden', async () => {
      currencyRepository.findOne.mockResolvedValue(mockCurrencies[0]);
      const existingPref = { userId: mockUserId, currencyId: 'currency-1', isHidden: false };
      userCurrencyPreferenceRepository.findOne.mockResolvedValue(existingPref as any);
      userCurrencyPreferenceRepository.save.mockResolvedValue({} as any);

      await service.hideCurrency(mockUserId, 'currency-1');

      expect(existingPref.isHidden).toBe(true);
      expect(userCurrencyPreferenceRepository.save).toHaveBeenCalledWith(existingPref);
    });

    it('should throw NotFoundException when currency not found', async () => {
      currencyRepository.findOne.mockResolvedValue(null);

      await expect(service.hideCurrency(mockUserId, 'invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when currency is not system', async () => {
      const nonSystemCurrency = { ...mockCurrencies[0], isSystem: false };
      currencyRepository.findOne.mockResolvedValue(nonSystemCurrency);

      await expect(service.hideCurrency(mockUserId, 'currency-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('showCurrency', () => {
    it('should show a hidden currency for user', async () => {
      const hiddenPref = { userId: mockUserId, currencyId: 'currency-1', isHidden: true };
      userCurrencyPreferenceRepository.findOne.mockResolvedValue(hiddenPref as any);
      userCurrencyPreferenceRepository.save.mockResolvedValue({} as any);

      await service.showCurrency(mockUserId, 'currency-1');

      expect(hiddenPref.isHidden).toBe(false);
      expect(userCurrencyPreferenceRepository.save).toHaveBeenCalledWith(hiddenPref);
    });

    it('should do nothing when preference not found', async () => {
      userCurrencyPreferenceRepository.findOne.mockResolvedValue(null);

      await service.showCurrency(mockUserId, 'currency-1');

      expect(userCurrencyPreferenceRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getHiddenCurrencies', () => {
    it('should return hidden currencies for user', async () => {
      userCurrencyPreferenceRepository.find.mockResolvedValue([
        { userId: mockUserId, currencyId: 'currency-2', isHidden: true } as any,
      ]);

      const mockQueryBuilder = {
        whereInIds: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockCurrencies[1]]),
      };
      currencyRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder as any);

      const result = await service.getHiddenCurrencies(mockUserId);

      expect(result).toEqual([mockCurrencies[1]]);
    });

    it('should return empty array when no hidden currencies', async () => {
      userCurrencyPreferenceRepository.find.mockResolvedValue([]);

      const result = await service.getHiddenCurrencies(mockUserId);

      expect(result).toEqual([]);
    });
  });
});

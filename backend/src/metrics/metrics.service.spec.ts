import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { MetricsService } from './metrics.service';
import { Asset, AssetType, AssetCategory, IncomeType } from '../entities/asset.entity';
import { Liability, LiabilityCategory, LiabilityFrequency } from '../entities/liability.entity';
import { CryptoWallet, CryptoType } from '../entities/crypto-wallet.entity';
import { CurrenciesService } from '../currencies/currencies.service';
import { CryptoPricesService } from '../crypto/crypto-prices.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let assetRepository: jest.Mocked<Repository<Asset>>;
  let liabilityRepository: jest.Mocked<Repository<Liability>>;
  let cryptoWalletRepository: jest.Mocked<Repository<CryptoWallet>>;
  let currenciesService: jest.Mocked<CurrenciesService>;
  let cryptoPricesService: jest.Mocked<CryptoPricesService>;

  const mockUserId = 'user-123';

  // Mock currency
  const mockUsdCurrency = { id: 'currency-1', code: 'USD', name: 'US Dollar', symbol: '$' };
  const mockEurCurrency = { id: 'currency-2', code: 'EUR', name: 'Euro', symbol: '€' };

  // Mock stock assets
  const mockStockAsset: Asset = {
    id: 'asset-1',
    userId: mockUserId,
    name: 'Savings Account',
    assetType: AssetType.STOCK,
    category: AssetCategory.SAVINGS,
    incomeType: null,
    amount: 10000,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Emergency fund',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  const mockInvestmentAsset: Asset = {
    id: 'asset-2',
    userId: mockUserId,
    name: 'Stock Portfolio',
    assetType: AssetType.STOCK,
    category: AssetCategory.INVESTMENTS,
    incomeType: null,
    amount: 25000,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Index funds',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  // Mock flow assets (active income)
  const mockSalaryAsset: Asset = {
    id: 'asset-3',
    userId: mockUserId,
    name: 'Monthly Salary',
    assetType: AssetType.FLOW,
    category: AssetCategory.SALARY,
    incomeType: IncomeType.ACTIVE,
    amount: 5000,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Job income',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  // Mock flow assets (passive income)
  const mockDividendAsset: Asset = {
    id: 'asset-4',
    userId: mockUserId,
    name: 'Dividend Income',
    assetType: AssetType.FLOW,
    category: AssetCategory.DIVIDENDS,
    incomeType: IncomeType.PASSIVE,
    amount: 500,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Quarterly dividends',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  // Mock liabilities
  const mockSubscriptionLiability: Liability = {
    id: 'liability-1',
    userId: mockUserId,
    name: 'Netflix',
    category: LiabilityCategory.SUBSCRIPTIONS,
    amount: 15,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Streaming service',
    frequency: LiabilityFrequency.MONTHLY,
    deadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  const mockRegularExpenseLiability: Liability = {
    id: 'liability-2',
    userId: mockUserId,
    name: 'Rent',
    category: LiabilityCategory.REGULAR_EXPENSES,
    amount: 1500,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Monthly rent',
    frequency: LiabilityFrequency.MONTHLY,
    deadline: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  const mockLoanLiability: Liability = {
    id: 'liability-3',
    userId: mockUserId,
    name: 'Car Loan',
    category: LiabilityCategory.LOANS,
    amount: 15000,
    currencyId: 'currency-1',
    currency: mockUsdCurrency as any,
    date: new Date('2024-01-15'),
    description: 'Car loan balance',
    frequency: null,
    deadline: new Date('2025-12-31'),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  // Mock crypto wallets
  const mockEthWallet: CryptoWallet = {
    id: 'wallet-1',
    userId: mockUserId,
    type: CryptoType.ETHEREUM,
    address: '0x1234567890abcdef',
    balance: 2.5,
    tokens: [
      { symbol: 'USDC', contractAddress: '0xusdc', balance: 1000 },
      { symbol: 'LINK', contractAddress: '0xlink', balance: 50 },
    ],
    lastUpdated: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  const mockBtcWallet: CryptoWallet = {
    id: 'wallet-2',
    userId: mockUserId,
    type: CryptoType.BITCOIN,
    address: 'bc1qxyz',
    balance: 0.5,
    tokens: null,
    lastUpdated: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  // Create mock query builder
  const createMockQueryBuilder = (returnValue: any[]) => {
    const mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(returnValue),
    };
    return mockQueryBuilder as unknown as SelectQueryBuilder<any>;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getRepositoryToken(Asset),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Liability),
          useValue: {
            find: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(CryptoWallet),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: CurrenciesService,
          useValue: {
            convert: jest.fn(),
          },
        },
        {
          provide: CryptoPricesService,
          useValue: {
            getPrice: jest.fn(),
            getBulkTokenPrices: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    assetRepository = module.get(getRepositoryToken(Asset));
    liabilityRepository = module.get(getRepositoryToken(Liability));
    cryptoWalletRepository = module.get(getRepositoryToken(CryptoWallet));
    currenciesService = module.get(CurrenciesService);
    cryptoPricesService = module.get(CryptoPricesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMetrics', () => {
    it('should calculate metrics correctly with stock and flow assets', async () => {
      // Setup mocks
      assetRepository.find.mockResolvedValue([
        mockStockAsset,
        mockInvestmentAsset,
        mockSalaryAsset,
        mockDividendAsset,
      ] as any);
      liabilityRepository.find.mockResolvedValue([
        mockSubscriptionLiability,
        mockRegularExpenseLiability,
        mockLoanLiability,
      ] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Total stock assets = 10000 + 25000 = 35000
      expect(result.totalStockAssets).toBe(35000);
      // Total flow income = 5000 + 500 = 5500
      expect(result.totalFlowIncome).toBe(5500);
      // Total active income = 5000
      expect(result.totalActiveIncome).toBe(5000);
      // Total passive income = 500
      expect(result.totalPassiveIncome).toBe(500);
      // Total liabilities = 15 + 1500 + 15000 = 16515
      expect(result.totalLiabilities).toBe(16515);
      // Net worth = 35000 - 16515 = 18485
      expect(result.netWorth).toBe(18485);
      // Monthly expenses = 15 + 1500 = 1515 (only subscriptions and regular_expenses)
      expect(result.monthlyExpenses).toBe(1515);
      // Crypto value = 0 (no wallets)
      expect(result.cryptoValue).toBe(0);
      // FL-ratio = passive income / monthly expenses = 500 / 1515
      expect(result.flRatio).toBeCloseTo(500 / 1515, 5);
      // Runway = net worth / monthly expenses
      expect(result.runway).toBeCloseTo(18485 / 1515, 5);
      expect(result.currency).toBe('USD');
    });

    it('should calculate crypto value for ethereum wallet', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockEthWallet] as any);

      // ETH price $2000, balance 2.5 = $5000
      cryptoPricesService.getPrice.mockResolvedValue(2000);
      // Token prices: USDC = $1, LINK = $15
      cryptoPricesService.getBulkTokenPrices.mockResolvedValue({
        '0xusdc': 1,
        '0xlink': 15,
      });
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // ETH: 2.5 * 2000 = 5000
      // USDC: 1000 * 1 = 1000
      // LINK: 50 * 15 = 750
      // Total: 5000 + 1000 + 750 = 6750
      expect(result.cryptoValue).toBe(6750);
      expect(result.totalStockAssets).toBe(6750);
      expect(result.netWorth).toBe(6750);
    });

    it('should calculate crypto value for bitcoin wallet', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockBtcWallet] as any);

      // BTC price $40000, balance 0.5 = $20000
      cryptoPricesService.getPrice.mockResolvedValue(40000);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.cryptoValue).toBe(20000);
      expect(result.totalStockAssets).toBe(20000);
    });

    it('should convert currencies when target currency differs', async () => {
      const eurAsset = {
        ...mockStockAsset,
        currencyId: 'currency-2',
        currency: mockEurCurrency,
        amount: 1000,
      };

      assetRepository.find.mockResolvedValue([eurAsset] as any);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);

      // EUR to USD conversion: 1 EUR = 1.1 USD
      currenciesService.convert.mockResolvedValue(1100);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(currenciesService.convert).toHaveBeenCalledWith(1000, 'EUR', 'USD');
      expect(result.totalStockAssets).toBe(1100);
    });

    it('should handle currency conversion errors gracefully', async () => {
      const eurAsset = {
        ...mockStockAsset,
        currencyId: 'currency-2',
        currency: mockEurCurrency,
        amount: 1000,
      };

      assetRepository.find.mockResolvedValue([eurAsset] as any);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);

      // Conversion fails
      currenciesService.convert.mockRejectedValue(new Error('Conversion failed'));

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should use original amount when conversion fails
      expect(result.totalStockAssets).toBe(1000);
    });

    it('should calculate asset distribution correctly', async () => {
      assetRepository.find.mockResolvedValue([mockStockAsset, mockInvestmentAsset] as any);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Savings: 10000 / 35000 * 100 = 28.57%
      // Investments: 25000 / 35000 * 100 = 71.43%
      expect(result.stockAssetDistribution[AssetCategory.SAVINGS]).toBeCloseTo(28.57, 1);
      expect(result.stockAssetDistribution[AssetCategory.INVESTMENTS]).toBeCloseTo(71.43, 1);
    });

    it('should calculate liability distribution correctly', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([
        mockSubscriptionLiability,
        mockRegularExpenseLiability,
        mockLoanLiability,
      ] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Total liabilities = 15 + 1500 + 15000 = 16515
      // Subscriptions: 15 / 16515 * 100 = 0.09%
      // Regular expenses: 1500 / 16515 * 100 = 9.08%
      // Loans: 15000 / 16515 * 100 = 90.83%
      expect(result.liabilityDistribution[LiabilityCategory.SUBSCRIPTIONS]).toBeCloseTo(0.09, 1);
      expect(result.liabilityDistribution[LiabilityCategory.REGULAR_EXPENSES]).toBeCloseTo(9.08, 1);
      expect(result.liabilityDistribution[LiabilityCategory.LOANS]).toBeCloseTo(90.83, 1);
    });

    it('should return null for FL-ratio when monthly expenses are zero', async () => {
      assetRepository.find.mockResolvedValue([mockDividendAsset] as any);
      liabilityRepository.find.mockResolvedValue([mockLoanLiability] as any); // Loans don't count as monthly expenses
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.monthlyExpenses).toBe(0);
      expect(result.flRatio).toBeNull();
    });

    it('should return null for runway when monthly expenses are zero', async () => {
      assetRepository.find.mockResolvedValue([mockStockAsset] as any);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.monthlyExpenses).toBe(0);
      expect(result.runway).toBeNull();
    });

    it('should handle empty data correctly', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.netWorth).toBe(0);
      expect(result.totalStockAssets).toBe(0);
      expect(result.totalFlowIncome).toBe(0);
      expect(result.totalActiveIncome).toBe(0);
      expect(result.totalPassiveIncome).toBe(0);
      expect(result.cryptoValue).toBe(0);
      expect(result.totalLiabilities).toBe(0);
      expect(result.monthlyExpenses).toBe(0);
      expect(result.runway).toBeNull();
      expect(result.flRatio).toBeNull();
    });

    it('should convert crypto value to target currency', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockBtcWallet] as any);

      cryptoPricesService.getPrice.mockResolvedValue(40000);
      // USD to EUR conversion
      currenciesService.convert.mockResolvedValue(18000);

      const result = await service.getMetrics(mockUserId, 'EUR');

      // BTC: 0.5 * 40000 = 20000 USD, converted to EUR = 18000
      expect(currenciesService.convert).toHaveBeenCalledWith(20000, 'USD', 'EUR');
      expect(result.cryptoValue).toBe(18000);
    });

    it('should handle crypto price fetch errors gracefully', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockEthWallet] as any);

      cryptoPricesService.getPrice.mockRejectedValue(new Error('Price fetch failed'));
      cryptoPricesService.getBulkTokenPrices.mockResolvedValue({});
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should continue without crashing, crypto value will be 0
      expect(result.cryptoValue).toBe(0);
    });

    it('should calculate monthly expenses with different frequencies', async () => {
      const dailyExpense: Liability = {
        ...mockSubscriptionLiability,
        id: 'daily-1',
        name: 'Daily Coffee',
        amount: 5,
        frequency: LiabilityFrequency.DAILY,
      };

      const weeklyExpense: Liability = {
        ...mockSubscriptionLiability,
        id: 'weekly-1',
        name: 'Weekly Groceries',
        amount: 100,
        frequency: LiabilityFrequency.WEEKLY,
      };

      const quarterlyExpense: Liability = {
        ...mockSubscriptionLiability,
        id: 'quarterly-1',
        name: 'Quarterly Insurance',
        amount: 300,
        frequency: LiabilityFrequency.QUARTERLY,
      };

      const yearlyExpense: Liability = {
        ...mockSubscriptionLiability,
        id: 'yearly-1',
        name: 'Annual Subscription',
        amount: 120,
        frequency: LiabilityFrequency.YEARLY,
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([
        dailyExpense,
        weeklyExpense,
        quarterlyExpense,
        yearlyExpense,
      ] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Daily: 5 * 30 = 150
      // Weekly: 100 * 4.33 = 433
      // Quarterly: 300 / 3 = 100
      // Yearly: 120 / 12 = 10
      // Total: 150 + 433 + 100 + 10 = 693
      expect(result.monthlyExpenses).toBeCloseTo(693, 0);
    });

    it('should handle tokens with missing contract addresses', async () => {
      const walletWithBadTokens: CryptoWallet = {
        ...mockEthWallet,
        tokens: [
          { symbol: 'USDC', contractAddress: '', balance: 1000 },
          { symbol: 'LINK', contractAddress: null, balance: 50 },
        ],
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([walletWithBadTokens] as any);

      cryptoPricesService.getPrice.mockResolvedValue(2000);
      cryptoPricesService.getBulkTokenPrices.mockResolvedValue({});
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Only ETH value: 2.5 * 2000 = 5000
      expect(result.cryptoValue).toBe(5000);
    });

    it('should handle wallets with null tokens array', async () => {
      const walletWithNullTokens: CryptoWallet = {
        ...mockEthWallet,
        tokens: null,
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([walletWithNullTokens] as any);

      cryptoPricesService.getPrice.mockResolvedValue(2000);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Only ETH value: 2.5 * 2000 = 5000
      expect(result.cryptoValue).toBe(5000);
    });

    it('should handle assets without currency relation', async () => {
      const assetWithoutCurrency = {
        ...mockStockAsset,
        currency: null,
      };

      assetRepository.find.mockResolvedValue([assetWithoutCurrency] as any);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should default to USD and not convert
      expect(result.totalStockAssets).toBe(10000);
    });
  });

  describe('getCapitalHistory', () => {
    it('should return capital history for specified days', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([mockStockAsset]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([mockSubscriptionLiability]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getCapitalHistory(mockUserId, 5, 'USD');

      // Should return 6 entries (days 5, 4, 3, 2, 1, 0 from today)
      expect(result).toHaveLength(6);
      expect(result[0]).toHaveProperty('date');
      expect(result[0]).toHaveProperty('netWorth');
      expect(result[0]).toHaveProperty('totalAssets');
      expect(result[0]).toHaveProperty('totalLiabilities');
    });

    it('should calculate net worth correctly for each day', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([mockStockAsset]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([mockSubscriptionLiability]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getCapitalHistory(mockUserId, 1, 'USD');

      // Net worth = assets - liabilities = 10000 - 15 = 9985
      expect(result[0].totalAssets).toBe(10000);
      expect(result[0].totalLiabilities).toBe(15);
      expect(result[0].netWorth).toBe(9985);
    });

    it('should use default values for days and currency', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);

      const result = await service.getCapitalHistory(mockUserId);

      // Default is 30 days, so 31 entries (0-30)
      expect(result).toHaveLength(31);
    });

    it('should format dates as ISO date strings', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);

      const result = await service.getCapitalHistory(mockUserId, 1, 'USD');

      // Date should be in YYYY-MM-DD format
      expect(result[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle empty history correctly', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);

      const result = await service.getCapitalHistory(mockUserId, 2, 'USD');

      expect(result).toHaveLength(3);
      result.forEach((entry) => {
        expect(entry.netWorth).toBe(0);
        expect(entry.totalAssets).toBe(0);
        expect(entry.totalLiabilities).toBe(0);
      });
    });

    it('should query with correct date filters', async () => {
      const mockAssetQueryBuilder = createMockQueryBuilder([]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);

      await service.getCapitalHistory(mockUserId, 1, 'USD');

      // Should have called createQueryBuilder twice for each day (2 days = 4 calls total)
      expect(assetRepository.createQueryBuilder).toHaveBeenCalledWith('asset');
      expect(liabilityRepository.createQueryBuilder).toHaveBeenCalledWith('liability');
      expect(mockAssetQueryBuilder.where).toHaveBeenCalledWith('asset.userId = :userId', {
        userId: mockUserId,
      });
      expect(mockLiabilityQueryBuilder.where).toHaveBeenCalledWith('liability.userId = :userId', {
        userId: mockUserId,
      });
    });

    it('should convert currencies in history', async () => {
      const eurAsset = {
        ...mockStockAsset,
        currency: mockEurCurrency,
        amount: 1000,
      };
      const mockAssetQueryBuilder = createMockQueryBuilder([eurAsset]);
      const mockLiabilityQueryBuilder = createMockQueryBuilder([]);

      assetRepository.createQueryBuilder.mockReturnValue(mockAssetQueryBuilder as any);
      liabilityRepository.createQueryBuilder.mockReturnValue(mockLiabilityQueryBuilder as any);
      currenciesService.convert.mockResolvedValue(1100);

      const result = await service.getCapitalHistory(mockUserId, 0, 'USD');

      expect(currenciesService.convert).toHaveBeenCalledWith(1000, 'EUR', 'USD');
      expect(result[0].totalAssets).toBe(1100);
    });
  });

  describe('calculateCryptoValue edge cases', () => {
    it('should handle ETH price of 0 with warning', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockEthWallet] as any);

      // ETH price is 0
      cryptoPricesService.getPrice.mockResolvedValue(0);
      cryptoPricesService.getBulkTokenPrices.mockResolvedValue({});
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // With 0 price, crypto value should be 0
      expect(result.cryptoValue).toBe(0);
    });

    it('should handle BTC price of 0 with warning', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockBtcWallet] as any);

      // BTC price is 0
      cryptoPricesService.getPrice.mockResolvedValue(0);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.cryptoValue).toBe(0);
    });

    it('should handle token with 0 price and positive balance', async () => {
      const walletWithToken: CryptoWallet = {
        ...mockEthWallet,
        tokens: [{ symbol: 'UNKNOWN', contractAddress: '0xunknown', balance: 1000 }],
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([walletWithToken] as any);

      cryptoPricesService.getPrice.mockResolvedValue(2000);
      // Token price is 0
      cryptoPricesService.getBulkTokenPrices.mockResolvedValue({ '0xunknown': 0 });
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Only ETH value: 2.5 * 2000 = 5000
      expect(result.cryptoValue).toBe(5000);
    });

    it('should handle crypto conversion error gracefully', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([mockBtcWallet] as any);

      cryptoPricesService.getPrice.mockResolvedValue(40000);
      // Conversion fails
      currenciesService.convert.mockRejectedValue(new Error('Conversion failed'));

      const result = await service.getMetrics(mockUserId, 'EUR');

      // Should use USD value when conversion fails
      expect(result.cryptoValue).toBe(20000);
    });
  });

  describe('calculateMonthlyExpenses edge cases', () => {
    it('should handle liability without frequency (backward compatibility)', async () => {
      const noFrequencyLiability: Liability = {
        ...mockSubscriptionLiability,
        frequency: null,
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([noFrequencyLiability] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockImplementation(async (amount) => amount);

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should assume monthly if no frequency specified
      expect(result.monthlyExpenses).toBe(15);
    });

    it('should handle liability currency conversion error', async () => {
      const eurLiability: Liability = {
        ...mockSubscriptionLiability,
        currency: mockEurCurrency as any,
        amount: 10,
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([eurLiability] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockRejectedValue(new Error('Conversion failed'));

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should use original amount when conversion fails
      expect(result.monthlyExpenses).toBe(10);
    });
  });

  describe('distribution calculations edge cases', () => {
    it('should handle empty asset distribution (total is 0)', async () => {
      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([]);
      cryptoWalletRepository.find.mockResolvedValue([]);

      const result = await service.getMetrics(mockUserId, 'USD');

      expect(result.stockAssetDistribution).toEqual({});
      expect(result.flowIncomeDistribution).toEqual({});
      expect(result.liabilityDistribution).toEqual({});
    });

    it('should handle liability distribution currency conversion error', async () => {
      const eurLiability: Liability = {
        ...mockLoanLiability,
        currency: mockEurCurrency as any,
        amount: 1000,
      };

      assetRepository.find.mockResolvedValue([]);
      liabilityRepository.find.mockResolvedValue([eurLiability] as any);
      cryptoWalletRepository.find.mockResolvedValue([]);
      currenciesService.convert.mockRejectedValue(new Error('Conversion failed'));

      const result = await service.getMetrics(mockUserId, 'USD');

      // Should still calculate distribution with original amounts
      expect(result.liabilityDistribution[LiabilityCategory.LOANS]).toBe(100);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { CryptoService } from './crypto.service';
import { CryptoWallet, CryptoType } from '../entities/crypto-wallet.entity';
import { CryptoUpdateService } from './crypto-update.service';
import { CryptoWalletNotFoundException } from '../shared/exceptions';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';

describe('CryptoService', () => {
  let service: CryptoService;
  let repository: jest.Mocked<Repository<CryptoWallet>>;
  let cryptoUpdateService: jest.Mocked<CryptoUpdateService>;

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockUserId = 'user-123';
  const mockWalletId = 'wallet-456';

  const mockWallet: CryptoWallet = {
    id: mockWalletId,
    userId: mockUserId,
    type: CryptoType.ETHEREUM,
    address: '0x1234567890abcdef1234567890abcdef12345678',
    balance: 1.5,
    tokens: [
      {
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        balance: 1000,
      },
    ],
    lastUpdated: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: getRepositoryToken(CryptoWallet),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
          },
        },
        {
          provide: CryptoUpdateService,
          useValue: {
            updateWalletBalance: jest.fn(),
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
    repository = module.get(getRepositoryToken(CryptoWallet));
    cryptoUpdateService = module.get(CryptoUpdateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new ethereum wallet successfully', async () => {
      const createDto: CreateCryptoWalletDto = {
        type: CryptoType.ETHEREUM,
        address: '0x1234567890abcdef1234567890abcdef12345678',
      };

      const createdWallet = { ...mockWallet, id: 'new-wallet-id' };
      repository.create.mockReturnValue(createdWallet as any);
      repository.save.mockResolvedValue(createdWallet as any);
      cryptoUpdateService.updateWalletBalance.mockResolvedValue(undefined);
      repository.findOne.mockResolvedValue(createdWallet as any);

      const result = await service.create(mockUserId, createDto);

      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        userId: mockUserId,
      });
      expect(repository.save).toHaveBeenCalled();
      expect(cryptoUpdateService.updateWalletBalance).toHaveBeenCalledWith('new-wallet-id');
      expect(result).toEqual(createdWallet);
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
    });

    it('should create a bitcoin wallet successfully', async () => {
      const createDto: CreateCryptoWalletDto = {
        type: CryptoType.BITCOIN,
        address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      };

      const btcWallet = { ...mockWallet, type: CryptoType.BITCOIN, id: 'btc-wallet-id' };
      repository.create.mockReturnValue(btcWallet as any);
      repository.save.mockResolvedValue(btcWallet as any);
      cryptoUpdateService.updateWalletBalance.mockResolvedValue(undefined);
      repository.findOne.mockResolvedValue(btcWallet as any);

      const result = await service.create(mockUserId, createDto);

      expect(result.type).toBe(CryptoType.BITCOIN);
    });

    it('should throw CryptoWalletNotFoundException when wallet not found after creation', async () => {
      const createDto: CreateCryptoWalletDto = {
        type: CryptoType.ETHEREUM,
        address: '0x1234567890abcdef1234567890abcdef12345678',
      };

      repository.create.mockReturnValue(mockWallet as any);
      repository.save.mockResolvedValue(mockWallet as any);
      cryptoUpdateService.updateWalletBalance.mockResolvedValue(undefined);
      repository.findOne.mockResolvedValue(null);

      await expect(service.create(mockUserId, createDto)).rejects.toThrow(
        CryptoWalletNotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all wallets for a user', async () => {
      const wallets = [mockWallet, { ...mockWallet, id: 'wallet-789', type: CryptoType.BITCOIN }];
      repository.find.mockResolvedValue(wallets as any);

      const result = await service.findAll(mockUserId);

      expect(repository.find).toHaveBeenCalledWith({
        where: { userId: mockUserId },
      });
      expect(result).toEqual(wallets);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when user has no wallets', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findAll(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('should return a wallet when found', async () => {
      repository.findOne.mockResolvedValue(mockWallet as any);

      const result = await service.findOne(mockWalletId, mockUserId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: mockWalletId, userId: mockUserId },
      });
      expect(result).toEqual(mockWallet);
    });

    it('should throw CryptoWalletNotFoundException when wallet not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id', mockUserId)).rejects.toThrow(
        CryptoWalletNotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should remove a wallet successfully', async () => {
      repository.findOne.mockResolvedValue(mockWallet as any);
      repository.remove.mockResolvedValue(mockWallet as any);

      await service.remove(mockWalletId, mockUserId);

      expect(repository.remove).toHaveBeenCalledWith(mockWallet);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { walletId: mockWalletId },
        'Crypto wallet removed successfully',
      );
    });

    it('should throw CryptoWalletNotFoundException when removing non-existent wallet', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id', mockUserId)).rejects.toThrow(
        CryptoWalletNotFoundException,
      );
    });
  });

  describe('updateBalance', () => {
    it('should update wallet balance successfully', async () => {
      const updatedWallet = { ...mockWallet, balance: 2.5 };
      repository.findOne
        .mockResolvedValueOnce(mockWallet as any) // First call in findOne
        .mockResolvedValueOnce(updatedWallet as any); // Second call after update
      cryptoUpdateService.updateWalletBalance.mockResolvedValue(undefined);

      const result = await service.updateBalance(mockWalletId, mockUserId);

      expect(cryptoUpdateService.updateWalletBalance).toHaveBeenCalledWith(mockWalletId);
      expect(result.balance).toBe(2.5);
      expect(mockLogger.info).toHaveBeenCalledWith(
        { walletId: mockWalletId },
        'Crypto wallet balance updated',
      );
    });

    it('should throw CryptoWalletNotFoundException when wallet not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.updateBalance('non-existent-id', mockUserId)).rejects.toThrow(
        CryptoWalletNotFoundException,
      );
    });

    it('should throw CryptoWalletNotFoundException when wallet not found after update', async () => {
      repository.findOne.mockResolvedValueOnce(mockWallet as any).mockResolvedValueOnce(null);
      cryptoUpdateService.updateWalletBalance.mockResolvedValue(undefined);

      await expect(service.updateBalance(mockWalletId, mockUserId)).rejects.toThrow(
        CryptoWalletNotFoundException,
      );
    });
  });
});

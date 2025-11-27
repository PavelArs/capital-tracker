import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { CryptoUpdateService } from './crypto-update.service';
import { CryptoWalletNotFoundException } from '../shared/exceptions';

@Injectable()
export class CryptoService {
  constructor(
    @InjectRepository(CryptoWallet)
    private readonly cryptoWalletRepository: Repository<CryptoWallet>,
    private readonly cryptoUpdateService: CryptoUpdateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CryptoService.name);
  }

  async create(userId: string, createDto: CreateCryptoWalletDto): Promise<CryptoWallet> {
    this.logger.info({ userId, type: createDto.type }, 'Creating crypto wallet');

    const wallet = this.cryptoWalletRepository.create({
      ...createDto,
      userId,
    });
    const savedWallet = await this.cryptoWalletRepository.save(wallet);

    // Immediately update balance
    await this.cryptoUpdateService.updateWalletBalance(savedWallet.id);

    const updatedWallet = await this.cryptoWalletRepository.findOne({
      where: { id: savedWallet.id },
    });

    if (!updatedWallet) {
      throw new CryptoWalletNotFoundException(savedWallet.id);
    }

    this.logger.info({ walletId: updatedWallet.id }, 'Crypto wallet created successfully');
    return updatedWallet;
  }

  async findAll(userId: string): Promise<CryptoWallet[]> {
    return this.cryptoWalletRepository.find({
      where: { userId },
    });
  }

  async findOne(id: string, userId: string): Promise<CryptoWallet> {
    const wallet = await this.cryptoWalletRepository.findOne({
      where: { id, userId },
    });

    if (!wallet) {
      throw new CryptoWalletNotFoundException(id);
    }

    return wallet;
  }

  async remove(id: string, userId: string): Promise<void> {
    const wallet = await this.findOne(id, userId);
    await this.cryptoWalletRepository.remove(wallet);
    this.logger.info({ walletId: id }, 'Crypto wallet removed successfully');
  }

  async updateBalance(id: string, userId: string): Promise<CryptoWallet> {
    await this.findOne(id, userId);
    await this.cryptoUpdateService.updateWalletBalance(id);

    const updatedWallet = await this.cryptoWalletRepository.findOne({
      where: { id },
    });

    if (!updatedWallet) {
      throw new CryptoWalletNotFoundException(id);
    }

    this.logger.info({ walletId: id }, 'Crypto wallet balance updated');
    return updatedWallet;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CryptoWallet, CryptoType } from '../entities/crypto-wallet.entity';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { CryptoUpdateService } from './crypto-update.service';

@Injectable()
export class CryptoService {
  constructor(
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
    private cryptoUpdateService: CryptoUpdateService,
  ) {}

  async create(userId: string, createDto: CreateCryptoWalletDto): Promise<CryptoWallet> {
    const wallet = this.cryptoWalletRepository.create({
      ...createDto,
      userId,
    });
    const savedWallet = await this.cryptoWalletRepository.save(wallet);
    
    // Immediately update balance
    await this.cryptoUpdateService.updateWalletBalance(savedWallet.id);
    
    return this.cryptoWalletRepository.findOne({ where: { id: savedWallet.id } });
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
      throw new NotFoundException(`Crypto wallet with ID ${id} not found`);
    }
    return wallet;
  }

  async remove(id: string, userId: string): Promise<void> {
    const wallet = await this.findOne(id, userId);
    await this.cryptoWalletRepository.remove(wallet);
  }

  async updateBalance(id: string, userId: string): Promise<CryptoWallet> {
    await this.findOne(id, userId);
    await this.cryptoUpdateService.updateWalletBalance(id);
    return this.cryptoWalletRepository.findOne({ where: { id } });
  }
}


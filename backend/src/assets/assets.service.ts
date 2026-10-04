import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Asset } from '../entities/asset.entity';
import { AssetNotFoundException } from '../shared/exceptions';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssetsService.name);
  }

  async create(userId: string, createAssetDto: CreateAssetDto): Promise<Asset> {
    this.logger.info({ userId, assetName: createAssetDto.name }, 'Creating asset');

    const asset = this.assetRepository.create({
      ...createAssetDto,
      userId,
    });

    const savedAsset = await this.assetRepository.save(asset);
    this.logger.info({ assetId: savedAsset.id }, 'Asset created successfully');

    return savedAsset;
  }

  async findAll(userId: string): Promise<Asset[]> {
    return this.assetRepository.find({
      where: { userId },
      relations: { currency: true },
      order: { date: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Asset> {
    const asset = await this.assetRepository.findOne({
      where: { id, userId },
      relations: { currency: true },
    });

    if (!asset) {
      throw new AssetNotFoundException(id);
    }

    return asset;
  }

  async update(id: string, userId: string, updateAssetDto: UpdateAssetDto): Promise<Asset> {
    const asset = await this.findOne(id, userId);

    Object.assign(asset, updateAssetDto);
    const updatedAsset = await this.assetRepository.save(asset);

    this.logger.info({ assetId: id }, 'Asset updated successfully');
    return updatedAsset;
  }

  async remove(id: string, userId: string): Promise<void> {
    const asset = await this.findOne(id, userId);
    await this.assetRepository.remove(asset);
    this.logger.info({ assetId: id }, 'Asset removed successfully');
  }
}

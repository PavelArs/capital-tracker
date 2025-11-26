import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Asset } from "../entities/asset.entity";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>
  ) {}

  async create(userId: string, createAssetDto: CreateAssetDto): Promise<Asset> {
    const asset = this.assetRepository.create({
      ...createAssetDto,
      userId,
    });
    return this.assetRepository.save(asset);
  }

  async findAll(userId: string): Promise<Asset[]> {
    return this.assetRepository.find({
      where: { userId },
      relations: ["currency"],
      order: { date: "DESC" },
    });
  }

  async findOne(id: string, userId: string): Promise<Asset> {
    const asset = await this.assetRepository.findOne({
      where: { id, userId },
      relations: ["currency"],
    });
    if (!asset) {
      throw new NotFoundException(`Asset with ID ${id} not found`);
    }
    return asset;
  }

  async update(
    id: string,
    userId: string,
    updateAssetDto: UpdateAssetDto
  ): Promise<Asset> {
    const asset = await this.findOne(id, userId);
    Object.assign(asset, updateAssetDto);
    return this.assetRepository.save(asset);
  }

  async remove(id: string, userId: string): Promise<void> {
    const asset = await this.findOne(id, userId);
    await this.assetRepository.remove(asset);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeFiPosition } from '../entities/defi-position.entity';
import { CreateDeFiPositionDto } from './dto/create-defi-position.dto';
import { UpdateDeFiPositionDto } from './dto/update-defi-position.dto';

@Injectable()
export class DefiService {
  constructor(
    @InjectRepository(DeFiPosition)
    private defiPositionRepository: Repository<DeFiPosition>,
  ) {}

  async create(userId: string, createDto: CreateDeFiPositionDto): Promise<DeFiPosition> {
    const position = this.defiPositionRepository.create({
      ...createDto,
      userId,
    });
    return this.defiPositionRepository.save(position);
  }

  async findAll(userId: string): Promise<DeFiPosition[]> {
    return this.defiPositionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<DeFiPosition> {
    const position = await this.defiPositionRepository.findOne({
      where: { id, userId },
    });
    if (!position) {
      throw new NotFoundException(`DeFi position with ID ${id} not found`);
    }
    return position;
  }

  async update(
    id: string,
    userId: string,
    updateDto: UpdateDeFiPositionDto,
  ): Promise<DeFiPosition> {
    const position = await this.findOne(id, userId);
    Object.assign(position, updateDto);
    position.lastUpdated = new Date();
    return this.defiPositionRepository.save(position);
  }

  async remove(id: string, userId: string): Promise<void> {
    const position = await this.findOne(id, userId);
    await this.defiPositionRepository.remove(position);
  }

  async syncPosition(id: string, userId: string): Promise<DeFiPosition> {
    const position = await this.findOne(id, userId);
    // TODO: Implement actual sync logic with DeFi platform API
    position.lastUpdated = new Date();
    return this.defiPositionRepository.save(position);
  }
}


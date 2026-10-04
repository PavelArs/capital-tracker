import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Liability } from '../entities/liability.entity';
import { LiabilityNotFoundException } from '../shared/exceptions';
import { CreateLiabilityDto } from './dto/create-liability.dto';
import { UpdateLiabilityDto } from './dto/update-liability.dto';

@Injectable()
export class LiabilitiesService {
  constructor(
    @InjectRepository(Liability)
    private readonly liabilityRepository: Repository<Liability>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LiabilitiesService.name);
  }

  async create(userId: string, createLiabilityDto: CreateLiabilityDto): Promise<Liability> {
    this.logger.info({ userId, liabilityName: createLiabilityDto.name }, 'Creating liability');

    const liability = this.liabilityRepository.create({
      ...createLiabilityDto,
      userId,
    });

    const savedLiability = await this.liabilityRepository.save(liability);
    this.logger.info({ liabilityId: savedLiability.id }, 'Liability created successfully');

    return savedLiability;
  }

  async findAll(userId: string): Promise<Liability[]> {
    return this.liabilityRepository.find({
      where: { userId },
      relations: { currency: true },
      order: { date: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Liability> {
    const liability = await this.liabilityRepository.findOne({
      where: { id, userId },
      relations: { currency: true },
    });

    if (!liability) {
      throw new LiabilityNotFoundException(id);
    }

    return liability;
  }

  async update(
    id: string,
    userId: string,
    updateLiabilityDto: UpdateLiabilityDto,
  ): Promise<Liability> {
    const liability = await this.findOne(id, userId);
    Object.assign(liability, updateLiabilityDto);

    const updatedLiability = await this.liabilityRepository.save(liability);
    this.logger.info({ liabilityId: id }, 'Liability updated successfully');

    return updatedLiability;
  }

  async remove(id: string, userId: string): Promise<void> {
    const liability = await this.findOne(id, userId);
    await this.liabilityRepository.remove(liability);
    this.logger.info({ liabilityId: id }, 'Liability removed successfully');
  }
}

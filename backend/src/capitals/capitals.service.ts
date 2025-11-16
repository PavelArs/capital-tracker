import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Capital } from '../entities/capital.entity';
import { CreateCapitalDto } from './dto/create-capital.dto';
import { UpdateCapitalDto } from './dto/update-capital.dto';

@Injectable()
export class CapitalsService {
  constructor(
    @InjectRepository(Capital)
    private capitalRepository: Repository<Capital>,
  ) {}

  async create(userId: string, createDto: CreateCapitalDto): Promise<Capital> {
    // Check if this is the first capital (set as default)
    const existingCapitals = await this.capitalRepository.find({
      where: { userId },
    });

    const capital = this.capitalRepository.create({
      ...createDto,
      userId,
      isDefault: existingCapitals.length === 0,
    });

    return this.capitalRepository.save(capital);
  }

  async findAll(userId: string): Promise<Capital[]> {
    return this.capitalRepository.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Capital> {
    const capital = await this.capitalRepository.findOne({
      where: { id, userId },
    });
    if (!capital) {
      throw new NotFoundException(`Capital with ID ${id} not found`);
    }
    return capital;
  }

  async update(
    id: string,
    userId: string,
    updateDto: UpdateCapitalDto,
  ): Promise<Capital> {
    const capital = await this.findOne(id, userId);
    Object.assign(capital, updateDto);
    return this.capitalRepository.save(capital);
  }

  async remove(id: string, userId: string): Promise<void> {
    const capital = await this.findOne(id, userId);
    
    // Don't allow deletion of default capital if there are other capitals
    if (capital.isDefault) {
      const otherCapitals = await this.capitalRepository.find({
        where: { userId, id: Not(id) },
      });
      if (otherCapitals.length > 0) {
        throw new BadRequestException(
          'Cannot delete default capital. Set another capital as default first.',
        );
      }
    }

    await this.capitalRepository.remove(capital);
  }

  async setDefault(id: string, userId: string): Promise<Capital> {
    const capital = await this.findOne(id, userId);
    
    // Unset all other default capitals
    await this.capitalRepository.update(
      { userId, isDefault: true },
      { isDefault: false },
    );

    // Set this capital as default
    capital.isDefault = true;
    return this.capitalRepository.save(capital);
  }
}


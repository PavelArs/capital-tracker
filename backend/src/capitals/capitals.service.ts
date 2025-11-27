import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Capital } from '../entities/capital.entity';
import { CreateCapitalDto } from './dto/create-capital.dto';
import { UpdateCapitalDto } from './dto/update-capital.dto';
import { CapitalNotFoundException } from '../shared/exceptions';

@Injectable()
export class CapitalsService {
  constructor(
    @InjectRepository(Capital)
    private readonly capitalRepository: Repository<Capital>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CapitalsService.name);
  }

  async create(userId: string, createDto: CreateCapitalDto): Promise<Capital> {
    this.logger.info({ userId, capitalName: createDto.name }, 'Creating capital');

    // Check if this is the first capital (set as default)
    const existingCapitals = await this.capitalRepository.find({
      where: { userId },
    });

    const capital = this.capitalRepository.create({
      ...createDto,
      userId,
      isDefault: existingCapitals.length === 0,
    });

    const savedCapital = await this.capitalRepository.save(capital);
    this.logger.info({ capitalId: savedCapital.id }, 'Capital created successfully');

    return savedCapital;
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
      throw new CapitalNotFoundException(id);
    }

    return capital;
  }

  async update(id: string, userId: string, updateDto: UpdateCapitalDto): Promise<Capital> {
    const capital = await this.findOne(id, userId);
    Object.assign(capital, updateDto);

    const updatedCapital = await this.capitalRepository.save(capital);
    this.logger.info({ capitalId: id }, 'Capital updated successfully');

    return updatedCapital;
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
    this.logger.info({ capitalId: id }, 'Capital removed successfully');
  }

  async setDefault(id: string, userId: string): Promise<Capital> {
    const capital = await this.findOne(id, userId);

    // Unset all other default capitals
    await this.capitalRepository.update({ userId, isDefault: true }, { isDefault: false });

    // Set this capital as default
    capital.isDefault = true;
    const updatedCapital = await this.capitalRepository.save(capital);
    this.logger.info({ capitalId: id }, 'Capital set as default');

    return updatedCapital;
  }
}

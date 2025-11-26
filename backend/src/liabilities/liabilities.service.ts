import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Liability } from "../entities/liability.entity";
import { CreateLiabilityDto } from "./dto/create-liability.dto";
import { UpdateLiabilityDto } from "./dto/update-liability.dto";

@Injectable()
export class LiabilitiesService {
  constructor(
    @InjectRepository(Liability)
    private liabilityRepository: Repository<Liability>
  ) {}

  async create(
    userId: string,
    createLiabilityDto: CreateLiabilityDto
  ): Promise<Liability> {
    const liability = this.liabilityRepository.create({
      ...createLiabilityDto,
      userId,
    });
    return this.liabilityRepository.save(liability);
  }

  async findAll(userId: string): Promise<Liability[]> {
    return this.liabilityRepository.find({
      where: { userId },
      relations: ["currency"],
      order: { date: "DESC" },
    });
  }

  async findOne(id: string, userId: string): Promise<Liability> {
    const liability = await this.liabilityRepository.findOne({
      where: { id, userId },
      relations: ["currency"],
    });
    if (!liability) {
      throw new NotFoundException(`Liability with ID ${id} not found`);
    }
    return liability;
  }

  async update(
    id: string,
    userId: string,
    updateLiabilityDto: UpdateLiabilityDto
  ): Promise<Liability> {
    const liability = await this.findOne(id, userId);
    Object.assign(liability, updateLiabilityDto);
    return this.liabilityRepository.save(liability);
  }

  async remove(id: string, userId: string): Promise<void> {
    const liability = await this.findOne(id, userId);
    await this.liabilityRepository.remove(liability);
  }
}

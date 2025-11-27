import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRecommendation, RecommendationStatus } from '../entities/ai-recommendation.entity';
import { CreateAiRecommendationDto } from './dto/create-ai-recommendation.dto';
import { UpdateAiRecommendationDto } from './dto/update-ai-recommendation.dto';

@Injectable()
export class AiRecommendationsService {
  constructor(
    @InjectRepository(AiRecommendation)
    private aiRecommendationRepository: Repository<AiRecommendation>,
  ) {}

  async create(userId: string, createDto: CreateAiRecommendationDto): Promise<AiRecommendation> {
    const recommendation = this.aiRecommendationRepository.create({
      ...createDto,
      userId,
    });
    return this.aiRecommendationRepository.save(recommendation);
  }

  async findAll(userId: string): Promise<AiRecommendation[]> {
    return this.aiRecommendationRepository.find({
      where: { userId },
      order: { priority: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<AiRecommendation> {
    const recommendation = await this.aiRecommendationRepository.findOne({
      where: { id, userId },
    });
    if (!recommendation) {
      throw new NotFoundException(`AI recommendation with ID ${id} not found`);
    }
    return recommendation;
  }

  async update(
    id: string,
    userId: string,
    updateDto: UpdateAiRecommendationDto,
  ): Promise<AiRecommendation> {
    const recommendation = await this.findOne(id, userId);
    Object.assign(recommendation, updateDto);
    if (updateDto.status && updateDto.status !== RecommendationStatus.PENDING) {
      recommendation.reviewedAt = new Date();
    }
    return this.aiRecommendationRepository.save(recommendation);
  }

  async remove(id: string, userId: string): Promise<void> {
    const recommendation = await this.findOne(id, userId);
    await this.aiRecommendationRepository.remove(recommendation);
  }

  async generateRecommendations(_userId: string): Promise<AiRecommendation[]> {
    // TODO: Implement actual AI recommendation generation
    // This would integrate with an AI service to analyze user's capital and generate recommendations
    return [];
  }
}

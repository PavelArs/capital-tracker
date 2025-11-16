import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { AiRecommendationsService } from './ai-recommendations.service';
import { CreateAiRecommendationDto } from './dto/create-ai-recommendation.dto';
import { UpdateAiRecommendationDto } from './dto/update-ai-recommendation.dto';

@Controller('ai-recommendations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AiRecommendationsController {
  constructor(private aiRecommendationsService: AiRecommendationsService) {}

  @Post()
  @RequireSubscription(SubscriptionType.PRO)
  async create(@Request() req, @Body() createDto: CreateAiRecommendationDto) {
    return this.aiRecommendationsService.create(req.user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  async findAll(@Request() req) {
    return this.aiRecommendationsService.findAll(req.user.userId);
  }

  @Post('generate')
  @RequireSubscription(SubscriptionType.PRO)
  async generateRecommendations(@Request() req) {
    return this.aiRecommendationsService.generateRecommendations(req.user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async findOne(@Request() req, @Param('id') id: string) {
    return this.aiRecommendationsService.findOne(id, req.user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateAiRecommendationDto,
  ) {
    return this.aiRecommendationsService.update(id, req.user.userId, updateDto);
  }

  @Delete(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async remove(@Request() req, @Param('id') id: string) {
    await this.aiRecommendationsService.remove(id, req.user.userId);
    return { message: 'AI recommendation deleted successfully' };
  }
}


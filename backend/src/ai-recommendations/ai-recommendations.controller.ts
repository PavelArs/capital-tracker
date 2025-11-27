import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { AiRecommendationsService } from './ai-recommendations.service';
import { CreateAiRecommendationDto } from './dto/create-ai-recommendation.dto';
import { UpdateAiRecommendationDto } from './dto/update-ai-recommendation.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('ai-recommendations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AiRecommendationsController {
  constructor(private readonly aiRecommendationsService: AiRecommendationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateAiRecommendationDto) {
    return this.aiRecommendationsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.aiRecommendationsService.findAll(user.userId);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  async generateRecommendations(@CurrentUser() user: JwtPayload) {
    return this.aiRecommendationsService.generateRecommendations(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.aiRecommendationsService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateAiRecommendationDto,
  ) {
    return this.aiRecommendationsService.update(id, user.userId, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.aiRecommendationsService.remove(id, user.userId);
    return { message: 'AI recommendation deleted successfully' };
  }
}

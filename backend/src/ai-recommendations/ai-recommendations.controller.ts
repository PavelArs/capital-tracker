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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { AiRecommendationsService } from './ai-recommendations.service';
import { CreateAiRecommendationDto } from './dto/create-ai-recommendation.dto';
import { UpdateAiRecommendationDto } from './dto/update-ai-recommendation.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('ai-recommendations')
@ApiBearerAuth('JWT-auth')
@Controller('ai-recommendations')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AiRecommendationsController {
  constructor(private readonly aiRecommendationsService: AiRecommendationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Create AI recommendation',
    description: 'Manually create an AI recommendation. Requires PRO subscription.',
  })
  @ApiResponse({
    status: 201,
    description: 'Recommendation created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateAiRecommendationDto) {
    return this.aiRecommendationsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get all AI recommendations',
    description: 'Retrieve all AI-generated recommendations for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Recommendations retrieved successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.aiRecommendationsService.findAll(user.userId);
  }

  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Generate AI recommendations',
    description: 'Generate new AI recommendations based on current portfolio analysis',
  })
  @ApiResponse({
    status: 201,
    description: 'Recommendations generated successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'PRO subscription required',
    type: ErrorResponseDto,
  })
  async generateRecommendations(@CurrentUser() user: JwtPayload) {
    return this.aiRecommendationsService.generateRecommendations(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Get AI recommendation by ID',
    description: 'Retrieve a specific AI recommendation by its ID',
  })
  @ApiParam({ name: 'id', description: 'Recommendation UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Recommendation retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Recommendation not found',
    type: ErrorResponseDto,
  })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.aiRecommendationsService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  @ApiOperation({
    summary: 'Update AI recommendation',
    description: 'Update an AI recommendation (e.g., change status to accepted/rejected)',
  })
  @ApiParam({ name: 'id', description: 'Recommendation UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Recommendation updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Recommendation not found',
    type: ErrorResponseDto,
  })
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
  @ApiOperation({
    summary: 'Delete AI recommendation',
    description: 'Remove an AI recommendation',
  })
  @ApiParam({ name: 'id', description: 'Recommendation UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Recommendation deleted successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Recommendation not found',
    type: ErrorResponseDto,
  })
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.aiRecommendationsService.remove(id, user.userId);
    return { message: 'AI recommendation deleted successfully' };
  }
}

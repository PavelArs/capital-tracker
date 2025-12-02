import { Controller, Get, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionType } from '../entities/subscription.entity';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto } from '../shared/dto';

@ApiTags('subscriptions')
@ApiBearerAuth('JWT-auth')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Get current subscription',
    description: 'Get the current subscription status of the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription retrieved successfully',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        type: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
        status: { type: 'string' },
        startDate: { type: 'string', format: 'date-time' },
        endDate: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async getCurrentSubscription(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.getCurrentSubscription(user.userId);
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upgrade subscription',
    description: 'Upgrade user subscription to a higher tier',
  })
  @ApiBody({
    schema: {
      properties: {
        type: {
          type: 'string',
          enum: ['free', 'pro', 'enterprise'],
          example: 'pro',
        },
      },
      required: ['type'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription upgraded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid subscription type',
    type: ErrorResponseDto,
  })
  async upgradeSubscription(
    @CurrentUser() user: JwtPayload,
    @Body() body: { type: SubscriptionType },
  ) {
    return this.subscriptionsService.upgradeSubscription(user.userId, body.type);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel subscription',
    description: 'Cancel current subscription and revert to free tier',
  })
  @ApiResponse({
    status: 200,
    description: 'Subscription cancelled successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async cancelSubscription(@CurrentUser() user: JwtPayload) {
    await this.subscriptionsService.cancelSubscription(user.userId);
    return { message: 'Subscription cancelled successfully' };
  }
}

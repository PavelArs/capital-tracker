import { Controller, Get, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionType } from '../entities/subscription.entity';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('current')
  async getCurrentSubscription(@CurrentUser() user: JwtPayload) {
    return this.subscriptionsService.getCurrentSubscription(user.userId);
  }

  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  async upgradeSubscription(
    @CurrentUser() user: JwtPayload,
    @Body() body: { type: SubscriptionType },
  ) {
    return this.subscriptionsService.upgradeSubscription(user.userId, body.type);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  async cancelSubscription(@CurrentUser() user: JwtPayload) {
    await this.subscriptionsService.cancelSubscription(user.userId);
    return { message: 'Subscription cancelled successfully' };
  }
}

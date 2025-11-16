import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionType } from '../entities/subscription.entity';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Get('current')
  async getCurrentSubscription(@Request() req) {
    return this.subscriptionsService.getCurrentSubscription(req.user.userId);
  }

  @Post('upgrade')
  async upgradeSubscription(
    @Request() req,
    @Body() body: { type: SubscriptionType },
  ) {
    return this.subscriptionsService.upgradeSubscription(
      req.user.userId,
      body.type,
    );
  }

  @Post('cancel')
  async cancelSubscription(@Request() req) {
    await this.subscriptionsService.cancelSubscription(req.user.userId);
    return { message: 'Subscription cancelled successfully' };
  }
}


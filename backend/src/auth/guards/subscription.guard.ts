import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { SubscriptionType } from '../../entities/subscription.entity';

export const REQUIRE_SUBSCRIPTION_KEY = 'requireSubscription';
export const RequireSubscription = (type: SubscriptionType) =>
  SetMetadata(REQUIRE_SUBSCRIPTION_KEY, type);

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private subscriptionsService: SubscriptionsService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredType = this.reflector.get<SubscriptionType>(
      REQUIRE_SUBSCRIPTION_KEY,
      context.getHandler(),
    );

    if (!requiredType) {
      return true; // No subscription requirement
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const hasAccess = await this.subscriptionsService.checkFeatureAccess(
      userId,
      requiredType,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `This feature requires ${requiredType} subscription`,
      );
    }

    return true;
  }
}


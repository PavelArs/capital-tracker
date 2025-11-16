import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionType, SubscriptionStatus } from '../entities/subscription.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getCurrentSubscription(userId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async getUserSubscriptionType(userId: string): Promise<SubscriptionType> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.subscriptionType;
  }

  async upgradeSubscription(
    userId: string,
    newType: SubscriptionType,
  ): Promise<Subscription> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Cancel current active subscription
    const currentSubscription = await this.getCurrentSubscription(userId);
    if (currentSubscription && currentSubscription.status === SubscriptionStatus.ACTIVE) {
      currentSubscription.status = SubscriptionStatus.CANCELLED;
      currentSubscription.cancelledAt = new Date();
      await this.subscriptionRepository.save(currentSubscription);
    }

    // Create new subscription
    const subscription = this.subscriptionRepository.create({
      userId,
      type: newType,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
    });

    // Set end date based on subscription type (for demo, set to 1 year)
    if (newType !== SubscriptionType.FREE) {
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1);
      subscription.endDate = endDate;
    }

    const savedSubscription = await this.subscriptionRepository.save(subscription);

    // Update user's subscription type
    user.subscriptionType = newType;
    await this.userRepository.save(user);

    return savedSubscription;
  }

  async cancelSubscription(userId: string): Promise<void> {
    const subscription = await this.getCurrentSubscription(userId);
    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    subscription.status = SubscriptionStatus.CANCELLED;
    subscription.cancelledAt = new Date();
    await this.subscriptionRepository.save(subscription);

    // Downgrade to FREE
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user) {
      user.subscriptionType = SubscriptionType.FREE;
      await this.userRepository.save(user);
    }
  }

  async checkFeatureAccess(
    userId: string,
    requiredType: SubscriptionType,
  ): Promise<boolean> {
    const userType = await this.getUserSubscriptionType(userId);
    
    const typeHierarchy = {
      [SubscriptionType.FREE]: 0,
      [SubscriptionType.PRO]: 1,
      [SubscriptionType.ENTERPRISE]: 2,
    };

    return typeHierarchy[userType] >= typeHierarchy[requiredType];
  }
}


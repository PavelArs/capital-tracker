import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Subscription, SubscriptionType, SubscriptionStatus } from '../entities/subscription.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const user = this.userRepository.create({
      email: registerDto.email,
      password: hashedPassword,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      subscriptionType: SubscriptionType.FREE,
    });

    const savedUser = await this.userRepository.save(user);

    // Create free subscription
    const subscription = this.subscriptionRepository.create({
      userId: savedUser.id,
      type: SubscriptionType.FREE,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
    });
    await this.subscriptionRepository.save(subscription);

    const { password, ...result } = savedUser;

    return {
      ...result,
      access_token: this.jwtService.sign({ sub: savedUser.id, email: savedUser.email }),
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    return {
      access_token: this.jwtService.sign({ sub: user.id, email: user.email }),
      user,
    };
  }

  async getProfile(userId: string): Promise<any> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { password, ...result } = user;
    return result;
  }
}


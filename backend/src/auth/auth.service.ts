import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Subscription, SubscriptionType, SubscriptionStatus } from '../entities/subscription.entity';
import { InvitationCode } from '../entities/invitation-code.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(InvitationCode)
    private invitationCodeRepository: Repository<InvitationCode>,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    // Verify invitation code
    const invitationCode = await this.invitationCodeRepository.findOne({
      where: { code: registerDto.invitationCode },
    });

    if (!invitationCode) {
      throw new BadRequestException('Invalid invitation code');
    }

    if (invitationCode.isUsed) {
      throw new BadRequestException('Invitation code has already been used');
    }

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

    // Mark invitation code as used
    invitationCode.isUsed = true;
    invitationCode.usedByUserId = savedUser.id;
    invitationCode.usedAt = new Date();
    await this.invitationCodeRepository.save(invitationCode);

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

  async generateInvitationCode(userId: string): Promise<InvitationCode> {
    // Check if user already has an invitation code
    const existingCode = await this.invitationCodeRepository.findOne({
      where: { createdByUserId: userId, isUsed: false },
    });

    if (existingCode) {
      throw new BadRequestException('You already have an active invitation code');
    }

    // Generate unique code
    let code: string;
    let isUnique = false;
    
    while (!isUnique) {
      code = randomBytes(4).toString('hex').toUpperCase();
      const existing = await this.invitationCodeRepository.findOne({
        where: { code },
      });
      if (!existing) {
        isUnique = true;
      }
    }

    const invitationCode = this.invitationCodeRepository.create({
      code,
      createdByUserId: userId,
    });

    return await this.invitationCodeRepository.save(invitationCode);
  }

  async getMyInvitationCode(userId: string): Promise<InvitationCode | null> {
    return await this.invitationCodeRepository.findOne({
      where: { createdByUserId: userId },
    });
  }
}


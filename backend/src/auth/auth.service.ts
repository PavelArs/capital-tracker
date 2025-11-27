import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User } from '../entities/user.entity';
import {
  Subscription,
  SubscriptionType,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { InvitationCode } from '../entities/invitation-code.entity';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { EmailService } from '../email/email.service';
import {
  UserNotFoundException,
  DuplicateEmailException,
  EmailNotVerifiedException,
  InvalidTokenException,
  InvalidInvitationCodeException,
  InvitationCodeAlreadyUsedException,
  InvitationCodeNotAllowedException,
  ActiveInvitationCodeExistsException,
} from '../shared/exceptions';

export interface UserWithoutPassword {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  subscriptionType: SubscriptionType;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginResponse {
  access_token: string;
  user: UserWithoutPassword;
}

export interface RegisterResponse extends UserWithoutPassword {
  access_token?: string;
  message: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(InvitationCode)
    private readonly invitationCodeRepository: Repository<InvitationCode>,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthService.name);
  }

  private get isDevelopment(): boolean {
    return this.configService.get<string>('NODE_ENV', 'development') === 'development';
  }

  private get skipEmailVerification(): boolean {
    return (
      this.configService.get<string>('SKIP_EMAIL_VERIFICATION') === 'true' || this.isDevelopment
    );
  }

  private get devInvitationCode(): string {
    return this.configService.get<string>('DEV_INVITATION_CODE', 'DEV2024');
  }

  async register(registerDto: RegisterDto): Promise<RegisterResponse> {
    this.logger.info({ email: registerDto.email }, 'Processing registration');

    // Check if using dev invitation code (only works in development)
    const isDevCode = this.isDevelopment && registerDto.invitationCode === this.devInvitationCode;

    let invitationCode: InvitationCode | null = null;

    if (!isDevCode) {
      invitationCode = await this.validateInvitationCode(registerDto.invitationCode);
    }

    // Check for existing user
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      this.logger.warn({ email: registerDto.email }, 'Registration failed: email already exists');
      throw new DuplicateEmailException(registerDto.email);
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Generate email verification token (only if not skipping verification)
    let verificationToken: string | null = null;
    let hashedVerificationToken: string | null = null;

    if (!this.skipEmailVerification) {
      verificationToken = randomBytes(32).toString('hex');
      hashedVerificationToken = await bcrypt.hash(verificationToken, 10);
    }

    const user = this.userRepository.create({
      email: registerDto.email,
      password: hashedPassword,
      firstName: registerDto.firstName ?? null,
      lastName: registerDto.lastName ?? null,
      subscriptionType: SubscriptionType.FREE,
      emailVerified: this.skipEmailVerification,
      emailVerificationToken: hashedVerificationToken,
    });

    const savedUser = await this.userRepository.save(user);
    this.logger.info({ userId: savedUser.id }, 'User created successfully');

    // Mark invitation code as used (skip for dev code)
    if (!isDevCode && invitationCode) {
      invitationCode.isUsed = true;
      invitationCode.usedByUserId = savedUser.id;
      invitationCode.usedAt = new Date();
      await this.invitationCodeRepository.save(invitationCode);
    }

    // Create free subscription
    const subscription = this.subscriptionRepository.create({
      userId: savedUser.id,
      type: SubscriptionType.FREE,
      status: SubscriptionStatus.ACTIVE,
      startDate: new Date(),
    });
    await this.subscriptionRepository.save(subscription);

    // Send email verification (only if not skipping and token exists)
    if (!this.skipEmailVerification && verificationToken) {
      await this.sendVerificationEmail(savedUser, verificationToken);
    }

    const userResponse = this.excludePassword(savedUser);

    // Return access token in dev mode with skip verification
    if (this.skipEmailVerification) {
      return {
        ...userResponse,
        access_token: this.jwtService.sign({
          sub: savedUser.id,
          email: savedUser.email,
        }),
        message: 'Registration successful. You can now log in.',
      };
    }

    return {
      ...userResponse,
      message: 'Registration successful. Please check your email to verify your account.',
    };
  }

  async validateUser(email: string, password: string): Promise<UserWithoutPassword | null> {
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return null;
    }

    // Check if email is verified (skip in dev mode)
    if (!this.skipEmailVerification && !user.emailVerified) {
      throw new EmailNotVerifiedException();
    }

    return this.excludePassword(user);
  }

  async login(user: UserWithoutPassword): Promise<LoginResponse> {
    this.logger.info({ userId: user.id }, 'User logged in');
    return {
      access_token: this.jwtService.sign({ sub: user.id, email: user.email }),
      user,
    };
  }

  async getProfile(userId: string): Promise<UserWithoutPassword> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new UserNotFoundException(userId);
    }

    return this.excludePassword(user);
  }

  async generateInvitationCode(userId: string): Promise<InvitationCode> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UserNotFoundException(userId);
    }

    if (user.subscriptionType === SubscriptionType.FREE) {
      throw new InvitationCodeNotAllowedException();
    }

    // Check if user already has an invitation code
    const existingCode = await this.invitationCodeRepository.findOne({
      where: { createdByUserId: userId, isUsed: false },
    });

    if (existingCode) {
      throw new ActiveInvitationCodeExistsException();
    }

    // Generate unique code
    const code = await this.generateUniqueCode();

    const invitationCode = this.invitationCodeRepository.create({
      code,
      createdByUserId: userId,
    });

    this.logger.info({ userId }, 'Invitation code generated');
    return await this.invitationCodeRepository.save(invitationCode);
  }

  async getMyInvitationCode(userId: string): Promise<InvitationCode | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UserNotFoundException(userId);
    }

    const invitationCode = await this.invitationCodeRepository.findOne({
      where: { createdByUserId: userId },
    });

    // If user downgraded to FREE and code is not used yet, mark it as invalid
    if (
      invitationCode &&
      !invitationCode.isUsed &&
      user.subscriptionType === SubscriptionType.FREE
    ) {
      return null;
    }

    return invitationCode;
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const secureMessage =
      'If an account with that email exists, a password reset link has been sent.';

    const user = await this.userRepository.findOne({
      where: { email: forgotPasswordDto.email },
    });

    if (!user) {
      this.logger.debug(
        { email: forgotPasswordDto.email },
        'Password reset requested for non-existent email',
      );
      return { message: secureMessage };
    }

    try {
      const resetToken = randomBytes(32).toString('hex');
      const hashedToken = await bcrypt.hash(resetToken, 10);

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
      await this.userRepository.save(user);

      await this.emailService.sendPasswordResetEmail(user.email, resetToken);
      this.logger.info({ userId: user.id }, 'Password reset email sent');
    } catch (error) {
      this.logger.error(
        { error, email: forgotPasswordDto.email },
        'Failed to send password reset email',
      );
    }

    return { message: secureMessage };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const users = await this.userRepository.find({
      where: {
        resetPasswordExpires: MoreThan(new Date()),
      },
    });

    let user: User | null = null;
    for (const u of users) {
      if (u.resetPasswordToken) {
        const isValid = await bcrypt.compare(resetPasswordDto.token, u.resetPasswordToken);
        if (isValid) {
          user = u;
          break;
        }
      }
    }

    if (!user) {
      throw new InvalidTokenException('reset');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await this.userRepository.save(user);

    await this.emailService.sendPasswordChangedEmail(user.email);
    this.logger.info({ userId: user.id }, 'Password reset completed');

    return { message: 'Password has been reset successfully' };
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<{ message: string }> {
    const users = await this.userRepository.find({
      where: { emailVerified: false },
    });

    let user: User | null = null;
    for (const u of users) {
      if (u.emailVerificationToken) {
        const isValid = await bcrypt.compare(verifyEmailDto.token, u.emailVerificationToken);
        if (isValid) {
          user = u;
          break;
        }
      }
    }

    if (!user) {
      throw new InvalidTokenException('verification');
    }

    if (user.emailVerified) {
      return { message: 'Email already verified. You can log in.' };
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepository.save(user);

    try {
      await this.emailService.sendWelcomeEmail(user.email, user.firstName);
    } catch (error) {
      this.logger.error({ error, userId: user.id }, 'Failed to send welcome email');
    }

    this.logger.info({ userId: user.id }, 'Email verified successfully');
    return { message: 'Email verified successfully. You can now log in.' };
  }

  async resendVerification(
    resendVerificationDto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const secureMessage =
      'If your email is registered and not verified, you will receive a verification link.';

    const user = await this.userRepository.findOne({
      where: { email: resendVerificationDto.email },
    });

    if (!user || user.emailVerified) {
      return { message: secureMessage };
    }

    try {
      const verificationToken = randomBytes(32).toString('hex');
      const hashedVerificationToken = await bcrypt.hash(verificationToken, 10);

      user.emailVerificationToken = hashedVerificationToken;
      await this.userRepository.save(user);

      await this.emailService.sendEmailVerification(user.email, user.firstName, verificationToken);
      this.logger.info({ userId: user.id }, 'Verification email resent');
    } catch (error) {
      this.logger.error(
        { error, email: resendVerificationDto.email },
        'Failed to send verification email',
      );
    }

    return { message: secureMessage };
  }

  private async validateInvitationCode(code: string): Promise<InvitationCode> {
    const invitationCode = await this.invitationCodeRepository.findOne({
      where: { code },
      relations: ['createdBy'],
    });

    if (!invitationCode) {
      throw new InvalidInvitationCodeException();
    }

    if (invitationCode.isUsed) {
      throw new InvitationCodeAlreadyUsedException();
    }

    if (
      invitationCode.createdBy &&
      invitationCode.createdBy.subscriptionType === SubscriptionType.FREE
    ) {
      throw new InvalidInvitationCodeException();
    }

    return invitationCode;
  }

  private async generateUniqueCode(): Promise<string> {
    let code: string;
    let isUnique = false;

    do {
      code = randomBytes(4).toString('hex').toUpperCase();
      const existing = await this.invitationCodeRepository.findOne({
        where: { code },
      });
      isUnique = !existing;
    } while (!isUnique);

    return code;
  }

  private async sendVerificationEmail(user: User, token: string): Promise<void> {
    try {
      await this.emailService.sendEmailVerification(user.email, user.firstName, token);
    } catch (error) {
      this.logger.error({ error, userId: user.id }, 'Failed to send verification email');
    }
  }

  private excludePassword(user: User): UserWithoutPassword {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      subscriptionType: user.subscriptionType,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

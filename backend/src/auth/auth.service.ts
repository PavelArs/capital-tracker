import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User } from '../entities/user.entity';
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
} from '../shared/exceptions';

export interface UserWithoutPassword {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
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

  async register(registerDto: RegisterDto): Promise<RegisterResponse> {
    this.logger.info({ email: registerDto.email }, 'Processing registration');

    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      this.logger.warn({ email: registerDto.email }, 'Registration failed: email already exists');
      throw new DuplicateEmailException(registerDto.email);
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

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
      emailVerified: this.skipEmailVerification,
      emailVerificationToken: hashedVerificationToken,
    });

    const savedUser = await this.userRepository.save(user);
    this.logger.info({ userId: savedUser.id }, 'User created successfully');

    if (!this.skipEmailVerification && verificationToken) {
      await this.sendVerificationEmail(savedUser, verificationToken);
    }

    const userResponse = this.excludePassword(savedUser);

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
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

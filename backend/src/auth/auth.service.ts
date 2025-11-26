import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThan } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { User } from "../entities/user.entity";
import {
  Subscription,
  SubscriptionType,
  SubscriptionStatus,
} from "../entities/subscription.entity";
import { InvitationCode } from "../entities/invitation-code.entity";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { EmailService } from "../email/email.service";
import { randomBytes } from "crypto";

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
    private emailService: EmailService
  ) {}

  async register(registerDto: RegisterDto) {
    const nodeEnv = process.env.NODE_ENV || "development";
    const isDevelopment = nodeEnv === "development";
    const devInvitationCode = process.env.DEV_INVITATION_CODE || "DEV2024";
    const skipEmailVerification =
      process.env.SKIP_EMAIL_VERIFICATION === "true" || isDevelopment;

    // Check if using dev invitation code (only works in development)
    const isDevCode =
      isDevelopment && registerDto.invitationCode === devInvitationCode;

    let invitationCode = null;

    if (!isDevCode) {
      // Verify invitation code normally
      invitationCode = await this.invitationCodeRepository.findOne({
        where: { code: registerDto.invitationCode },
        relations: ["createdBy"],
      });

      if (!invitationCode) {
        throw new BadRequestException("Invalid invitation code");
      }

      if (invitationCode.isUsed) {
        throw new BadRequestException("Invitation code has already been used");
      }

      // Check if the creator still has valid subscription (Pro/Enterprise)
      // If code was created by a user who is now FREE, code is not valid (unless already used)
      if (invitationCode.createdBy) {
        if (
          invitationCode.createdBy.subscriptionType === SubscriptionType.FREE
        ) {
          throw new BadRequestException("Invalid invitation code");
        }
      }
    }

    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException("User with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    // Generate email verification token (only if not skipping verification)
    let verificationToken: string | null = null;
    let hashedVerificationToken: string | null = null;

    if (!skipEmailVerification) {
      verificationToken = randomBytes(32).toString("hex");
      hashedVerificationToken = await bcrypt.hash(verificationToken, 10);
    }

    const user = this.userRepository.create({
      email: registerDto.email,
      password: hashedPassword,
      firstName: registerDto.firstName,
      lastName: registerDto.lastName,
      subscriptionType: SubscriptionType.FREE,
      emailVerified: skipEmailVerification, // Skip verification in dev mode
      emailVerificationToken: hashedVerificationToken,
    });

    const savedUser = await this.userRepository.save(user);

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
    if (!skipEmailVerification && verificationToken) {
      try {
        await this.emailService.sendEmailVerification(
          savedUser.email,
          savedUser.firstName,
          verificationToken
        );
      } catch (error) {
        console.error("Failed to send verification email:", error);
        // Don't fail registration if email fails
      }
    }

    const { password, ...result } = savedUser;

    // Return access token in dev mode with skip verification
    if (skipEmailVerification) {
      return {
        ...result,
        access_token: this.jwtService.sign({
          sub: savedUser.id,
          email: savedUser.email,
        }),
        message: "Registration successful. You can now log in.",
      };
    }

    return {
      ...result,
      message:
        "Registration successful. Please check your email to verify your account.",
    };
  }

  async validateUser(email: string, password: string): Promise<any> {
    const nodeEnv = process.env.NODE_ENV || "development";
    const isDevelopment = nodeEnv === "development";
    const skipEmailVerification =
      process.env.SKIP_EMAIL_VERIFICATION === "true" || isDevelopment;

    const user = await this.userRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(password, user.password))) {
      // Check if email is verified (skip in dev mode)
      if (!skipEmailVerification && !user.emailVerified) {
        throw new UnauthorizedException(
          "Please verify your email before logging in. Check your inbox for the verification link."
        );
      }
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
      throw new UnauthorizedException("User not found");
    }
    const { password, ...result } = user;
    return result;
  }

  async generateInvitationCode(userId: string): Promise<InvitationCode> {
    // Check user subscription type - only Pro/Enterprise can generate codes
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    if (user.subscriptionType === SubscriptionType.FREE) {
      throw new BadRequestException(
        "Invitation codes are only available for Pro and Enterprise subscribers. Upgrade your subscription to share invitations."
      );
    }

    // Check if user already has an invitation code
    const existingCode = await this.invitationCodeRepository.findOne({
      where: { createdByUserId: userId, isUsed: false },
    });

    if (existingCode) {
      throw new BadRequestException(
        "You already have an active invitation code"
      );
    }

    // Generate unique code
    let code: string;
    let isUnique = false;

    while (!isUnique) {
      code = randomBytes(4).toString("hex").toUpperCase();
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
    // Get user to check subscription type
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
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
      // Code exists but user is FREE - code is not valid anymore
      return null;
    }

    return invitationCode;
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: forgotPasswordDto.email },
    });

    // Always return same message for security (don't reveal if email exists)
    const secureMessage =
      "If an account with that email exists, a password reset link has been sent.";

    if (!user) {
      // User doesn't exist - don't reveal this, don't send email
      return { message: secureMessage };
    }

    // User exists - send password reset email
    try {
      // Generate reset token
      const resetToken = randomBytes(32).toString("hex");
      const hashedToken = await bcrypt.hash(resetToken, 10);

      // Set token and expiration (1 hour from now)
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
      await this.userRepository.save(user);

      // Send reset email
      await this.emailService.sendPasswordResetEmail(user.email, resetToken);
    } catch (error) {
      // Even if email sending fails, return same message for security
      console.error("Failed to send password reset email:", error);
    }

    return { message: secureMessage };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto
  ): Promise<{ message: string }> {
    // Find users with non-expired tokens
    const users = await this.userRepository.find({
      where: {
        resetPasswordExpires: MoreThan(new Date()),
      },
    });

    // Find user with matching token
    let user: User | null = null;
    for (const u of users) {
      if (u.resetPasswordToken) {
        const isValid = await bcrypt.compare(
          resetPasswordDto.token,
          u.resetPasswordToken
        );
        if (isValid) {
          user = u;
          break;
        }
      }
    }

    if (!user) {
      throw new BadRequestException("Invalid or expired reset token");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    // Update password and clear reset token
    user.password = hashedPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await this.userRepository.save(user);

    // Send confirmation email
    await this.emailService.sendPasswordChangedEmail(user.email);

    return { message: "Password has been reset successfully" };
  }

  async verifyEmail(
    verifyEmailDto: VerifyEmailDto
  ): Promise<{ message: string }> {
    // Find users with verification token
    const users = await this.userRepository.find({
      where: {
        emailVerified: false,
      },
    });

    // Find user with matching token
    let user: User | null = null;
    for (const u of users) {
      if (u.emailVerificationToken) {
        const isValid = await bcrypt.compare(
          verifyEmailDto.token,
          u.emailVerificationToken
        );
        if (isValid) {
          user = u;
          break;
        }
      }
    }

    if (!user) {
      throw new BadRequestException("Invalid or expired verification token");
    }

    // Check if already verified (prevent duplicate welcome emails)
    if (user.emailVerified) {
      return { message: "Email already verified. You can log in." };
    }

    // Verify email
    user.emailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepository.save(user);

    // Send welcome email after verification (only once)
    try {
      await this.emailService.sendWelcomeEmail(user.email, user.firstName);
    } catch (error) {
      // Log error but don't fail verification if email fails
      console.error("Failed to send welcome email:", error);
    }

    return { message: "Email verified successfully. You can now log in." };
  }

  async resendVerification(
    resendVerificationDto: ResendVerificationDto
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { email: resendVerificationDto.email },
    });

    // Always return same message for security (don't reveal if email exists or is verified)
    const secureMessage =
      "If your email is registered and not verified, you will receive a verification link.";

    if (!user) {
      // User doesn't exist - don't reveal this, don't send email
      return { message: secureMessage };
    }

    if (user.emailVerified) {
      // Email already verified - don't reveal this, don't send email
      return { message: secureMessage };
    }

    // User exists and not verified - send verification email
    try {
      // Generate new verification token
      const verificationToken = randomBytes(32).toString("hex");
      const hashedVerificationToken = await bcrypt.hash(verificationToken, 10);

      user.emailVerificationToken = hashedVerificationToken;
      await this.userRepository.save(user);

      // Send verification email
      await this.emailService.sendEmailVerification(
        user.email,
        user.firstName,
        verificationToken
      );
    } catch (error) {
      // Even if email sending fails, return same message for security
      console.error("Failed to send verification email:", error);
    }

    return { message: secureMessage };
  }
}

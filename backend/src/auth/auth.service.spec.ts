import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from '../entities/user.entity';
import { Subscription, SubscriptionType } from '../entities/subscription.entity';
import { InvitationCode } from '../entities/invitation-code.entity';
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
import { RegisterDto } from './dto/register.dto';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let subscriptionRepository: jest.Mocked<Repository<Subscription>>;
  let invitationCodeRepository: jest.Mocked<Repository<InvitationCode>>;
  let jwtService: jest.Mocked<JwtService>;
  let emailService: jest.Mocked<EmailService>;
  let configService: jest.Mocked<ConfigService>;

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    password: 'hashedPassword123',
    firstName: 'John',
    lastName: 'Doe',
    subscriptionType: SubscriptionType.FREE,
    emailVerified: true,
    emailVerificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    subscriptions: [],
    capitals: [],
    generatedInvitationCodes: [],
    usedInvitationCode: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockInvitationCode: InvitationCode = {
    id: 'code-123',
    code: 'VALID123',
    isUsed: false,
    createdByUserId: 'creator-user',
    usedByUserId: null,
    usedAt: null,
    createdBy: { ...mockUser, subscriptionType: SubscriptionType.PRO } as any,
    usedBy: null,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Subscription),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(InvitationCode),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: {
            sendEmailVerification: jest.fn(),
            sendWelcomeEmail: jest.fn(),
            sendPasswordResetEmail: jest.fn(),
            sendPasswordChangedEmail: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: PinoLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
    subscriptionRepository = module.get(getRepositoryToken(Subscription));
    invitationCodeRepository = module.get(getRepositoryToken(InvitationCode));
    jwtService = module.get(JwtService);
    emailService = module.get(EmailService);
    configService = module.get(ConfigService);

    // Default config values - development mode with skip verification
    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'SKIP_EMAIL_VERIFICATION') return 'true';
      if (key === 'DEV_INVITATION_CODE') return 'DEV2024';
      return undefined;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'newuser@example.com',
      password: 'Password123!',
      firstName: 'Jane',
      lastName: 'Smith',
      invitationCode: 'DEV2024',
    };

    it('should register a new user with dev invitation code in development mode', async () => {
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userRepository.create.mockReturnValue({ ...mockUser, email: registerDto.email } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        email: registerDto.email,
      } as any);
      subscriptionRepository.create.mockReturnValue({} as any);
      subscriptionRepository.save.mockResolvedValue({} as any);
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.register(registerDto);

      expect(result.email).toBe(registerDto.email);
      expect(result.access_token).toBe('jwt-token');
      expect(result.message).toContain('Registration successful');
      expect(invitationCodeRepository.findOne).not.toHaveBeenCalled(); // Dev code skips validation
    });

    it('should register with valid invitation code', async () => {
      const dtoWithRealCode = { ...registerDto, invitationCode: 'VALID123' };

      invitationCodeRepository.findOne.mockResolvedValue(mockInvitationCode as any);
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userRepository.create.mockReturnValue({ ...mockUser, email: dtoWithRealCode.email } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        email: dtoWithRealCode.email,
      } as any);
      subscriptionRepository.create.mockReturnValue({} as any);
      subscriptionRepository.save.mockResolvedValue({} as any);
      invitationCodeRepository.save.mockResolvedValue({} as any);
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.register(dtoWithRealCode);

      expect(result.email).toBe(dtoWithRealCode.email);
      expect(invitationCodeRepository.save).toHaveBeenCalled();
    });

    it('should throw DuplicateEmailException when email already exists', async () => {
      // Use a fresh invitation code that is NOT used
      const freshInvitationCode = { ...mockInvitationCode, isUsed: false };
      invitationCodeRepository.findOne.mockResolvedValue(freshInvitationCode as any);
      userRepository.findOne.mockResolvedValue(mockUser as any);

      await expect(
        service.register({ ...registerDto, invitationCode: 'VALID123' }),
      ).rejects.toThrow(DuplicateEmailException);
    });

    it('should throw InvalidInvitationCodeException for invalid code', async () => {
      invitationCodeRepository.findOne.mockResolvedValue(null);

      await expect(service.register({ ...registerDto, invitationCode: 'INVALID' })).rejects.toThrow(
        InvalidInvitationCodeException,
      );
    });

    it('should throw InvitationCodeAlreadyUsedException for used code', async () => {
      invitationCodeRepository.findOne.mockResolvedValue({
        ...mockInvitationCode,
        isUsed: true,
      } as any);

      await expect(service.register({ ...registerDto, invitationCode: 'USED123' })).rejects.toThrow(
        InvitationCodeAlreadyUsedException,
      );
    });
  });

  describe('validateUser', () => {
    it('should return user without password when credentials are valid', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test@example.com', 'password123');

      expect(result).toBeDefined();
      expect(result?.email).toBe(mockUser.email);
      expect((result as any).password).toBeUndefined();
    });

    it('should return null when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.validateUser('nonexistent@example.com', 'password123');

      expect(result).toBeNull();
    });

    it('should return null when password is incorrect', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('test@example.com', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should throw EmailNotVerifiedException when email not verified in production', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SKIP_EMAIL_VERIFICATION') return 'false';
        return undefined;
      });

      const unverifiedUser = { ...mockUser, emailVerified: false };
      userRepository.findOne.mockResolvedValue(unverifiedUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.validateUser('test@example.com', 'password123')).rejects.toThrow(
        EmailNotVerifiedException,
      );
    });
  });

  describe('login', () => {
    it('should return access token and user data', async () => {
      const userWithoutPassword = {
        id: mockUser.id,
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        subscriptionType: mockUser.subscriptionType,
        emailVerified: mockUser.emailVerified,
        createdAt: mockUser.createdAt,
        updatedAt: mockUser.updatedAt,
      };
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.login(userWithoutPassword);

      expect(result.access_token).toBe('jwt-token');
      expect(result.user).toEqual(userWithoutPassword);
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);

      const result = await service.getProfile(mockUser.id);

      expect(result.email).toBe(mockUser.email);
      expect((result as any).password).toBeUndefined();
    });

    it('should throw UserNotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getProfile('non-existent-id')).rejects.toThrow(UserNotFoundException);
    });
  });

  describe('generateInvitationCode', () => {
    it('should generate invitation code for pro user', async () => {
      const proUser = { ...mockUser, subscriptionType: SubscriptionType.PRO };
      userRepository.findOne.mockResolvedValue(proUser as any);
      invitationCodeRepository.findOne
        .mockResolvedValueOnce(null) // No existing code
        .mockResolvedValueOnce(null); // Code is unique
      invitationCodeRepository.create.mockReturnValue({ code: 'NEWCODE1' } as any);
      invitationCodeRepository.save.mockResolvedValue({ code: 'NEWCODE1' } as any);

      const result = await service.generateInvitationCode(proUser.id);

      expect(result.code).toBe('NEWCODE1');
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should throw UserNotFoundException for non-existent user', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.generateInvitationCode('non-existent')).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('should throw InvitationCodeNotAllowedException for free users', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);

      await expect(service.generateInvitationCode(mockUser.id)).rejects.toThrow(
        InvitationCodeNotAllowedException,
      );
    });

    it('should throw ActiveInvitationCodeExistsException when code already exists', async () => {
      const proUser = { ...mockUser, subscriptionType: SubscriptionType.PRO };
      userRepository.findOne.mockResolvedValue(proUser as any);
      invitationCodeRepository.findOne.mockResolvedValue(mockInvitationCode as any);

      await expect(service.generateInvitationCode(proUser.id)).rejects.toThrow(
        ActiveInvitationCodeExistsException,
      );
    });
  });

  describe('getMyInvitationCode', () => {
    it('should return invitation code for pro user', async () => {
      const proUser = { ...mockUser, subscriptionType: SubscriptionType.PRO };
      userRepository.findOne.mockResolvedValue(proUser as any);
      invitationCodeRepository.findOne.mockResolvedValue(mockInvitationCode as any);

      const result = await service.getMyInvitationCode(proUser.id);

      expect(result).toEqual(mockInvitationCode);
    });

    it('should return null for free user with unused code', async () => {
      // mockUser has FREE subscription type by default
      userRepository.findOne.mockResolvedValue(mockUser as any);
      // Create an unused invitation code
      const unusedCode = { ...mockInvitationCode, isUsed: false };
      invitationCodeRepository.findOne.mockResolvedValue(unusedCode as any);

      const result = await service.getMyInvitationCode(mockUser.id);

      expect(result).toBeNull();
    });

    it('should throw UserNotFoundException for non-existent user', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getMyInvitationCode('non-existent')).rejects.toThrow(
        UserNotFoundException,
      );
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset email for existing user', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedToken');
      userRepository.save.mockResolvedValue(mockUser as any);
      emailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      const result = await service.forgotPassword({ email: mockUser.email });

      expect(result.message).toContain('password reset link');
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should return secure message for non-existent user', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'nonexistent@example.com' });

      expect(result.message).toContain('password reset link');
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const userWithToken = {
        ...mockUser,
        resetPasswordToken: 'hashedToken',
        resetPasswordExpires: new Date(Date.now() + 3600000),
      };
      userRepository.find.mockResolvedValue([userWithToken] as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newHashedPassword');
      userRepository.save.mockResolvedValue(mockUser as any);
      emailService.sendPasswordChangedEmail.mockResolvedValue(undefined);

      const result = await service.resetPassword({
        token: 'validToken',
        newPassword: 'NewPassword123!',
      });

      expect(result.message).toContain('successfully');
      expect(emailService.sendPasswordChangedEmail).toHaveBeenCalled();
    });

    it('should throw InvalidTokenException for invalid token', async () => {
      userRepository.find.mockResolvedValue([]);

      await expect(
        service.resetPassword({ token: 'invalidToken', newPassword: 'NewPassword123!' }),
      ).rejects.toThrow(InvalidTokenException);
    });
  });

  describe('verifyEmail', () => {
    it('should verify email with valid token', async () => {
      const unverifiedUser = {
        ...mockUser,
        emailVerified: false,
        emailVerificationToken: 'hashedToken',
      };
      userRepository.find.mockResolvedValue([unverifiedUser] as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userRepository.save.mockResolvedValue({ ...unverifiedUser, emailVerified: true } as any);
      emailService.sendWelcomeEmail.mockResolvedValue(undefined);

      const result = await service.verifyEmail({ token: 'validToken' });

      expect(result.message).toContain('verified successfully');
    });

    it('should return message for already verified email', async () => {
      const verifiedUser = {
        ...mockUser,
        emailVerified: true,
        emailVerificationToken: 'hashedToken',
      };
      userRepository.find.mockResolvedValue([verifiedUser] as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyEmail({ token: 'validToken' });

      expect(result.message).toContain('already verified');
    });

    it('should throw InvalidTokenException for invalid token', async () => {
      userRepository.find.mockResolvedValue([]);

      await expect(service.verifyEmail({ token: 'invalidToken' })).rejects.toThrow(
        InvalidTokenException,
      );
    });
  });

  describe('resendVerification', () => {
    it('should resend verification email for unverified user', async () => {
      const unverifiedUser = { ...mockUser, emailVerified: false };
      userRepository.findOne.mockResolvedValue(unverifiedUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newHashedToken');
      userRepository.save.mockResolvedValue(unverifiedUser as any);
      emailService.sendEmailVerification.mockResolvedValue(undefined);

      const result = await service.resendVerification({ email: mockUser.email });

      expect(result.message).toContain('verification link');
      expect(emailService.sendEmailVerification).toHaveBeenCalled();
    });

    it('should return secure message for verified or non-existent user', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any); // Already verified

      const result = await service.resendVerification({ email: mockUser.email });

      expect(result.message).toContain('verification link');
      expect(emailService.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('should handle email sending failure gracefully', async () => {
      const unverifiedUser = { ...mockUser, emailVerified: false };
      userRepository.findOne.mockResolvedValue(unverifiedUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newHashedToken');
      userRepository.save.mockResolvedValue(unverifiedUser as any);
      emailService.sendEmailVerification.mockRejectedValue(new Error('Email failed'));

      const result = await service.resendVerification({ email: mockUser.email });

      expect(result.message).toContain('verification link');
    });
  });

  describe('register with production settings', () => {
    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SKIP_EMAIL_VERIFICATION') return 'false';
        if (key === 'DEV_INVITATION_CODE') return '';
        return undefined;
      });
    });

    it('should register user and send verification email in production', async () => {
      const freshInvitationCode = { ...mockInvitationCode, isUsed: false };
      invitationCodeRepository.findOne.mockResolvedValue(freshInvitationCode as any);
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userRepository.create.mockReturnValue({ ...mockUser, emailVerified: false } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        emailVerified: false,
      } as any);
      subscriptionRepository.create.mockReturnValue({} as any);
      subscriptionRepository.save.mockResolvedValue({} as any);
      invitationCodeRepository.save.mockResolvedValue({} as any);
      emailService.sendEmailVerification.mockResolvedValue(undefined);

      const result = await service.register({
        email: 'newuser@example.com',
        password: 'Password123!',
        firstName: 'Jane',
        lastName: 'Smith',
        invitationCode: 'VALID123',
      });

      expect(result.message).toContain('check your email');
      expect(result.access_token).toBeUndefined();
    });
  });

  describe('forgotPassword edge cases', () => {
    it('should handle email sending failure gracefully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedToken');
      userRepository.save.mockResolvedValue(mockUser as any);
      emailService.sendPasswordResetEmail.mockRejectedValue(new Error('Email failed'));

      const result = await service.forgotPassword({ email: mockUser.email });

      expect(result.message).toContain('password reset link');
    });
  });

  describe('validateInvitationCode edge cases', () => {
    it('should throw InvalidInvitationCodeException when creator is free user', async () => {
      const freeCreatorCode = {
        ...mockInvitationCode,
        isUsed: false,
        createdBy: { ...mockUser, subscriptionType: SubscriptionType.FREE },
      };
      invitationCodeRepository.findOne.mockResolvedValue(freeCreatorCode as any);

      await expect(
        service.register({
          email: 'newuser@example.com',
          password: 'Password123!',
          invitationCode: 'VALID123',
        }),
      ).rejects.toThrow(InvalidInvitationCodeException);
    });
  });

  describe('sendVerificationEmail edge case', () => {
    it('should handle verification email failure during registration', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'SKIP_EMAIL_VERIFICATION') return 'false';
        if (key === 'DEV_INVITATION_CODE') return '';
        return undefined;
      });

      const freshInvitationCode = { ...mockInvitationCode, isUsed: false };
      invitationCodeRepository.findOne.mockResolvedValue(freshInvitationCode as any);
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      const newUserEmail = 'newuser@example.com';
      userRepository.create.mockReturnValue({
        ...mockUser,
        email: newUserEmail,
        emailVerified: false,
      } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        email: newUserEmail,
        emailVerified: false,
      } as any);
      subscriptionRepository.create.mockReturnValue({} as any);
      subscriptionRepository.save.mockResolvedValue({} as any);
      invitationCodeRepository.save.mockResolvedValue({} as any);
      emailService.sendEmailVerification.mockRejectedValue(new Error('Email failed'));

      const result = await service.register({
        email: newUserEmail,
        password: 'Password123!',
        invitationCode: 'VALID123',
      });

      // Should still complete registration despite email failure
      expect(result.email).toBe(newUserEmail);
    });
  });
});

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { User } from '../entities/user.entity';
import {
  DuplicateEmailException,
  EmailNotVerifiedException,
  InvalidTokenException,
  UserNotFoundException,
} from '../shared/exceptions';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: jest.Mocked<Repository<User>>;
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
    emailVerified: true,
    emailVerificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    jwtService = module.get(JwtService);
    emailService = module.get(EmailService);
    configService = module.get(ConfigService);

    configService.get.mockImplementation((key: string) => {
      if (key === 'NODE_ENV') return 'development';
      if (key === 'SKIP_EMAIL_VERIFICATION') return 'true';
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
    };

    it('should register a new user in development mode', async () => {
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userRepository.create.mockReturnValue({ ...mockUser, email: registerDto.email } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        email: registerDto.email,
      } as any);
      jwtService.sign.mockReturnValue('jwt-token');

      const result = await service.register(registerDto);

      expect(result.email).toBe(registerDto.email);
      expect(result.access_token).toBe('jwt-token');
      expect(result.message).toContain('Registration successful');
    });

    it('should throw DuplicateEmailException when email already exists', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);

      await expect(service.register(registerDto)).rejects.toThrow(DuplicateEmailException);
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

    it('should handle email sending failure gracefully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedToken');
      userRepository.save.mockResolvedValue(mockUser as any);
      emailService.sendPasswordResetEmail.mockRejectedValue(new Error('Email failed'));

      const result = await service.forgotPassword({ email: mockUser.email });

      expect(result.message).toContain('password reset link');
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
      userRepository.findOne.mockResolvedValue(mockUser as any);

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
        return undefined;
      });
    });

    it('should register user and send verification email in production', async () => {
      userRepository.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userRepository.create.mockReturnValue({ ...mockUser, emailVerified: false } as any);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        id: 'new-user-id',
        emailVerified: false,
      } as any);
      emailService.sendEmailVerification.mockResolvedValue(undefined);

      const result = await service.register({
        email: 'newuser@example.com',
        password: 'Password123!',
        firstName: 'Jane',
        lastName: 'Smith',
      });

      expect(result.message).toContain('check your email');
      expect(result.access_token).toBeUndefined();
    });

    it('should handle verification email failure during registration', async () => {
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
      emailService.sendEmailVerification.mockRejectedValue(new Error('Email failed'));

      const result = await service.register({
        email: newUserEmail,
        password: 'Password123!',
      });

      expect(result.email).toBe(newUserEmail);
    });
  });
});

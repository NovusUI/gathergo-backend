import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let jwtService: {
    sign: jest.Mock;
  };
  let mailService: {
    sendWelcomeEmail: jest.Mock;
    sendEmailVerificationCode: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn(),
    };
    mailService = {
      sendWelcomeEmail: jest.fn(),
      sendEmailVerificationCode: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: JwtService,
          useValue: jwtService,
        },
        {
          provide: FirebaseService,
          useValue: {
            getApp: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: mailService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.AUTH_EMAIL_VERIFICATION_REQUIRED;
    delete process.env.AUTH_EMAIL_VERIFICATION_CODE_LENGTH;
    delete process.env.AUTH_EMAIL_VERIFICATION_EXPIRY_MINUTES;
    delete process.env.AUTH_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;
    delete process.env.AUTH_EMAIL_VERIFICATION_MAX_ATTEMPTS;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns a verification step instead of tokens when email verification is required', async () => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true';
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password' as never);

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      username: null,
      fullName: null,
      isVerified: false,
    });
    prisma.user.update.mockResolvedValue({});
    mailService.sendEmailVerificationCode.mockResolvedValue({
      feature: 'email_verification_code',
      templateKey: 'email_verification_code',
      queued: true,
      skipped: false,
    });

    const result = await service.signup({
      email: ' John.Doe@example.com ',
      password: 'supersecret',
    });

    expect(result).toEqual({
      message: 'We sent a 6-digit verification code to your email.',
      email: 'john.doe@example.com',
      requiresVerification: true,
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'john.doe@example.com',
        password: 'hashed-password',
        isVerified: false,
      },
    });
    expect(mailService.sendEmailVerificationCode).toHaveBeenCalledWith({
      to: 'john.doe@example.com',
      name: 'John Doe',
      code: expect.stringMatching(/^\d{6}$/),
      expiresInMinutes: 10,
    });
    expect(mailService.sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('rolls back a pending signup if the verification code cannot be queued', async () => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true';
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password' as never);

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      username: null,
      fullName: null,
      isVerified: false,
    });
    prisma.user.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    prisma.user.delete.mockResolvedValue({});
    mailService.sendEmailVerificationCode.mockResolvedValue({
      feature: 'email_verification_code',
      templateKey: 'email_verification_code',
      queued: false,
      skipped: true,
      reason: 'MAIL_TEMPLATE_KEY_EMAIL_VERIFICATION_CODE is missing',
    });

    await expect(
      service.signup({
        email: 'john.doe@example.com',
        password: 'supersecret',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('keeps legacy signup behavior when email verification is not required', async () => {
    process.env.FRONTEND_URL = 'https://app.gathergo.test';
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password' as never);

    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      username: null,
      fullName: null,
      hasPreferences: false,
      isProfileComplete: false,
      isVerified: true,
    });
    prisma.refreshToken.create.mockResolvedValue({});
    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    mailService.sendWelcomeEmail.mockResolvedValue({
      feature: 'welcome_email',
      templateKey: 'welcome_email',
      queued: true,
      skipped: false,
    });

    const result = await service.signup({
      email: ' John.Doe@example.com ',
      password: 'supersecret',
    });

    expect(result).toEqual({
      accessToken: 'access-token',
      user: {
        id: 'user-1',
        email: 'john.doe@example.com',
        username: null,
        fullName: null,
        hasPreferences: false,
        isProfileComplete: false,
        isVerified: true,
      },
      refreshToken: 'refresh-token',
    });
    expect(mailService.sendWelcomeEmail).toHaveBeenCalledWith({
      to: 'john.doe@example.com',
      name: 'John Doe',
      loginLink: 'https://app.gathergo.test/login',
      profileSetupLink: 'https://app.gathergo.test/profile-setup',
      activationLink: 'https://app.gathergo.test/profile-setup',
    });
    expect(mailService.sendEmailVerificationCode).not.toHaveBeenCalled();
  });

  it('blocks password login for unverified email accounts and signals verification is required', async () => {
    process.env.AUTH_EMAIL_VERIFICATION_REQUIRED = 'true';
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const existingCode = '482913';
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      password: 'hashed-password',
      googleId: null,
      isVerified: false,
      emailVerificationCodeHash: crypto
        .createHash('sha256')
        .update(existingCode)
        .digest('hex'),
      emailVerificationCodeExpiry: new Date(Date.now() + 5 * 60 * 1000),
      emailVerificationSentAt: new Date(),
      emailVerificationAttempts: 0,
    });

    await expect(
      service.loginWithPassword({
        email: 'john.doe@example.com',
        password: 'supersecret',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'EMAIL_NOT_VERIFIED',
        email: 'john.doe@example.com',
        requiresVerification: true,
      }),
    });

    expect(mailService.sendEmailVerificationCode).not.toHaveBeenCalled();
  });

  it('verifies a code, signs the user in, and queues the welcome email', async () => {
    process.env.FRONTEND_URL = 'https://app.gathergo.test';

    const code = '482913';
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      password: 'hashed-password',
      username: null,
      fullName: 'John Doe',
      googleId: null,
      hasPreferences: false,
      isProfileComplete: false,
      isVerified: false,
      emailVerificationCodeHash: crypto
        .createHash('sha256')
        .update(code)
        .digest('hex'),
      emailVerificationCodeExpiry: new Date(Date.now() + 5 * 60 * 1000),
      emailVerificationSentAt: new Date(Date.now() - 60 * 1000),
      emailVerificationAttempts: 0,
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'john.doe@example.com',
      password: 'hashed-password',
      username: null,
      fullName: 'John Doe',
      googleId: null,
      hasPreferences: false,
      isProfileComplete: false,
      isVerified: true,
      emailVerificationCodeHash: null,
      emailVerificationCodeExpiry: null,
      emailVerificationSentAt: null,
      emailVerificationAttempts: 0,
    });
    prisma.refreshToken.create.mockResolvedValue({});
    jwtService.sign
      .mockReturnValueOnce('access-token')
      .mockReturnValueOnce('refresh-token');
    mailService.sendWelcomeEmail.mockResolvedValue({
      feature: 'welcome_email',
      templateKey: 'welcome_email',
      queued: true,
      skipped: false,
    });

    const result = await service.verifyEmailCode({
      email: 'john.doe@example.com',
      code,
    });

    expect(result).toEqual({
      message: 'Email verified successfully',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: expect.objectContaining({
        id: 'user-1',
        email: 'john.doe@example.com',
        isVerified: true,
      }),
    });
    expect(mailService.sendWelcomeEmail).toHaveBeenCalledWith({
      to: 'john.doe@example.com',
      name: 'John Doe',
      loginLink: 'https://app.gathergo.test/login',
      profileSetupLink: 'https://app.gathergo.test/profile-setup',
      activationLink: 'https://app.gathergo.test/profile-setup',
    });
  });
});

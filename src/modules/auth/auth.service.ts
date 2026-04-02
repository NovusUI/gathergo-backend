import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { GoogleLoginDto } from './dtos/google-login.dto';
import { VerifyUsernameDto } from './dtos/verify-username.dto';
import { PhoneFirebaseTokenDto } from './dtos/phone-firebase-token.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { OAuth2Client } from 'google-auth-library';
import { FirebaseService } from '../firebase/firebase.service';
import { MailService } from '../mail/mail.service';
import { VerifyEmailCodeDto } from './dtos/verify-email-code.dto';
import { ResendEmailVerificationCodeDto } from './dtos/resend-email-verification-code.dto';
import {
  getJwtExpiresIn,
  getJwtRefreshExpiresIn,
  getJwtRefreshSecret,
  getJwtSecret,
} from 'src/config/runtime-env';

const DEFAULT_EMAIL_VERIFICATION_CODE_LENGTH = 6;
const DEFAULT_EMAIL_VERIFICATION_EXPIRY_MINUTES = 10;
const DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
const DEFAULT_PASSWORD_RESET_CODE_LENGTH = 6;
const DEFAULT_PASSWORD_RESET_EXPIRY_MINUTES = 10;
const DEFAULT_PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_PASSWORD_RESET_MAX_ATTEMPTS = 5;

type EmailPasswordUser = {
  id: string;
  email: string;
  username?: string | null;
  fullName?: string | null;
  password?: string | null;
  googleId?: string | null;
  hasPreferences?: boolean;
  isProfileComplete?: boolean;
  isVerified: boolean;
  resetToken?: string | null;
  resetTokenExpiry?: Date | null;
  resetTokenSentAt?: Date | null;
  resetTokenAttempts?: number | null;
  emailVerificationCodeHash?: string | null;
  emailVerificationCodeExpiry?: Date | null;
  emailVerificationSentAt?: Date | null;
  emailVerificationAttempts?: number | null;
};

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly firebaseService: FirebaseService,
    private readonly mailService: MailService,
  ) {
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async signup(dto: SignupDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ForbiddenException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const verificationRequired = this.isEmailVerificationRequired();

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        isVerified: !verificationRequired,
      },
    });

    if (verificationRequired) {
      try {
        await this.issueEmailVerificationCode(user, {
          ignoreCooldown: true,
        });
      } catch (error) {
        await this.prisma.user
          .delete({ where: { id: user.id } })
          .catch((cleanupError: unknown) => {
            const reason =
              cleanupError instanceof Error
                ? cleanupError.message
                : 'unknown cleanup error';
            this.logger.error(
              `Failed to rollback unverified signup for ${normalizedEmail}: ${reason}`,
            );
          });

        throw error;
      }

      return {
        message: `We sent a ${this.getEmailVerificationCodeLength()}-digit verification code to your email.`,
        email: normalizedEmail,
        requiresVerification: true,
      };
    }

    this.queueWelcomeEmailForUser(user);
    const { accessToken, refreshToken } = await this.login(user);

    return {
      accessToken,
      user,
      refreshToken,
    };
  }

  async verifyEmailCode(dto: VerifyEmailCodeDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const normalizedCode = this.normalizeVerificationCode(dto.code);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !this.isEmailPasswordUser(user)) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (user.isVerified) {
      return {
        message: 'Email is already verified. Please sign in.',
        email: normalizedEmail,
        requiresVerification: false,
      };
    }

    if (
      !user.emailVerificationCodeHash ||
      !user.emailVerificationCodeExpiry ||
      user.emailVerificationCodeExpiry.getTime() <= Date.now()
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: this.getClearedEmailVerificationState(),
      });

      throw new BadRequestException(
        'This verification code has expired. Request a new one.',
      );
    }

    const providedCodeHash = this.hashValue(normalizedCode);
    if (providedCodeHash !== user.emailVerificationCodeHash) {
      const failedAttempts = (user.emailVerificationAttempts || 0) + 1;
      if (failedAttempts >= this.getEmailVerificationMaxAttempts()) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: this.getClearedEmailVerificationState(),
        });

        throw new BadRequestException(
          'Too many incorrect codes. Request a new verification code.',
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerificationAttempts: failedAttempts,
        },
      });

      throw new BadRequestException('Invalid verification code');
    }

    const verifiedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...this.getClearedEmailVerificationState(),
        isVerified: true,
      },
    });

    this.queueWelcomeEmailForUser(verifiedUser);
    const { accessToken, refreshToken } = await this.login(verifiedUser);

    return {
      message: 'Email verified successfully',
      accessToken,
      refreshToken,
      user: verifiedUser,
    };
  }

  async resendEmailVerificationCode(dto: ResendEmailVerificationCodeDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !this.isEmailPasswordUser(user)) {
      return {
        message: 'If that email exists, a verification code has been sent.',
        email: normalizedEmail,
        requiresVerification: true,
      };
    }

    if (!this.isEmailVerificationRequired()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...this.getClearedEmailVerificationState(),
          isVerified: true,
        },
      });

      return {
        message: 'Email verification is not required right now. Please sign in.',
        email: normalizedEmail,
        requiresVerification: false,
      };
    }

    if (user.isVerified) {
      return {
        message: 'Email is already verified. Please sign in.',
        email: normalizedEmail,
        requiresVerification: false,
      };
    }

    await this.issueEmailVerificationCode(user);

    return {
      message: `We sent a ${this.getEmailVerificationCodeLength()}-digit verification code to your email.`,
      email: normalizedEmail,
      requiresVerification: true,
    };
  }

  async refresh(refreshToken: string) {
    const tokenInDb = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenInDb || tokenInDb.isRevoked || tokenInDb.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const payload = {
      sub: tokenInDb.user.id,
      email: tokenInDb.user.email,
      username: tokenInDb.user.username,
      hasPreferences: tokenInDb.user.hasPreferences,
      isProfileComplete: tokenInDb.user.isProfileComplete,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: getJwtSecret(),
      expiresIn: getJwtExpiresIn(),
    });

    return { accessToken };
  }

  async loginWithPassword(dto: LoginDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user && !user.password) {
      throw new ForbiddenException(
        'This account uses Google login. Please sign in with Google',
      );
    }

    if (!user || !user.password) {
      throw new ForbiddenException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new ForbiddenException('Invalid credentials');
    }

    if (!user.isVerified && this.isEmailPasswordUser(user)) {
      if (!this.isEmailVerificationRequired()) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            ...this.getClearedEmailVerificationState(),
            isVerified: true,
          },
        });
      } else {
        await this.ensureEmailVerificationCodeAvailable(user);
        throw new ForbiddenException({
          message:
            'Email not verified. Enter the verification code sent to your inbox.',
          code: 'EMAIL_NOT_VERIFIED',
          email: normalizedEmail,
          requiresVerification: true,
        });
      }
    }

    const { accessToken, refreshToken } = await this.login(user);

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async googleLogin(dto: GoogleLoginDto) {
    return 'google login placeholder';
  }

  async verifyUsername(dto: VerifyUsernameDto) {
    const existing = await this.prisma.user.findUnique({
      where: {
        username: dto.username.toLowerCase().trim(),
      },
    });

    if (existing) {
      return { available: false, message: 'Username already taken' };
    }

    return { available: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !this.isEmailPasswordUser(user)) {
      return {
        message: `If that email exists, we sent a ${this.getPasswordResetCodeLength()}-digit password reset code.`,
        email: normalizedEmail,
        requiresPasswordReset: true,
      };
    }

    await this.issuePasswordResetCode(user);

    return {
      message: `If that email exists, we sent a ${this.getPasswordResetCodeLength()}-digit password reset code.`,
      email: normalizedEmail,
      requiresPasswordReset: true,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const normalizedCode = this.normalizeVerificationCode(dto.code);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !this.isEmailPasswordUser(user)) {
      throw new BadRequestException('Invalid or expired reset code');
    }

    if (
      !user.resetToken ||
      !user.resetTokenExpiry ||
      user.resetTokenExpiry.getTime() <= Date.now()
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: this.getClearedPasswordResetState(),
      });

      throw new BadRequestException(
        'This reset code has expired. Request a new one.',
      );
    }

    const providedCodeHash = this.hashValue(normalizedCode);
    if (providedCodeHash !== user.resetToken) {
      const failedAttempts = (user.resetTokenAttempts || 0) + 1;
      if (failedAttempts >= this.getPasswordResetMaxAttempts()) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: this.getClearedPasswordResetState(),
        });

        throw new BadRequestException(
          'Too many incorrect codes. Request a new password reset code.',
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetTokenAttempts: failedAttempts,
        },
      });

      throw new BadRequestException('Invalid reset code');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        ...this.getClearedPasswordResetState(),
      },
    });

    return { message: 'Password reset successful' };
  }

  async handleGoogleLogin(googleUser: {
    id: string;
    email: string;
    hasPrefrences: boolean;
    isProfileComplete: boolean;
    isNewUser?: boolean;
    username?: string | null;
    fullName?: string | null;
  }) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: googleUser.id },
      select: {
        username: true,
        fullName: true,
      },
    });

    if (googleUser.isNewUser) {
      this.queueWelcomeEmailForUser({
        email: googleUser.email,
        username: googleUser.username || dbUser?.username,
        fullName: googleUser.fullName || dbUser?.fullName,
      });
    }

    const tokens = await this.login({
      id: googleUser.id,
      email: googleUser.email,
      username: dbUser?.username,
      hasPreferences: googleUser.hasPrefrences,
      isProfileComplete: googleUser.isProfileComplete,
    });

    return {
      message: 'Google login successful',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async loginWithFirebasePhone(dto: PhoneFirebaseTokenDto) {
    const normalizedPhone = dto.phoneNumber.trim();
    const devBypassEnabled = process.env.AUTH_PHONE_DEV_BYPASS === 'true';
    const isProduction = process.env.NODE_ENV === 'production';

    if (devBypassEnabled && isProduction) {
      throw new ForbiddenException(
        'AUTH_PHONE_DEV_BYPASS cannot be enabled in production',
      );
    }

    let decodedToken: {
      uid: string;
      phone_number?: string;
      email?: string;
    };

    if (!dto.verificationArtifact?.idToken && !devBypassEnabled) {
      throw new UnauthorizedException(
        'verificationArtifact.idToken is required for Firebase phone auth',
      );
    }

    if (dto.verificationArtifact?.idToken) {
      decodedToken = await this.firebaseService
        .getApp()
        .auth()
        .verifyIdToken(dto.verificationArtifact.idToken);
    } else {
      if (!dto.verificationArtifact?.smsCode) {
        throw new UnauthorizedException(
          'smsCode is required when using AUTH_PHONE_DEV_BYPASS',
        );
      }

      this.logger.warn(
        `AUTH_PHONE_DEV_BYPASS active: skipping Firebase ID token verification for ${normalizedPhone}`,
      );

      const digits = normalizedPhone.replace(/[^\d]/g, '');
      decodedToken = {
        uid: `dev-phone-${digits}`,
        phone_number: normalizedPhone,
      };
    }

    if (!decodedToken?.phone_number) {
      throw new UnauthorizedException(
        'Verified Firebase token does not include a phone number',
      );
    }

    if (decodedToken.phone_number !== normalizedPhone) {
      throw new UnauthorizedException(
        'Phone number mismatch between payload and verified token',
      );
    }

    let user = await this.prisma.user.findFirst({
      where: { phoneNumber: normalizedPhone },
    });

    if (!user) {
      const firebaseUid = decodedToken.uid;
      const emailFromToken = decodedToken.email?.toLowerCase().trim();
      const fallbackEmail = `${firebaseUid}@phone.gathergo.local`;
      const emailToUse = emailFromToken || fallbackEmail;

      user = await this.prisma.user.create({
        data: {
          email: emailToUse,
          googleId: firebaseUid,
          phoneNumber: normalizedPhone,
          isVerified: true,
        },
      });
    } else if (!user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...this.getClearedEmailVerificationState(),
          isVerified: true,
        },
      });
    }

    const { accessToken, refreshToken } = await this.login(user);

    return {
      message: 'Phone authentication successful',
      accessToken,
      refreshToken,
      user,
    };
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
        bio: true,
        birthDate: true,
        hasPreferences: true,
        isProfileComplete: true,
        nationality: true,
        profilePicUrl: true,
        updatedAt: true,
        gender: true,
        phoneNumber: true,
        isVerified: true,
        fullName: true,
        profilePicUrlTN: true,
      },
    });
  }

  private async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      hasPreferences: user.hasPreferences,
      isProfileComplete: user.isProfileComplete,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: getJwtSecret(),
      expiresIn: getJwtExpiresIn(),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: getJwtRefreshSecret(),
      expiresIn: getJwtRefreshExpiresIn(),
    });

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(
          Date.now() + this.getRefreshTokenExpiryWindowMs(),
        ),
      },
    });

    return { accessToken, refreshToken, user };
  }

  private async issueEmailVerificationCode(
    user: EmailPasswordUser,
    options?: { ignoreCooldown?: boolean },
  ) {
    if (!user.email) {
      throw new InternalServerErrorException(
        'Email verification is unavailable right now.',
      );
    }

    const cooldownSeconds = this.getEmailVerificationResendCooldownSeconds();
    const remainingCooldownSeconds = this.getRemainingCooldownSeconds(user);
    if (!options?.ignoreCooldown && remainingCooldownSeconds > 0) {
      throw new BadRequestException(
        `Please wait ${remainingCooldownSeconds}s before requesting another verification code.`,
      );
    }

    const code = this.generateNumericCode(this.getEmailVerificationCodeLength());
    const expiry = new Date(
      Date.now() + this.getEmailVerificationExpiryMinutes() * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash: this.hashValue(code),
        emailVerificationCodeExpiry: expiry,
        emailVerificationSentAt: new Date(),
        emailVerificationAttempts: 0,
      },
    });

    try {
    
      const result = await this.mailService.sendEmailVerificationCode({
        to: user.email,
        name: this.resolveWelcomeName(user),
        code,
        expiresInMinutes: this.getEmailVerificationExpiryMinutes(),
      });
    

      if (result.skipped) {
        throw new InternalServerErrorException(
          'Email verification is unavailable right now.',
        );
      }

      return {
        email: user.email,
        expiresAt: expiry,
        cooldownSeconds,
      };
    } catch (error) {
      await this.prisma.user
        .update({
          where: { id: user.id },
          data: this.getClearedEmailVerificationState(),
        })
        .catch((cleanupError: unknown) => {
          const reason =
            cleanupError instanceof Error
              ? cleanupError.message
              : 'unknown cleanup error';
          this.logger.error(
            `Failed to clear email verification state for ${user.email}: ${reason}`,
          );
        });

      if (error instanceof BadRequestException) {
        throw error;
      }

      const reason =
        error instanceof Error ? error.message : 'unknown mail dispatch error';
      this.logger.error(
        `Failed to queue email verification code for ${user.email}: ${reason}`,
      );
      throw new InternalServerErrorException(
        'Email verification is unavailable right now.',
      );
    }
  }

  private async issuePasswordResetCode(
    user: EmailPasswordUser,
    options?: { ignoreCooldown?: boolean },
  ) {
    if (!user.email) {
      throw new InternalServerErrorException(
        'Password reset is unavailable right now.',
      );
    }

    const remainingCooldownSeconds =
      this.getRemainingPasswordResetCooldownSeconds(user);
    if (!options?.ignoreCooldown && remainingCooldownSeconds > 0) {
      throw new BadRequestException(
        `Please wait ${remainingCooldownSeconds}s before requesting another reset code.`,
      );
    }

    const code = this.generateNumericCode(this.getPasswordResetCodeLength());
    const expiry = new Date(
      Date.now() + this.getPasswordResetExpiryMinutes() * 60 * 1000,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: this.hashValue(code),
        resetTokenExpiry: expiry,
        resetTokenSentAt: new Date(),
        resetTokenAttempts: 0,
      },
    });

    try {
      const result = await this.mailService.sendPasswordResetCode({
        to: user.email,
        name: this.resolveWelcomeName(user),
        code,
        expiresInMinutes: this.getPasswordResetExpiryMinutes(),
      });

      if (result.skipped) {
        throw new InternalServerErrorException(
          'Password reset is unavailable right now.',
        );
      }

      return {
        email: user.email,
        expiresAt: expiry,
      };
    } catch (error) {
      await this.prisma.user
        .update({
          where: { id: user.id },
          data: this.getClearedPasswordResetState(),
        })
        .catch((cleanupError: unknown) => {
          const reason =
            cleanupError instanceof Error
              ? cleanupError.message
              : 'unknown cleanup error';
          this.logger.error(
            `Failed to clear password reset state for ${user.email}: ${reason}`,
          );
        });

      if (error instanceof BadRequestException) {
        throw error;
      }

      const reason =
        error instanceof Error ? error.message : 'unknown mail dispatch error';
      this.logger.error(
        `Failed to queue password reset code for ${user.email}: ${reason}`,
      );
      throw new InternalServerErrorException(
        'Password reset is unavailable right now.',
      );
    }
  }

  private async ensureEmailVerificationCodeAvailable(user: EmailPasswordUser) {
    if (
      user.emailVerificationCodeHash &&
      user.emailVerificationCodeExpiry &&
      user.emailVerificationCodeExpiry.getTime() > Date.now()
    ) {
      return;
    }

    if (this.getRemainingCooldownSeconds(user) > 0) {
      return;
    }

    await this.issueEmailVerificationCode(user);
  }

  private queueWelcomeEmailForUser(user: {
    email?: string | null;
    username?: string | null;
    fullName?: string | null;
  }) {
    if (!user.email) {
      return;
    }

    void this.mailService
      .sendWelcomeEmail({
        to: user.email,
        name: this.resolveWelcomeName(user),
        loginLink: this.buildFrontendUrl('/login'),
        profileSetupLink: this.buildFrontendUrl('/profile-setup'),
        activationLink: this.buildFrontendUrl('/profile-setup'),
      })
      .catch((error: unknown) => {
        const reason =
          error instanceof Error ? error.message : 'unknown mail error';
        this.logger.warn(
          `Failed to queue welcome email for ${user.email}: ${reason}`,
        );
      });
  }

  private getClearedEmailVerificationState() {
    return {
      emailVerificationCodeHash: null,
      emailVerificationCodeExpiry: null,
      emailVerificationSentAt: null,
      emailVerificationAttempts: 0,
    };
  }

  private getClearedPasswordResetState() {
    return {
      resetToken: null,
      resetTokenExpiry: null,
      resetTokenSentAt: null,
      resetTokenAttempts: 0,
    };
  }

  private normalizeEmail(email: string) {
    return email.toLowerCase().trim();
  }

  private normalizeVerificationCode(code: string) {
    return code.replace(/[^\d]/g, '').trim();
  }

  private hashValue(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private generateNumericCode(length: number) {
    const max = 10 ** length;
    const code = crypto.randomInt(0, max).toString().padStart(length, '0')
    console.log(code)
    return code ;
  }

  private isEmailVerificationRequired() {
    return this.getBooleanEnv('AUTH_EMAIL_VERIFICATION_REQUIRED', false);
  }

  private getEmailVerificationCodeLength() {
    const parsed = Number(process.env.AUTH_EMAIL_VERIFICATION_CODE_LENGTH);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_EMAIL_VERIFICATION_CODE_LENGTH;
    }

    return Math.min(6, Math.max(4, Math.floor(parsed)));
  }

  private getEmailVerificationExpiryMinutes() {
    const parsed = Number(process.env.AUTH_EMAIL_VERIFICATION_EXPIRY_MINUTES);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_EMAIL_VERIFICATION_EXPIRY_MINUTES;
    }

    return Math.floor(parsed);
  }

  private getEmailVerificationResendCooldownSeconds() {
    const parsed = Number(
      process.env.AUTH_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    );
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS;
    }

    return Math.floor(parsed);
  }

  private getEmailVerificationMaxAttempts() {
    const parsed = Number(process.env.AUTH_EMAIL_VERIFICATION_MAX_ATTEMPTS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_EMAIL_VERIFICATION_MAX_ATTEMPTS;
    }

    return Math.floor(parsed);
  }

  private getPasswordResetCodeLength() {
    const parsed = Number(process.env.AUTH_PASSWORD_RESET_CODE_LENGTH);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_PASSWORD_RESET_CODE_LENGTH;
    }

    return Math.min(6, Math.max(4, Math.floor(parsed)));
  }

  private getPasswordResetExpiryMinutes() {
    const parsed = Number(process.env.AUTH_PASSWORD_RESET_EXPIRY_MINUTES);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_PASSWORD_RESET_EXPIRY_MINUTES;
    }

    return Math.floor(parsed);
  }

  private getPasswordResetResendCooldownSeconds() {
    const parsed = Number(process.env.AUTH_PASSWORD_RESET_RESEND_COOLDOWN_SECONDS);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_PASSWORD_RESET_RESEND_COOLDOWN_SECONDS;
    }

    return Math.floor(parsed);
  }

  private getPasswordResetMaxAttempts() {
    const parsed = Number(process.env.AUTH_PASSWORD_RESET_MAX_ATTEMPTS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_PASSWORD_RESET_MAX_ATTEMPTS;
    }

    return Math.floor(parsed);
  }

  private getRemainingCooldownSeconds(user: EmailPasswordUser) {
    if (!user.emailVerificationSentAt) {
      return 0;
    }

    const cooldownMs =
      this.getEmailVerificationResendCooldownSeconds() * 1000;
    const remainingMs =
      user.emailVerificationSentAt.getTime() + cooldownMs - Date.now();

    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  private getRemainingPasswordResetCooldownSeconds(user: EmailPasswordUser) {
    if (!user.resetTokenSentAt) {
      return 0;
    }

    const cooldownMs = this.getPasswordResetResendCooldownSeconds() * 1000;
    const remainingMs = user.resetTokenSentAt.getTime() + cooldownMs - Date.now();

    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  private getBooleanEnv(key: string, defaultValue: boolean) {
    const rawValue = process.env[key];
    if (!rawValue) {
      return defaultValue;
    }

    const normalizedValue = rawValue.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
      return false;
    }

    return defaultValue;
  }

  private buildFrontendUrl(path: string) {
    const baseUrl = process.env.FRONTEND_URL?.trim();

    if (!baseUrl) {
      return undefined;
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');

    return `${normalizedBaseUrl}/${normalizedPath}`;
  }

  private resolveWelcomeName(user: {
    email?: string | null;
    username?: string | null;
    fullName?: string | null;
  }) {
    const preferredName = user.fullName?.trim() || user.username?.trim();
    if (preferredName) {
      return preferredName;
    }

    const emailLocalPart = user.email?.split('@')[0]?.trim();
    if (!emailLocalPart) {
      return 'there';
    }

    return emailLocalPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map(
        (segment) => segment.charAt(0).toUpperCase() + segment.slice(1),
      )
      .join(' ');
  }

  private isEmailPasswordUser(user: {
    password?: string | null;
    googleId?: string | null;
  }) {
    return Boolean(user.password && !user.googleId);
  }

  async generateToken(userId: string, email: string, username?: string, option?) {
    const payload = { sub: userId, email, username };
    return option
      ? this.jwtService.sign(payload, option)
      : this.jwtService.sign(payload);
  }

  private getRefreshTokenExpiryWindowMs(): number {
    const expiresIn = getJwtRefreshExpiresIn();
    const match = expiresIn.match(/^(\d+)([smhd])$/i);

    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * multipliers[unit];
  }

  async newGoogleLogin(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const { sub: googleId, email, name, picture } = payload;

    let user = await this.prisma.user.findUnique({
      where: { googleId },
    });

    if (!user && email) {
      user = await this.prisma.user.create({
        data: {
          googleId,
          email,
          fullName: name || '',
          profilePicUrl: picture,
          isVerified: true,
        },
      });

      this.queueWelcomeEmailForUser(user);
      const { accessToken, refreshToken } = await this.login(user);

      return {
        accessToken,
        refreshToken,
        user,
      };
    }
  }
}

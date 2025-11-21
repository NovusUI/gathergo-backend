import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { GoogleLoginDto } from './dtos/google-login.dto';
import { VerifyUsernameDto } from './dtos/verify-username.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  // SIGNUP
  async signup(dto: SignupDto) {
    // 1️⃣ Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existingUser) {
      throw new ForbiddenException('Email already in use');
    }

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // 3️⃣ Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        password: hashedPassword,
      },
    });

    // 4️⃣ Create JWT token
    const token = await this.generateToken(user.id, user.email, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = await this.generateToken(user.id, user.email);

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // 5️⃣ Return
    return {
      accessToken: token,
      user,
      refreshToken,
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

    const payload = { sub: tokenInDb.user.id };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    return { accessToken };
  }

  // LOGIN
  async loginWithPassword(dto: LoginDto) {
    // 1️⃣ Find user
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (user && !user.password) {
      throw new ForbiddenException(
        'This account uses Google login. Please sign in with Google',
      );
    }

    if (!user || !user.password) {
      throw new ForbiddenException('Invalid credentials');
    }

    // 2️⃣ Check password
    const isMatch = await bcrypt.compare(dto.password, user.password);
    if (!isMatch) {
      throw new ForbiddenException('Invalid credentials');
    }

    // 3️⃣ Create JWT
    const { accessToken, refreshToken } = await this.login(user);

    return {
      accessToken,
      refreshToken,
      user,
    };
  }

  async googleLogin(dto: GoogleLoginDto) {
    // TODO: implement Google login logic
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
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user?.googleId && !user.password) {
      throw new ForbiddenException(
        'Google-authenticated accounts must use Google login',
      );
    }

    if (!user) {
      // Optionally, don't reveal user existence
      throw new ForbiddenException(
        'If the email exists, you will receive instructions',
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(token, 12);

    await this.prisma.user.update({
      where: { email: dto.email },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 60), // 1 hour
      },
    });

    // TODO: send email (for now, just log)
    console.log(`Reset token (send via email): ${token}`);

    return {
      message: 'If that email exists, you will receive a password reset link',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const users = await this.prisma.user.findMany();

    for (const user of users) {
      const isMatch = await bcrypt.compare(dto.token, user.resetToken || '');
      if (
        isMatch &&
        user.resetTokenExpiry &&
        user.resetTokenExpiry > new Date()
      ) {
        const hashedPassword = await bcrypt.hash(dto.newPassword, 12);

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            password: hashedPassword,
            resetToken: null,
            resetTokenExpiry: null,
          },
        });

        return { message: 'Password reset successful' };
      }
    }

    throw new ForbiddenException('Invalid or expired token');
  }

  async handleGoogleLogin(googleUser: {
    id: string;
    email: string;
    hasPrefrences: boolean;
  }) {
    // Generate JWT
    console.log(googleUser, 'google user');

    const tokens = await this.login({
      id: googleUser.id,
      email: googleUser.email,
      hasPreferences: googleUser.hasPrefrences,
    });

    return {
      message: 'Google login successful',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async me(userId: string) {
    // TODO: return logged in user details
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    return user;
  }

  private async login(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      hasPreferences: user.hasPreferences,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken, user };
  }
  // TOKEN HELPER
  async generateToken(userId: string, email: string, option?) {
    const payload = { sub: userId, email };
    return option
      ? this.jwtService.sign(payload, option)
      : this.jwtService.sign(payload);
  }

  async newGoogleLogin(idToken: string) {
    console.log('i am not calling this endpoint');
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) throw new UnauthorizedException('Invalid Google token');

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
        },
      });

      const payload = { sub: user.id, email };

      const accessToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_SECRET,
        expiresIn: '15m',
      });

      const refreshToken = this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      });

      await this.prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        accessToken: accessToken,
        refreshToken: refreshToken,
        user,
      };
    }
  }
}

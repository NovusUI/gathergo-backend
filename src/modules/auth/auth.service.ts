import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { GoogleLoginDto } from './dtos/google-login.dto';
import { VerifyUsernameDto } from './dtos/verify-username.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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
    const token = await this.generateToken(user.id, user.email);

    // 5️⃣ Return
    return {
      accessToken: token,
      user,
    };
  }

  
  // LOGIN
  async login(dto: LoginDto) {
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
    const token = await this.generateToken(user.id, user.email);

    return {
      accessToken: token,
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
      throw new ForbiddenException('If the email exists, you will receive instructions');
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

    return { message: 'If that email exists, you will receive a password reset link' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const users = await this.prisma.user.findMany();

   
  

    for (const user of users) {
      const isMatch = await bcrypt.compare(dto.token, user.resetToken || '');
      if (isMatch && user.resetTokenExpiry && user.resetTokenExpiry > new Date()) {
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

  async handleGoogleLogin(googleUser: { id: string; email: string }) {
    // Generate JWT

    const accessToken =  await this.generateToken(googleUser.id,googleUser.email)
  
    return {
      message: 'Google login successful',
      accessToken,
      user: {
        id: googleUser.id,
        email: googleUser.email,
      },
    };
  }

  async me(userId:string) {
    // TODO: return logged in user details
   const user = await this.prisma.user.findFirst({
      where:{id:userId}
      
    })
    
    return user;
  }

  // TOKEN HELPER
  async generateToken(userId: string, email: string) {
    const payload = { sub: userId, email };
    return this.jwtService.sign(payload);
  }

  
}

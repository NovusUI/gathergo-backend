import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Param,
  Res,
  Query,
  Session,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto, RefreshDto } from './dtos/login.dto';
import { GoogleLoginDto } from './dtos/google-login.dto';
import { VerifyUsernameDto } from './dtos/verify-username.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Response } from 'express';
import * as passport from 'passport';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register with email and password' })
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.loginWithPassword(dto);
  }
  @Get('google')
  //@UseGuards(AuthGuard('google'))
  @ApiOperation({
    summary: 'Initiate Google OAuth login (redirects to Google)',
  })
  async googleAuth(
    @Query('redirect') redirect: string, // ← BACKEND RECEIVES IT HERE
    @Query('prompt') prompt: string = 'select_account',
    @Req() req,
    @Res() res: Response,
  ) {
    return new Promise((resolve, reject) => {
      console.log('🔗 Controller - Redirect URL:', redirect);
      // Use Passport's authenticate method directly with custom callback
      passport.authenticate(
        'google',
        {
          scope: ['email', 'profile'],
          state: redirect, // Pass as state parameter
          session: false, // Important: no sessions
          prompt,
        },
        () => {},
      )(req, res);
    });
  }

  // @Post('googleauth')
  // @UseGuards(AuthGuard('google'))
  // @ApiOperation({ summary: 'login or signup with google user' })
  // async googleLogin(@Param() idToken: string) {
  //   await this.authService.newGoogleLogin(idToken);
  // }

  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req, @Res() res: Response) {
    console.log('User from Passport:', req.user); // Debug

    const googleUser = req.user;

    if (!googleUser) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    // Generate token
    const result = await this.authService.handleGoogleLogin({
      id: googleUser.id,
      email: googleUser.email,
      hasPrefrences: googleUser.hasPreferences,
      isProfileComplete: googleUser.isProfileComplete,
    });

    // Get redirect URL from user object (passed from strategy)

    const redirectUrl = googleUser.redirectUrl;

    console.log(redirectUrl);

    // If mobile redirect exists, redirect with token
    if (redirectUrl) {
      console.log(
        'Redirecting to:',
        `${redirectUrl}?token=${result.accessToken}`,
      );

      const url = new URL(redirectUrl);

      // Add all the essential data as individual parameters
      url.searchParams.set('token', result.accessToken);
      url.searchParams.set('refreshToken', result.refreshToken);

      console.log('Redirecting to:', url.toString());
      return res.redirect(url.toString());
    }

    // Otherwise return JSON for web/testing
    return res.json(result);
  }

  @Post('refresh')
  @ApiBody({ type: RefreshDto })
  @ApiResponse({
    status: 200,
    description: 'Access token refreshed successfully.',
  })
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('verify-username')
  @ApiOperation({ summary: 'Verify if username is available' })
  @ApiResponse({ status: 200, description: 'Username availability response' })
  async verifyUsername(@Body() dto: VerifyUsernameDto) {
    return this.authService.verifyUsername(dto);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset link' })
  @ApiResponse({ status: 200, description: 'Email sent if user exists' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current logged-in user' })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }
}

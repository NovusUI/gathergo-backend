import { Controller, Post, Body, Get,  UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dtos/signup.dto';
import { LoginDto } from './dtos/login.dto';
import { GoogleLoginDto } from './dtos/google-login.dto';
import { VerifyUsernameDto } from './dtos/verify-username.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

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
    return this.authService.login(dto);
  }
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth login (redirects to Google)' })
  async googleAuth() {
    // This method will redirect user to Google, no logic needed.
  }

  @Get('google/redirect')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback, returns JWT after Google login' })
  async googleAuthRedirect(@Req() req) {
    return this.authService.handleGoogleLogin(req.user);
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
  me(@CurrentUser('id') userId:string) {
    return this.authService.me(userId);
  }
}

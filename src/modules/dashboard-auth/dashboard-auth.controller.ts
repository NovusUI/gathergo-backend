import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { CurrentDashboard, DashboardAccess } from './dashboard-access';
import { DashboardAuthService } from './dashboard-auth.service';
import {
  ChangeDashboardPasswordDto,
  DashboardLoginDto,
} from './dashboard-auth.dto';
import type { DashboardSessionContext } from './dashboard-auth.types';

@ApiTags('Dashboard authentication')
@Controller('dashboard/auth')
export class DashboardAuthController {
  constructor(private readonly auth: DashboardAuthService) {}

  @Post('login')
  @Header('Cache-Control', 'no-store')
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSec: 900, max: 20, cooldownSec: 900 })
  login(@Body() dto: DashboardLoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @DashboardAccess('password')
  me(@CurrentDashboard() session: DashboardSessionContext) {
    return { user: session.user, expiresAt: session.expiresAt };
  }

  @Post('logout')
  @DashboardAccess('password')
  logout(@CurrentDashboard() session: DashboardSessionContext) {
    return this.auth.logout(session);
  }

  @Post('password')
  @DashboardAccess('password')
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSec: 900, max: 10, cooldownSec: 900 })
  changePassword(
    @CurrentDashboard() session: DashboardSessionContext,
    @Body() dto: ChangeDashboardPasswordDto,
  ) {
    return this.auth.changePassword(session, dto);
  }
}

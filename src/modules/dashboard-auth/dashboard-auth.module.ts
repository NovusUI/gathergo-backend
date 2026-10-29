import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { DashboardAuthController } from './dashboard-auth.controller';
import { DashboardUsersController } from './dashboard-users.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [DashboardAuthController, DashboardUsersController],
  providers: [DashboardAuthService, DashboardAuthGuard, RateLimitGuard],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class DashboardAuthModule {}

import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DashboardService } from '../services/dashboard.service';
import { InternalAdminOverviewQueryDto } from '../dto/internal-overview.dto';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get main dashboard data' })
  @ApiResponse({ status: 200, description: 'Returns dashboard data' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number for pagination (default: 1)',
  })
  async getDashboard(
    @CurrentUser('id') userId: string,
    @Query('page') page?: number,
  ) {
    const result = await this.dashboardService.getDashboardData(userId, page);
    return {
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: result,
    };
  }

  @Get('home-cards')
  @ApiOperation({ summary: 'Get home screen cards' })
  @ApiResponse({ status: 200, description: 'Returns home screen cards' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getHomeCards(@CurrentUser('id') userId: string) {
    const result = await this.dashboardService.getHomeCards(userId);
    return {
      status: 'success',
      message: 'Home cards retrieved successfully',
      data: result,
    };
  }

  @Get('internal/overview')
  @Public()
  @ApiOperation({ summary: 'Internal admin overview endpoint' })
  async getInternalOverview(
    @Headers('x-ops-key') opsKey: string,
    @Query() dto: InternalAdminOverviewQueryDto,
  ) {
    return {
      data: await this.dashboardService.getInternalOverview(dto, opsKey),
    };
  }
}

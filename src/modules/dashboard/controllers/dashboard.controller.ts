import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DashboardService } from '../services/dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard/overview')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
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
}

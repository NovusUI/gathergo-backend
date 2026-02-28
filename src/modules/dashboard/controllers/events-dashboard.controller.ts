import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { EventsDashboardService } from '../services/events-dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard/event')
export class EventsDashboardController {
  constructor(
    private readonly eventsDashboardService: EventsDashboardService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get event dashboard data' })
  @ApiResponse({ status: 200, description: 'Returns event dashboard data' })
  @ApiResponse({ status: 404, description: 'Event not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'id',
    description: 'Event ID',
    type: String,
  })
  async getEventDashboard(
    @CurrentUser('id') userId: string,
    @Param('id') eventId: string,
  ) {
    const result = await this.eventsDashboardService.getEventDashboardData(
      userId,
      eventId,
    );
    return {
      success: true,
      message: 'Event dashboard data retrieved successfully',
      data: result,
    };
  }
}

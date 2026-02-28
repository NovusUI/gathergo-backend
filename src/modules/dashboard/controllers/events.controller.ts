import {
  Controller,
  Get,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { EventsService } from '../services/events.service';
import { GetEventsDto } from '../dto/get-events.dto';

@ApiTags('Dashboard')
@Controller('dashboard/dashboardevents')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get('list')
  @ApiOperation({ summary: 'Get paginated events with filtering' })
  @ApiResponse({ status: 200, description: 'Returns paginated events' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async getEvents(
    @CurrentUser('id') userId: string,
    @Query(new ValidationPipe({ transform: true })) dto: GetEventsDto,
  ) {
    const result = await this.eventsService.getEvents(userId, dto);
    return {
      message: 'Events retrieved successfully',
      ...result,
    };
  }
}
